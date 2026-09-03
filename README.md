# pi-favs

A pi extension for keeping a short list of files and directories handy. `/favs` opens the selected favorite with `hx` in a new Herdr tab.

## Install

```bash
pi install /path/to/pi-favs
# or, after publishing:
pi install npm:pi-favs
```

The extension must run inside Herdr because it uses the current `HERDR_WORKSPACE_ID` to create a tab.

## Configure

Create `~/.pi/agent/pi-favs.json` (or `$PI_CODING_AGENT_DIR/pi-favs.json`):

```json
{
  "favorites": [
    { "name": "Pi source", "path": "~/src/pi" },
    { "name": "Tasks extension", "path": "~/src/pi/pi-tasks" },
    { "name": "Agent settings", "path": "~/.pi/agent/settings.json" }
  ]
}
```

String entries are also accepted:

```json
["~/src/pi/pi-favs", "~/.pi/agent/AGENTS.md"]
```

Paths may be absolute or relative to the config file. `~` and `$HOME` are expanded. Existing project-local favorites can be added in `.pi/favs.json`; they are merged after global favorites when the project is trusted. A project entry with the same path replaces its global entry.

## Use

Run `/favs` to open the guided picker. Just type to filter favorites by name, use Backspace to edit the filter, and press Ctrl+U to clear it. The first item, **＋ Add a favorite…**, walks through:

1. File or folder
2. Path
3. Display name
4. Global or trusted project config
5. Optional immediate open

You can also start the flow directly with `/favs add`. Existing favorites open in a focused Herdr tab rooted at their directory and start Helix there. Pass text after the command to filter the list, for example `/favs tasks`.

Set `PI_FAVS_HX_BIN` if `hx` is not on `PATH`.
