# switchyard-extension

Chrome extension that lets [Switchyard](https://github.com/kravchenski/switchyard) models and coding agents work with your browser: tabs, tab groups, navigation, and (in later stages) reading and acting on pages.

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
