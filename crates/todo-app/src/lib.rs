//! Tauri shell around `todo-core`: IPC commands, tray icon, file watcher,
//! global shortcut and window management.

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime};

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State, WebviewWindow, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use todo_core::{Appearance, Block, ColorScheme, Config, Palette, Snapshot, Store};

const MAIN: &str = "main";
const EV_SNAPSHOT: &str = "todo:snapshot";
const EV_CONFIG: &str = "todo:config";
const EV_ERROR: &str = "todo:error";
/// Fallback poll interval when the OS watcher misses events (network drives…).
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
/// Coalesce bursts of filesystem events (editors write several times).
const DEBOUNCE: Duration = Duration::from_millis(40);

pub struct AppState {
    store: Mutex<Store>,
    config: Mutex<Config>,
    config_mtime: Mutex<Option<SystemTime>>,
}

struct TrayItems {
    always_on_top: CheckMenuItem<Wry>,
}

#[derive(Serialize, Clone)]
struct SchemeInfo {
    id: &'static str,
    label: &'static str,
    is_dark: bool,
}

#[derive(Serialize, Clone)]
pub struct ConfigPayload {
    config: Config,
    light: Palette,
    dark: Palette,
    schemes: Vec<SchemeInfo>,
    config_path: String,
    platform: &'static str,
}

#[derive(Serialize, Clone)]
pub struct CreateResult {
    name: String,
    snapshot: Snapshot,
}

/// Settings the in-app popover can change. Each is written back to
/// `~/.todo_config.toml` (comments preserved) and applied live.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "snake_case")]
pub struct SettingsPatch {
    appearance: Option<Appearance>,
    light_scheme: Option<ColorScheme>,
    dark_scheme: Option<ColorScheme>,
    opacity: Option<f32>,
    always_on_top: Option<bool>,
    font_size: Option<f32>,
    close_to_tray: Option<bool>,
    visible_on_all_workspaces: Option<bool>,
    vim: Option<bool>,
}

