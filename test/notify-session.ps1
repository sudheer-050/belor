$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '../shell/st-notify.ps1'
$source = [IO.File]::ReadAllText($scriptFile) -replace '(?m)^exit 0\s*$', 'return'
$source = $source.Replace('} catch { }', '} catch { throw }')
$notify = [scriptblock]::Create($source)
$savedEnv = @{}
foreach ($key in @('BELOR_PIPE', 'BELOR_TAB', 'BELOR_TOKEN')) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key) }
$originalInput = [Console]::In
function Check-Notification([string]$tool, [string]$json) {
    $name = 'belor-notify-check-' + [guid]::NewGuid().ToString('N')
    $server = New-Object IO.Pipes.NamedPipeServerStream($name, [IO.Pipes.PipeDirection]::In, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous)
    try {
        $env:BELOR_PIPE = '\\.\pipe\' + $name
        $env:BELOR_TAB = '17'; $env:BELOR_TOKEN = 'isolated-test-token'
        $wait = $server.BeginWaitForConnection($null, $null)
        if ($tool -eq 'codex') { & $notify -Event done -Tool codex -Rest @($json) }
        else {
            [Console]::SetIn((New-Object IO.StringReader($json)))
            & $notify -Event done -Tool claude
        }
        if (-not $wait.AsyncWaitHandle.WaitOne(3000)) { throw 'Hook did not connect' }
        $server.EndWaitForConnection($wait)
        $reader = New-Object IO.StreamReader($server)
        $message = $reader.ReadLine() | ConvertFrom-Json
        if ($message.sessionId -ne '12345678-1234-1234-1234-123456789abc' -or $message.tab -ne 17 -or $message.tool -ne $tool -or $message.token -ne 'isolated-test-token') { throw 'Incorrect conversation notification' }
    } finally { $server.Dispose() }
}
try {
    Check-Notification 'codex' '{"thread-id":"12345678-1234-1234-1234-123456789abc"}'
    if ([Console]::IsInputRedirected) { Check-Notification 'claude' '{"session_id":"12345678-1234-1234-1234-123456789abc"}' }
    Write-Output 'NOTIFY_SESSION_PASS: real named pipe, exact conversation ID, authenticated tab, Codex payload and redirected Claude payload.'
} catch {
    if ($_.Exception.Message -like '*Access to the path is denied*') {
        Write-Output 'NOTIFY_SESSION_BLOCKED: Windows sandbox denies named-pipe client access.'
        exit 2
    }
    throw
} finally {
    [Console]::SetIn($originalInput)
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key]) }
}
