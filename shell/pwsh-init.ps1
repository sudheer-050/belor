# Injected by Belor. After each command it emits:
#   OSC 133;D;<0|1>  - did the command succeed (drives the success/fail sounds)
#   OSC 9;9;"<path>" - current directory (drives the tab title)
# It wraps (does not replace) your existing prompt and only affects this session.
$global:__stOrigPrompt = $function:prompt
$global:__stLastId = 0
function global:prompt {
    $ok = $?
    $code = if ($ok) { 0 } else { 1 }
    $esc = [char]27; $bel = [char]7
    $last = Get-History -Count 1 -ErrorAction SilentlyContinue
    $mark = ''
    if ($last -and $last.Id -ne $global:__stLastId) {
        $global:__stLastId = $last.Id
        $mark = "$esc]133;D;$code$bel"
    }
    $cwd = $executionContext.SessionState.Path.CurrentLocation.ProviderPath
    if ($cwd) { $mark += "$esc]9;9;`"$cwd`"$bel" }
    $orig = if ($global:__stOrigPrompt) { & $global:__stOrigPrompt } else { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
    "$mark$orig"
}