fn payload(cfg: &Config) -> ConfigPayload {
    ConfigPayload {
        config: cfg.clone(),
        light: cfg.light_scheme().palette(),
        dark: cfg.dark_scheme().palette(),
        schemes: ColorScheme::ALL
            .iter()
            .map(|s| SchemeInfo {
                id: s.id(),
                label: s.label(),
                is_dark: s.is_dark(),
            })
            .collect(),
        config_path: Config::path()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        platform: std::env::consts::OS,
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ───────────────────────────── commands ─────────────────────────────

#[tauri::command]
fn get_config(state: State<AppState>) -> ConfigPayload {
    payload(&state.config.lock().unwrap())
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    let mut store = state.store.lock().unwrap();
    store.scan();
    store.snapshot()
}

#[tauri::command]
fn save_blocks(state: State<AppState>, name: String, blocks: Vec<Block>) -> Result<String, String> {
    state
        .store
        .lock()
        .unwrap()
        .write_blocks(&name, blocks)
        .map_err(err)
}

#[tauri::command]
fn save_raw(state: State<AppState>, name: String, raw: String) -> Result<Vec<Block>, String> {
    state
        .store
        .lock()
        .unwrap()
        .write_raw(&name, &raw)
        .map_err(err)
}

#[tauri::command]
fn create_file(state: State<AppState>, name: String) -> Result<CreateResult, String> {
    let mut store = state.store.lock().unwrap();
    let name = store.create(&name).map_err(err)?;
    Ok(CreateResult {
        name,
        snapshot: store.snapshot(),
    })
}

#[tauri::command]
fn rename_file(state: State<AppState>, from: String, to: String) -> Result<CreateResult, String> {
    let mut store = state.store.lock().unwrap();
    let name = store.rename(&from, &to).map_err(err)?;
    Ok(CreateResult {
        name,
        snapshot: store.snapshot(),
    })
}

#[tauri::command]
fn set_tab_order(state: State<AppState>, names: Vec<String>) -> Result<Snapshot, String> {
    let mut store = state.store.lock().unwrap();
    store.set_order(&names).map_err(err)?;
    Ok(store.snapshot())
}

#[tauri::command]
fn delete_file(state: State<AppState>, name: String) -> Result<Snapshot, String> {
    let mut store = state.store.lock().unwrap();
    store.delete(&name).map_err(err)?;
    Ok(store.snapshot())
}

#[tauri::command]
fn update_settings(app: AppHandle, patch: SettingsPatch) -> Result<ConfigPayload, String> {
    use toml_edit::Value;
    let mut values: Vec<(&str, Value)> = Vec::new();
    if let Some(v) = patch.appearance {
        values.push(("appearance", Value::from(v.id())));
    }
    if let Some(v) = patch.light_scheme {
        values.push(("light_scheme", Value::from(v.id())));
    }
    if let Some(v) = patch.dark_scheme {
        values.push(("dark_scheme", Value::from(v.id())));
    }
    if let Some(v) = patch.opacity {
        values.push(("window.opacity", Value::from(v.clamp(0.05, 1.0) as f64)));
    }
    if let Some(v) = patch.always_on_top {
        values.push(("window.always_on_top", Value::from(v)));
    }
    if let Some(v) = patch.font_size {
        values.push(("font_size", Value::from(v.clamp(8.0, 40.0) as f64)));
    }
    if let Some(v) = patch.close_to_tray {
        values.push(("tray.close_to_tray", Value::from(v)));
    }
    if let Some(v) = patch.visible_on_all_workspaces {
        values.push(("tray.visible_on_all_workspaces", Value::from(v)));
    }
    if let Some(v) = patch.vim {
        values.push(("editor.vim", Value::from(v)));
    }
    let path = Config::path().map_err(err)?;
    Config::write_values(&path, &values).map_err(err)?;
    reload_config(&app).map_err(err)
}

/// Called by the frontend once the theme has been painted, so the window
/// never flashes white.
#[tauri::command]
fn window_ready(app: AppHandle, state: State<AppState>) {
    let start_hidden = state.config.lock().unwrap().window.start_hidden;
    if !start_hidden {
        if let Some(w) = app.get_webview_window(MAIN) {
            show_window(&w);
        }
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn open_config() -> Result<(), String> {
    open_path(&Config::path().map_err(err)?, true)
}

#[tauri::command]
fn open_todo_dir(state: State<AppState>) -> Result<(), String> {
    let dir = state.store.lock().unwrap().dir().to_path_buf();
    open_path(&dir, false)
}

/// Frontend diagnostics land in the terminal.
#[tauri::command]
fn log(msg: String) {
    eprintln!("[ui] {msg}");
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ───────────────────────────── helpers ─────────────────────────────

fn open_path(p: &Path, as_text: bool) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        if as_text {
            c.arg("-t");
        }
        c.arg(p);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let _ = as_text;
        let mut c = Command::new("cmd");
        c.args(["/C", "start", ""]).arg(p);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let _ = as_text;
        let mut c = Command::new("xdg-open");
        c.arg(p);
        c
    };
    cmd.spawn().map(|_| ()).map_err(err)
}

fn show_window(w: &WebviewWindow) {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}

/// Tray click / global hotkey: hide if focused, otherwise bring to front on
/// the *current* desktop.
fn toggle_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN) else {
        return;
    };
    let visible = w.is_visible().unwrap_or(false);
    let focused = w.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = w.hide();
    } else {
        show_window(&w);
    }
}

fn config_mtime() -> Option<SystemTime> {
    Config::path()
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
}

fn apply_window_config(app: &AppHandle, cfg: &Config) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.set_always_on_top(cfg.window.always_on_top);
        let _ = w.set_visible_on_all_workspaces(cfg.tray.visible_on_all_workspaces);
        #[cfg(not(target_os = "macos"))]
        let _ = w.set_skip_taskbar(cfg.tray.skip_taskbar);
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.always_on_top.set_checked(cfg.window.always_on_top);
    }
    apply_shortcut(app, cfg);
}

fn apply_shortcut(app: &AppHandle, cfg: &Config) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let accel = cfg.shortcuts.toggle_window.trim();
    if accel.is_empty() {
        return;
    }
    let result = gs.on_shortcut(accel, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_window(app);
        }
    });
    if let Err(e) = result {
        let msg = format!("Could not register shortcut {accel:?}: {e}");
        eprintln!("{msg}");
        let _ = app.emit(EV_ERROR, msg);
    }
}

/// Re-read `~/.todo_config.toml`, apply it, and notify the UI.
/// On a parse error the previous config stays in effect and the UI is told.
fn reload_config(app: &AppHandle) -> todo_core::Result<ConfigPayload> {
    let state = app.state::<AppState>();
    *state.config_mtime.lock().unwrap() = config_mtime();
    let cfg = match Config::load_or_create() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(EV_ERROR, format!("Config error: {e}"));
            return Err(e);
        }
    };
    let dir_changed = {
        let mut current = state.config.lock().unwrap();
        let changed = current.todo_dir_expanded() != cfg.todo_dir_expanded();
        *current = cfg.clone();
        changed
    };
    if dir_changed {
        let mut store = state.store.lock().unwrap();
        store.set_dir(cfg.todo_dir_expanded());
        store.scan();
        let _ = app.emit(EV_SNAPSHOT, store.snapshot());
    }
    apply_window_config(app, &cfg);
    let p = payload(&cfg);
    let _ = app.emit(EV_CONFIG, &p);
    Ok(p)
}

