# Tells the Belor tab this program is running in that something happened.
# Used as a Claude Code hook and as Codex's `notify` program:
#   st-notify.ps1 done claude        a run finished (plays the success sound)
#   st-notify.ps1 attention claude   it needs you (plays a softer ping)
#   st-notify.ps1 error codex        a run failed (plays the failure sound)
#
# Codex runs one notify program and adds a JSON payload as the last argument. If you already had a
# notify program, Belor keeps it by chaining: everything after __then__ is that program and
# its arguments, and it is started afterwards with the same arguments Codex gave us (payload included).
#   st-notify.ps1 done codex __then__ C:\path\other.exe turn-ended <payload>
param(
    [string]$Event = 'done',
    [string]$Tool = 'agent',
    [Parameter(ValueFromRemainingArguments = $true)]$Rest
)

function Send-BelorEvent {
    $pipe = $env:BELOR_PIPE; $tab = $env:BELOR_TAB; $token = $env:BELOR_TOKEN
    if (-not $pipe -or -not $tab -or -not $token) { return }          # not inside a Belor tab
    if ($pipe -notlike '\\.\pipe\belor-*') { return }        # only ever talk to our own pipe
    try {
        $name = $pipe.Substring('\\.\pipe\'.Length)
        $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $name, [System.IO.Pipes.PipeDirection]::Out)
        $client.Connect(1500)
        $writer = New-Object System.IO.StreamWriter($client)
        $writer.AutoFlush = $true
        $writer.WriteLine((@{ token = $token; tab = [int]$tab; event = $Event; tool = $Tool } | ConvertTo-Json -Compress))
        $writer.Dispose()
    } catch { }
}

# Quote one argument the way CreateProcess expects, so JSON payloads with quotes arrive intact.
function ConvertTo-WinArg([string]$a) {
    if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
    $s = $a -replace '(\\*)"', '$1$1\"'
    $s = $s -replace '(\\+)$', '$1$1'
    return '"' + $s + '"'
}

Send-BelorEvent

$args2 = @($Rest)
$i = [array]::IndexOf($args2, '__then__')
if ($i -ge 0 -and $i + 1 -lt $args2.Count) {
    try {
        $prog = $args2[$i + 1]
        $progArgs = if ($i + 2 -lt $args2.Count) { $args2[($i + 2)..($args2.Count - 1)] } else { @() }
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $prog
        $psi.Arguments = (($progArgs | ForEach-Object { ConvertTo-WinArg ([string]$_) }) -join ' ')
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        [void][System.Diagnostics.Process]::Start($psi)
    } catch { }
}
exit 0
