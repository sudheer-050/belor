$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
Add-Type -Path (Join-Path $repo 'shell\active-sessions.cs')
$proofDir = Join-Path $repo ('dist\auto-session-proof-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $proofDir -Force | Out-Null
$proofFile = Join-Path $proofDir '01234567-89ab-4cde-8fab-0123456789ab.jsonl'
[IO.File]::WriteAllText($proofFile, '{}')
$q = { param($value) "'" + $value.Replace("'", "''") + "'" }
$code = '$handle = [IO.File]::OpenRead(' + (& $q $proofFile) + '); try { [IO.File]::WriteAllText(' + (& $q (Join-Path $proofDir 'ready')) + ', "ready"); while (!(Test-Path -LiteralPath ' + (& $q (Join-Path $proofDir 'stop')) + ')) { Start-Sleep -Milliseconds 100 } } finally { $handle.Dispose() }'
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
$fixture = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile','-EncodedCommand',$encoded -WindowStyle Hidden -PassThru
try {
    $deadline = [datetime]::UtcNow.AddSeconds(10)
    while (!(Test-Path -LiteralPath (Join-Path $proofDir 'ready'))) {
        if ($fixture.HasExited -or [datetime]::UtcNow -gt $deadline) { throw 'Session-owner fixture did not start.' }
        Start-Sleep -Milliseconds 100
    }
    $matches = [BelorActiveSessions]::OpenSessionFiles([int[]]@($fixture.Id), [string[]]@($proofDir))
    if (!($matches | Where-Object { $_.pid -eq $fixture.Id -and $_.file -eq $proofFile })) { throw 'Could not match the exact file to the process holding it open.' }
    $wrongRoot = [BelorActiveSessions]::OpenSessionFiles([int[]]@($fixture.Id), [string[]]@((Join-Path $proofDir 'different-root')))
    if ($wrongRoot.Count) { throw 'Session discovery escaped the requested session folder.' }
    [IO.File]::WriteAllText((Join-Path $proofDir 'stop'), 'stop')
    if (!$fixture.WaitForExit(5000)) { throw 'Fixture did not exit.' }
    Write-Output 'PASS: exact cross-process session file ownership and folder boundary checks.'
} finally { if (!$fixture.HasExited) { $fixture.Kill() } }
