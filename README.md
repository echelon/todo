# Todo

A tiny, blazingly fast, tray-centric todo app. Your lists are plain markdown
files; edit them in the app or in any editor and both stay in sync.

- **Rust workspace**: `todo-core` (config, palettes, markdown model, storage —
  no UI deps, fully unit-tested) and `todo-app` (the Tauri 2 shell).
- **Zero-framework frontend**: three static files in `ui/`, no bundler, no
  `node_modules` at build time. The list view is ~700 lines of vanilla JS;
  the markdown view lazy-loads a prebuilt CodeMirror 6 + vim bundle
  (`ui/vendor/editor.js`, rebuilt from `tools/editor` with `npm run build`).
- **Markdown is the database**:

  ```markdown
  # Heading

  - [ ] Todo item
  - [x] Completed todo item
  ```

  Every `*.md` in your todo directory is a tab. Unknown lines pass through
  untouched, so the app never mangles your files. Drag tabs left or right to
  reorder them; the order is kept in `tabs.toml` next to the lists
  (`order = ["Work", "Home"]`). Anything not listed follows alphabetically,
  and a missing or broken `tabs.toml` simply means alphabetical.

## Features

- Rendered list view with pointer-based drag & drop reordering, click-to-edit,
  Enter to insert the next item, hover ✕ to delete (with confirmation).
- Nested todos: indent with two spaces in markdown, or `Tab` / `Shift+Tab`
  while editing an item. Dragging a parent moves its whole subtree. To nest
  while dragging, either drop slightly to the right below another item, or
  hover over the middle of an item until it shows "drop inside" and release
  to file it as that item's last child. `---` renders as a divider.
- Markdown view (`⌘/Ctrl+E`) is a CodeMirror 6 editor with **vim
  keybindings** (normal / insert / visual / visual-line / visual-block,
  operators, motions, text objects, counts, registers, `.` repeat, `/` `?` `n`
  `N` search, `:s`, marks; `:w` saves, `:q` returns to the list). Enter
  continues `- [ ]` lists. Saves as you type. Toggle vim in settings or with
  `editor.vim` in the config. Deleting there is immediate, as you'd expect
  from a text editor.
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

| `editor.vim` | `true` | vim keybindings in the markdown view |

**Dark schemes**: `black`, `forest_mist`, `midnight_blue`, `nord`, `dracula`,
`gruvbox_dark`, `solarized_dark`, `catppuccin_mocha`, `molokai_dark`.
**Light schemes**: `white`, `forest_light`, `gruvbox_light`,
`solarized_light`, `rose_pine_dawn`, `molokai_light`, `sepia`, `lavender`,
`ocean_light`, `sunrise`, `nord_light`, `catppuccin_latte`.

## Keyboard

| keys | action |
| --- | --- |
| `⌘/Ctrl+E` | toggle list / markdown view |
| `⌘/Ctrl+N` | focus the "Add a todo" field |
| `⌘/Ctrl+Shift+N` | new list (file) |
| `⌘/Ctrl+1…9` | switch tab |
| `⌘/Ctrl+,` | settings |
| `Enter` while editing | commit and start the next item |
| `Tab` / `Shift+Tab` while editing | nest / un-nest the item (and its subtree) |
| `Esc` | cancel edit / close popover / hide to tray |
| `⌘/Ctrl+Shift+Space` | global: show / hide |
| double-click a tab | rename that list (renames the `.md` file) |
| right-click a tab | menu: rename / delete that list |

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
