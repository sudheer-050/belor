using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Read-only discovery. Duplicated handles are closed locally; original handles and processes are untouched.
public static class BelorActiveSessions {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {
        public uint Size,Usage,Pid; public IntPtr Heap; public uint Module,Threads,ParentPid; public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string File;
    }
    public class ProcessRow { public int pid,parentPid; public string name,started,title,commandLine; public bool visible; }
    public class FileRow { public int pid; public string file; }
    public class WindowRow { public int pid; public long window; public string started,name,title; }
    public class Snapshot { public ProcessRow[] processes; public FileRow[] files; }
    delegate bool EnumProc(IntPtr window,IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr sourceHandle,IntPtr targetProcess,out IntPtr targetHandle,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll")] static extern uint GetFileType(IntPtr handle);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder path,uint size,uint flags);
    [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int kind,IntPtr buffer,int size,out int needed);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr buffer,int size,out int needed);
    static string CommandLine(int pid) {
        IntPtr process=OpenProcess(0x1000,false,pid); if (process==IntPtr.Zero) return "";
        IntPtr buffer=IntPtr.Zero;
        try {
            int size; NtQueryInformationProcess(process,60,IntPtr.Zero,0,out size);
            if (size<16 || size>1048576) return "";
            buffer=Marshal.AllocHGlobal(size);
            if (NtQueryInformationProcess(process,60,buffer,size,out size)!=0) return "";
            int length=(ushort)Marshal.ReadInt16(buffer);
            IntPtr text=Marshal.ReadIntPtr(buffer,IntPtr.Size==8?8:4);
            return length>0?Marshal.PtrToStringUni(text,length/2):"";
        } finally { if (buffer!=IntPtr.Zero) Marshal.FreeHGlobal(buffer); CloseHandle(process); }
    }
    public static WindowRow[] Windows() {
        var result=new List<WindowRow>(); int session=Process.GetCurrentProcess().SessionId;
        EnumWindows((window,unused) => {
            if (!IsWindowVisible(window)) return true;
            uint pid; GetWindowThreadProcessId(window,out pid);
            try {
                using (var process=Process.GetProcessById((int)pid)) {
                    string name=process.ProcessName.ToLowerInvariant();
                    if (process.SessionId!=session || !System.Text.RegularExpressions.Regex.IsMatch(name,"^(windowsterminal|powershell|pwsh|cmd|conhost|openconsole|mintty|wezterm-gui|alacritty)$")) return true;
                    var title=new StringBuilder(1024); GetWindowText(window,title,title.Capacity);
                    if (title.Length>0) result.Add(new WindowRow { pid=process.Id,window=window.ToInt64(),started=process.StartTime.ToUniversalTime().ToString("o"),name=process.ProcessName+".exe",title=title.ToString() });
                }
            } catch (ArgumentException) { } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
            return true;
        },IntPtr.Zero);
        return result.ToArray();
    }
    public static bool FocusWindow(long handle,int pid,string started) {
        IntPtr window=new IntPtr(handle); uint owner;
        if (!IsWindow(window)) throw new InvalidOperationException("That terminal window has closed.");
        GetWindowThreadProcessId(window,out owner);
        using (var process=Process.GetProcessById(pid)) {
            if (owner!=pid || process.StartTime.ToUniversalTime().ToString("o")!=started) throw new InvalidOperationException("That terminal window has changed. Wait for the sidebar to refresh.");
        }
        if (IsIconic(window)) ShowWindow(window,9);
        return SetForegroundWindow(window);
    }
    public static ProcessRow[] Processes() {
        var windows=new Dictionary<int,string>();
        EnumWindows((window,unused) => {
            if (!IsWindowVisible(window)) return true;
            uint pid; GetWindowThreadProcessId(window,out pid);
            var title=new StringBuilder(1024); GetWindowText(window,title,title.Capacity);
            if (title.Length>0) windows[(int)pid]=title.ToString();
            return true;
        },IntPtr.Zero);
        var rows=new List<ProcessRow>(); int session=Process.GetCurrentProcess().SessionId;
        IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
        if (snapshot==new IntPtr(-1)) throw new InvalidOperationException("Could not inspect running terminal sessions.");
        try {
            var entry=new ProcessEntry { Size=(uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            bool more=Process32FirstW(snapshot,ref entry);
            while (more) {
                try {
                    using (var process=Process.GetProcessById((int)entry.Pid)) {
                        if (process.SessionId==session) {
                            string title; windows.TryGetValue(process.Id,out title);
                            string name=entry.File.ToLowerInvariant();
                            rows.Add(new ProcessRow { pid=process.Id,parentPid=(int)entry.ParentPid,name=entry.File,started=process.StartTime.ToUniversalTime().ToString("o"),
                                title=title??"",visible=windows.ContainsKey(process.Id),commandLine=(name=="codex.exe" || name=="claude.exe" || name=="node.exe")?CommandLine(process.Id):"" });
                        }
                    }
                } catch (ArgumentException) { } catch (System.ComponentModel.Win32Exception) { } catch (InvalidOperationException) { }
                more=Process32NextW(snapshot,ref entry);
            }
        } finally { CloseHandle(snapshot); }
        return rows.ToArray();
    }
    public static FileRow[] OpenSessionFiles(int[] pids,string[] roots) {
        var result=new List<FileRow>(); if (pids.Length==0) return result.ToArray();
        var allowed=new HashSet<int>(pids); var opened=new Dictionary<int,IntPtr>(); var found=new HashSet<string>();
        IntPtr buffer=IntPtr.Zero; int size=1048576;
        try {
            int status,needed;
            while (true) {
                buffer=Marshal.AllocHGlobal(size);
                status=NtQuerySystemInformation(64,buffer,size,out needed);
                if (status==0) break;
                Marshal.FreeHGlobal(buffer); buffer=IntPtr.Zero;
                if (status!=unchecked((int)0xC0000004) || size>=67108864) return result.ToArray();
                size=Math.Max(size*2,needed+65536);
            }
            long count=Marshal.ReadIntPtr(buffer).ToInt64(); int entrySize=IntPtr.Size==8?40:28,header=IntPtr.Size*2;
            if (count<0 || count>(size-header)/entrySize) return result.ToArray();
            for (long index=0;index<count;index++) {
                IntPtr entry=IntPtr.Add(buffer,header+(int)index*entrySize);
                long owner=Marshal.ReadIntPtr(entry,IntPtr.Size).ToInt64();
                if (owner>int.MaxValue || !allowed.Contains((int)owner)) continue;
                int pid=(int)owner; IntPtr process;
                if (!opened.TryGetValue(pid,out process)) { process=OpenProcess(0x40,false,pid); opened[pid]=process; }
                if (process==IntPtr.Zero) continue;
                IntPtr copy;
                if (!DuplicateHandle(process,Marshal.ReadIntPtr(entry,IntPtr.Size*2),new IntPtr(-1),out copy,0,false,2)) continue;
                try {
                    if (GetFileType(copy)!=1) continue;
                    var path=new StringBuilder(32768); uint length=GetFinalPathNameByHandleW(copy,path,(uint)path.Capacity,0);
                    if (length==0 || length>=path.Capacity) continue;
                    string file=path.ToString(); if (file.StartsWith("\\\\?\\")) file=file.Substring(4);
                    if (!file.EndsWith(".jsonl",StringComparison.OrdinalIgnoreCase)) continue;
                    bool inside=false;
                    foreach (string root in roots) if (file.StartsWith(root.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase)) { inside=true; break; }
                    if (inside && found.Add(pid+":"+file)) result.Add(new FileRow { pid=pid,file=file });
                } finally { CloseHandle(copy); }
            }
        } finally {
            if (buffer!=IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            foreach (IntPtr process in opened.Values) if (process!=IntPtr.Zero) CloseHandle(process);
        }
        return result.ToArray();
    }
}
