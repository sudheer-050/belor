param([long]$FocusWindow = 0, [int]$WindowPid = 0, [string]$WindowStarted = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path (Join-Path $PSScriptRoot 'active-sessions.cs')
if ($FocusWindow -gt 0) {
    [BelorActiveSessions]::FocusWindow($FocusWindow, $WindowPid, $WindowStarted) | ConvertTo-Json -Compress
    exit
}
$processes = @([BelorActiveSessions]::Processes())
$codexRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex\sessions' }
$claudeRoot = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR 'projects' } else { Join-Path $env:USERPROFILE '.claude\projects' }
$candidates = @($processes | Where-Object { $_.name -match '^(codex|claude|node)\.exe$' -and $_.commandLine -notmatch '\b(app-server|exec-server|sandbox|mcp-server)\b|--(output-format|input-format|chrome-native-host|chrome-mcp|print)\b' } | ForEach-Object { $_.pid })
$files = @([BelorActiveSessions]::OpenSessionFiles([int[]]$candidates, [string[]]@($codexRoot, $claudeRoot)))
@{ processes=$processes; files=$files; windows=@([BelorActiveSessions]::Windows()) } | ConvertTo-Json -Depth 4 -Compress
