# ReadMeTheText BETA Extension
ReadMeTheText Extension uses Google's Beta text-to-speech API to read text from webpages and the clipboard.

It installs a right-click options to read selected text, or you can use the extension's toolbar menu to read text in your clipboard. This is handy when the page has taken over the right-click context menu.

# Project layout

`packages.json` is only used to get the latest .ts (typescript) declaration files. These are used by modern IDEs to add basic type checking.

`/extension/` is the extension's source

# Extension's Manifest Permissions

```json
"permissions": [
  "contextMenus", - Can ONLY access selected text in page when right-click menu item is selected.
  "storage", - Settings are save and can be synced across machines if Chrome is configured to sync. API key is NOT synced
  "alarms"  - This is actually deferred tasks. Used to free sounds from memory after N minutes.
],
  "optional_permissions": [
  "clipboardRead",         - Used to play the contents of the clipboard. Useful when page take over right-click menu
  "notifications",         - used if the person wants to be warned when approaching quota limits (todo)
],
```


