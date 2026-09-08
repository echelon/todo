# Todo

A tiny, blazingly fast, tray-centric todo app. Your lists are plain markdown
files; edit them in the app or in any editor and both stay in sync.

- **Rust workspace**: `todo-core` (config, palettes, markdown model, storage —
  no UI deps, fully unit-tested) and `todo-app` (the Tauri 2 shell).
- **Zero-framework frontend**: three static files in `ui/`, no bundler, no
  `node_modules`. The whole UI is ~600 lines of vanilla JS.
- **Markdown is the database**:

  ```markdown
  # Heading

  - [ ] Todo item
  - [x] Completed todo item
  ```

  Every `*.md` in your todo directory is a tab. Unknown lines pass through
  untouched, so the app never mangles your files.

## Features

- Rendered list view with pointer-based drag & drop reordering, click-to-edit,
  Enter to insert the next item, hover ✕ to delete (with confirmation).
- Markdown view (`⌘/Ctrl+E`) editing the raw file, saved as you type. Deleting
  there is immediate, as you'd expect from a text editor.
- Live sync: the todo directory is watched (OS notifications + a 1 s poll as a
  safety net). External edits appear instantly; the app's own writes are
  filtered so nothing flickers. Writes are atomic (temp file + rename).
- Chrome-less, transparent, rounded window. Grab any empty area to move it.
- Tray icon: left-click to summon/hide, right-click for the menu. On macOS the
  app is menu-bar-only (no Dock icon) and the window joins **every desktop /
  space**, so summoning it never switches you away from what you're doing.
- Global hotkey (`⌘/Ctrl+Shift+Space` by default) to toggle from anywhere.
- Always-on-top pin, custom background opacity, 12 color schemes with
  light/dark/follow-OS selection, font size & family — all in one TOML file
  that the app also watches and applies live.

## Configuration — `~/.todo_config.toml`

Created from [`todo_config.template.toml`](todo_config.template.toml) on first
launch. Everything is optional. In-app settings changes are written back with
comments preserved.

| key | default | notes |
| --- | --- | --- |
| `todo_dir` | `"~/todos"` | every `*.md` here becomes a tab |
| `appearance` | `"follow_os"` | `"light"`, `"dark"`, or `"follow_os"` (follows the OS, which may switch by time of day) |
| `light_scheme` / `dark_scheme` | `"white"` / `"midnight_blue"` | see schemes below |
| `font_size` / `font_family` | `14.0` / system stack | |
| `window.opacity` | `0.92` | `0.0` transparent … `1.0` solid |
| `window.always_on_top` | `false` | |
| `window.width` / `height` / `corner_radius` | `380` / `540` / `12` | |
| `window.start_hidden` | `false` | launch straight into the tray |
| `tray.close_to_tray` | `true` | closing hides instead of quitting |
| `tray.hide_dock_icon` | `true` | macOS menu-bar-only app (restart to apply) |
| `tray.skip_taskbar` | `true` | Windows/Linux |
| `tray.visible_on_all_workspaces` | `true` | summon on the current desktop |
| `shortcuts.toggle_window` | `"CmdOrCtrl+Shift+Space"` | `""` disables |

**Schemes**: `black`, `white`, `forest_mist`, `midnight_blue`, `nord`,
`dracula`, `gruvbox_dark`, `gruvbox_light`, `solarized_dark`,
`solarized_light`, `catppuccin_mocha`, `rose_pine_dawn`.

## Keyboard

| keys | action |
| --- | --- |
| `⌘/Ctrl+E` | toggle list / markdown view |
| `⌘/Ctrl+N` | focus the "Add a todo" field |
| `⌘/Ctrl+Shift+N` | new list (file) |
| `⌘/Ctrl+1…9` | switch tab |
| `⌘/Ctrl+,` | settings |
| `Enter` while editing | commit and start the next item |
| `Esc` | cancel edit / close popover / hide to tray |
| `⌘/Ctrl+Shift+Space` | global: show / hide |
| right-click a tab | delete that list |

## Building

Prerequisites: Rust stable, `cargo install tauri-cli --version "^2"`, and the
[Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/)
(Xcode CLT on macOS; WebView2 + MSVC on Windows; `webkit2gtk-4.1`,
`libappindicator3`, `librsvg2` on Linux). No Node.js required.

```sh
make run     # debug binary
make dev     # tauri dev (live-reloads ui/)
make build   # release build + installers (.dmg/.app, .msi/.exe, .deb/.rpm/.AppImage)
make test
```

Installers land in `target/release/bundle/`.

To iterate on the UI without Tauri, serve the repo root
(`python3 -m http.server 8765`) and open
`http://localhost:8765/tools/harness/harness.html` — it runs `ui/` against a
mocked backend; add `?autotest` to run the scripted interaction checks.

### Platform notes

- **macOS**: transparency uses `macOSPrivateApi` (fine for direct
  distribution; not App Store). The window is `CanJoinAllSpaces`.
- **Windows**: transparency works via WebView2; `skip_taskbar` hides the window
  from the taskbar so the tray is the entry point.
- **Linux**: transparency needs a compositor; "visible on all workspaces" is
  honoured by most WMs (sticky window). Tray requires an AppIndicator host.
