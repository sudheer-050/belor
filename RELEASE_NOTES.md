# Belor 0.7.10

- New Auto contrast setting (on by default): every piece of terminal text is kept at least 7:1 against its background on any theme, including menu highlights such as the `/` list.
- The color palette, main text color and accent are adjusted per theme when needed; mouse selection text switches between black and white for readability.
- The selected row of Claude Code's `/` menu now gets a bright background (amber on dark themes, purple on light), switchable in Settings.
- The manual Minimum contrast slider still works when Auto contrast is off.

Windows x64. The installer is unsigned.

# Belor 0.7.9

- Reconnect to the same terminal processes after closing or quitting the desktop, retaining output produced while away.
- Save terminal tabs, their order and complete terminal transcripts. Restore uniquely identified Codex/Claude conversations directly in their existing tabs after an update or terminal-host restart.
- Recover Codex identities from a uniquely matched terminal title, including animated spinner titles, and from existing authenticated notification hooks.
- Enable tab restoration when upgrading from older defaults and keep a backup of the saved tab manifest.
- Add Full/Grid views for up to six selected existing terminals, drag reordering and pop-out windows that retain their terminal session.

Protocol, identity matching, upgrade defaults, popout, alert configuration and tray lifecycle checks pass. The packaged application matches the tested persistence source. Live Electron desktop restart and named-pipe acceptance could not be completed in the managed Windows sandbox.

Closing an individual tab still ends and removes it. Processes and shell variables cannot survive a Windows reboot; saved conversation resumption requires an exact identity and the installed Codex or Claude command-line tool. Old tabs with neither a saved identity nor a uniquely matched saved terminal title cannot be reconstructed by guessing.

Windows x64. The installer is unsigned.
