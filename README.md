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

Click the toolbar icon to open the side panel and ask Switchyard to do something with your tabs. The agent sends your message to Switchyard's `/v1/chat/completions` with the browser tools below, runs the tool calls the model returns, and loops until the model answers. Tool calls and screenshots show up in the chat, and answers render as Markdown.

Attach files with the paperclip, by pasting or by dropping them on the panel (up to 5, 10 MB each). Text files and images go to the model with your message; other files, such as a PDF CV, are listed for `upload_file`, which puts them into a file field on the page. The agent can also make files with `create_file`, such as a cover letter or a CSV. They stay in the extension's memory for the conversation (up to 2 MB each); nothing is written to disk unless you click **Download** on the file in the chat, and uploading one to a site still asks for that site first. When the agent needs something only you know, it asks with `ask_user`: pick an option with a click or a number key, or type your own answer.

## Connecting to Switchyard

Start Switchyard (`bun run start` in the switchyard repo). The extension talks to `http://127.0.0.1:3260` with the model `agent` by default; change the address in **Settings** and the model in the panel header.

Switchyard trusts this extension's origin on `localhost` (`EXTENSION_ORIGINS`), so no key is needed. If Switchyard runs with `GATEWAY_API_KEY`, enter the same key in the extension's **Settings**. **Test connection** checks that it works.

## Coding agents (MCP)

The extension keeps a WebSocket open to Switchyard (`/browser/ws`) and sends it the tool list. Switchyard serves those tools over MCP at `/mcp`, so Claude Code, Codex and other MCP clients can drive the browser:

```sh
claude mcp add --transport http switchyard-browser http://127.0.0.1:3260/mcp
```

Tool calls from agents show up in the side panel chat marked `MCP`. Clicking or typing on a new site still needs approval: the side panel asks if it is open; otherwise the call fails with a message for the agent, unless **Let agents act on new sites without asking** is on in **Settings**. Turn the bridge off there to disconnect agents.

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
| `create_file` | Make a file (text or base64) you can download from the chat and `upload_file` can use |
| `upload_file` | Put an attached file into a file input, upload button or drop zone |
| `ask_user` | Ask you a question with options in the side panel (not offered to coding agents) |
| `screenshot` | Capture the visible tab as an image in CSS pixels |
| `wait` | Wait a number of milliseconds |

While an agent works, the tab it acts in joins the green **Switchyard** tab group (unless it is already in one of your groups), gets a green frame and a status bar at the bottom, and a cursor glides to each point before a click. Stop in that bar stops the side panel agent; for coding agents the frame goes away after 15 seconds without calls. The overlay is hidden while screenshots are taken.

`click`, `type` and `key` ask once per site per browser session before acting. They use `chrome.debugger`, so Chrome shows a "started debugging this browser" bar while the agent is working; it detaches after 30 seconds of inactivity.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push to `master` and on pull requests: typecheck, tests and build. The built `dist/` is uploaded as a workflow artifact.
- **Release** (`.github/workflows/release.yml`) runs when a `v*` tag is pushed. It checks that the tag matches the version in `package.json` and `static/manifest.json`, builds, zips `dist/` and attaches the zip to a GitHub release.

```sh
git tag v0.1.0 && git push origin v0.1.0
```