/// One background thread: OS file notifications for the todo directory,
/// plus a 1 s poll as a safety net, plus config-file mtime polling.
fn spawn_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("todo-watcher".into())
        .spawn(move || {
            let (tx, rx) = mpsc::channel::<()>();
            let mut watcher =
                notify::recommended_watcher(move |_res: notify::Result<notify::Event>| {
                    let _ = tx.send(());
                })
                .ok();
            let mut watched: Option<PathBuf> = None;

            loop {
                let state = app.state::<AppState>();

                // (Re)attach the watcher if the directory changed.
                let dir = state.store.lock().unwrap().dir().to_path_buf();
                if watched.as_ref() != Some(&dir) {
                    if let Some(w) = watcher.as_mut() {
                        if let Some(old) = &watched {
                            let _ = w.unwatch(old);
                        }
                        let _ = w.watch(&dir, RecursiveMode::NonRecursive);
                    }
                    watched = Some(dir);
                }

                match rx.recv_timeout(POLL_INTERVAL) {
                    Ok(()) => {
                        // Debounce: swallow the burst, then scan once.
                        std::thread::sleep(DEBOUNCE);
                        while rx.try_recv().is_ok() {}
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        std::thread::sleep(POLL_INTERVAL);
                    }
                }

                // Config file changed on disk?
                let known = *state.config_mtime.lock().unwrap();
                let now = config_mtime();
                if now != known {
                    let _ = reload_config(&app);
                }

                // Todo files changed on disk (own writes are filtered by content)?
                let snapshot = {
                    let mut store = state.store.lock().unwrap();
                    store.scan().then(|| store.snapshot())
                };
                if let Some(snap) = snapshot {
                    let _ = app.emit(EV_SNAPSHOT, snap);
                }
            }
        })
        .expect("spawn watcher thread");
}

fn build_tray(app: &tauri::App, cfg: &Config) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(
        app,
        "on_top",
        "Always on Top",
        true,
        cfg.window.always_on_top,
        None::<&str>,
    )?;
    let open_cfg = MenuItem::with_id(app, "open_config", "Edit Config…", true, None::<&str>)?;
    let open_dir = MenuItem::with_id(app, "open_dir", "Open Todo Folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Todo", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &on_top,
            &PredefinedMenuItem::separator(app)?,
            &open_cfg,
            &open_dir,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayItems {
        always_on_top: on_top.clone(),
    });

    #[cfg(target_os = "macos")]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/32x32.png"
        ))?);

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Todo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_window(app),
            "on_top" => {
                let checked = app
                    .try_state::<TrayItems>()
                    .and_then(|t| t.always_on_top.is_checked().ok())
                    .unwrap_or(false);
                let _ = update_settings(
                    app.clone(),
                    SettingsPatch {
                        always_on_top: Some(checked),
                        ..Default::default()
                    },
                );
            }
            "open_config" => {
                let _ = open_config();
            }
            "open_dir" => {
                let _ = open_todo_dir(app.state::<AppState>());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let config = Config::load_or_create().unwrap_or_else(|e| {
        eprintln!("Could not load ~/.todo_config.toml ({e}); using defaults");
        Config::default()
    });
    let mut store = Store::new(config.todo_dir_expanded());
    store.scan();

    let state = AppState {
        store: Mutex::new(store),
        config: Mutex::new(config),
        config_mtime: Mutex::new(config_mtime()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_snapshot,
            save_blocks,
            save_raw,
            create_file,
            rename_file,
            set_tab_order,
            delete_file,
            update_settings,
            window_ready,
            hide_window,
            open_config,
            open_todo_dir,
            log,
            quit,
        ])
        .setup(|app| {
            let cfg = app.state::<AppState>().config.lock().unwrap().clone();

            #[cfg(target_os = "macos")]
            if cfg.tray.hide_dock_icon {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.set_size(LogicalSize::new(cfg.window.width, cfg.window.height));
                let _ = w.center();
            }
            build_tray(app, &cfg)?;
            apply_window_config(app.handle(), &cfg);
            spawn_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .state::<AppState>()
                    .config
                    .lock()
                    .unwrap()
                    .tray
                    .close_to_tray;
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Todo");
}
