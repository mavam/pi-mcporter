This release makes Pi MCPorter feel native in pi by using pi's built-in tool output expand and collapse behavior, so you can inspect search, describe, and call results with the standard Ctrl+O workflow. It also adds compact call argument previews in tool headers, making it easier to verify inputs at a glance before expanding full output.

## 🚀 Features

### Call argument previews in mcporter tool headers

`mcporter call` headers now show a compact preview of the arguments being sent, so users can confirm tool inputs without expanding the full tool call output. For example, a call such as `mcporter call linear.list_issues` can now show `team=PI limit=10 state=Todo`, and multiline inputs are compacted into a single readable line.

This makes it easier to review tool invocations at a glance while still truncating long previews to fit the available header width.

*By @mavam and @codex in #2.*

## 🔧 Changes

### Pi-native tool output expansion

Pi MCPorter tool output now follows pi's built-in expand and collapse behavior instead of maintaining a separate `/mcporter` output mode. Collapsed results show a compact summary for `search`, `describe`, and `call`, and expanded results show the full rendered output using pi's existing `expandTools` keybinding (default `Ctrl+O`).

This keeps the extension behavior aligned with the rest of pi and removes an extra per-extension setting that users would otherwise need to discover and maintain.

*By @mavam and @codex in #1.*
