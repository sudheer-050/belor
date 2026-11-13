$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '../shell/st-notify.ps1'
$source = [IO.File]::ReadAllText($scriptFile) -replace '(?m)^exit 0\s*$', 'return'
$source = $source.Replace('} catch { }', '} catch { throw }')
$notify = [scriptblock]::Create($source)
Add-Type @'
using System.IO;
using System.IO.Pipes;
using System.Threading.Tasks;
public static class BelorNotificationReader {
    public static Task<string> Read(NamedPipeServerStream server) {
        return Task.Factory.StartNew(() => {
            server.WaitForConnection();
            return new StreamReader(server).ReadLine();
        });
    }
}
'@
$savedEnv = @{}
foreach ($key in @('BELOR_PIPE', 'BELOR_TAB', 'BELOR_TOKEN')) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key) }
function Check-Notification([string]$tool, [string]$json) {
    $name = 'belor-notify-check-' + [guid]::NewGuid().ToString('N')
    $server = New-Object IO.Pipes.NamedPipeServerStream($name, [IO.Pipes.PipeDirection]::In, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous)
    try {
        $env:BELOR_PIPE = '\\.\pipe\' + $name
        $env:BELOR_TAB = '17'; $env:BELOR_TOKEN = 'isolated-test-token'
        # A pipe writer flush waits for consumption on Windows. Read concurrently
        # with the real hook, as the terminal host does, rather than after it returns.
        $read = [BelorNotificationReader]::Read($server)
        Write-Output 'Checking Codex conversation notification...'
        & $notify -Event done -Tool codex -Rest @($json)
        if (-not $read.Wait(3000)) { throw 'Hook did not send a complete message' }
        $message = $read.Result | ConvertFrom-Json
        if ($message.sessionId -ne '12345678-1234-1234-1234-123456789abc' -or $message.tab -ne 17 -or $message.tool -ne $tool -or $message.token -ne 'isolated-test-token') { throw 'Incorrect conversation notification' }
    } finally { $server.Dispose() }
}
try {
    Check-Notification 'codex' '{"thread-id":"12345678-1234-1234-1234-123456789abc"}'
    Write-Output 'NOTIFY_SESSION_PASS: real named pipe, exact conversation ID, authenticated tab and Codex payload.'
} catch {
    if ($_.Exception.Message -like '*Access to the path is denied*') {
        Write-Output 'NOTIFY_SESSION_BLOCKED: Windows sandbox denies named-pipe client access.'
        exit 2
    }
    throw
} finally {
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key]) }
}
