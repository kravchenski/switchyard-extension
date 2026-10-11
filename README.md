# switchyard-extension

Chrome extension that lets [Switchyard](https://github.com/kravchenski/switchyard) models and coding agents work with your browser: tabs, tab groups, navigation, and (in later stages) reading pages, clicking and typing.

## Development

```sh
bun install
bun run build      # builds into dist/
bun run dev        # rebuilds on change
bun run ci         # typecheck + tests + build
```

Load it in Chrome: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `dist/`. The manifest `key` pins the extension id to `dammhajbcgfiiaokdhfchhncfaknaemj`.

Click the toolbar icon to open the side panel. For now it runs a single tool by hand: pick a tool, enter JSON arguments, press **Run**.

## Tools

| Tool | What it does |
| --- | --- |
| `tabs_list` | List tabs (`all`, `window` or `session`) |
| `tab_create` | Open a tab in the Switchyard group |
| `tab_close` | Close tabs; asks first for tabs outside the Switchyard group |
| `tab_activate` | Switch to a tab |
| `navigate` | Open a url, or go back, forward or reload |
| `group_list` | List tab groups |
| `group_create` | Group tabs with a title and color |
| `group_update` | Rename, recolor, collapse a group |
| `tab_move_to_group` | Add tabs to a group |
| `ungroup` | Remove tabs from their group |
| `read_page` | Page outline with element refs (`ref_12`) for click and type |
| `find` | Find visible elements by label, text or placeholder |
| `get_page_text` | Visible text of the page |
| `click` | Click a ref or a viewport point |
| `type` | Type into a ref or the focused element |
| `key` | Press keys and shortcuts, e.g. `Control+a Delete` |
| `scroll` | Scroll the page or the area under a ref |
| `hover` | Move the mouse over a ref or point |
| `screenshot` | Capture the visible tab as an image in CSS pixels |
| `wait` | Wait a number of milliseconds |

`click`, `type` and `key` ask once per site per browser session before acting. They use `chrome.debugger`, so Chrome shows a "started debugging this browser" bar while the agent is working; it detaches after 30 seconds of inactivity.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push to `master` and on pull requests: typecheck, tests and build. The built `dist/` is uploaded as a workflow artifact.
- **Release** (`.github/workflows/release.yml`) runs when a `v*` tag is pushed. It checks that the tag matches the version in `package.json` and `static/manifest.json`, builds, zips `dist/` and attaches the zip to a GitHub release.

```sh
git tag v0.1.0 && git push origin v0.1.0
```
