//! `~/.todo_config.toml` — loaded with serde, written back with `toml_edit`
//! so user comments and formatting survive in-app settings changes.

use crate::scheme::ColorScheme;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = ".todo_config.toml";

/// The template written to `~/.todo_config.toml` when none exists.
pub const TEMPLATE: &str = include_str!("../../../todo_config.template.toml");

/// Which palette to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    /// Always use `light_scheme`.
    Light,
    /// Always use `dark_scheme`.
    Dark,
    /// Follow the operating system (which may itself switch by time of day).
    #[default]
    FollowOs,
}

impl Appearance {
    /// The `snake_case` identifier used in the config file.
    pub fn id(self) -> &'static str {
        match self {
            Appearance::Light => "light",
            Appearance::Dark => "dark",
            Appearance::FollowOs => "follow_os",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct Config {
    /// Directory containing the `*.md` todo files. `~` is expanded.
    pub todo_dir: PathBuf,
    pub dark_scheme: Option<ColorScheme>,
    pub light_scheme: Option<ColorScheme>,
    pub appearance: Appearance,
    pub font_size: f32,
    pub font_family: String,
    pub window: WindowConfig,
    pub tray: TrayConfig,
    pub shortcuts: ShortcutConfig,
    pub editor: EditorConfig,
    pub tabs: TabsConfig,
}

/// What the tab strip does when it is wider than the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TabOverflow {
    /// One row that scrolls horizontally.
    #[default]
    Scroll,
    /// Wrap onto as many rows as needed.
    Wrap,
}

impl TabOverflow {
    pub fn id(self) -> &'static str {
        match self {
            TabOverflow::Scroll => "scroll",
            TabOverflow::Wrap => "wrap",
        }
    }
}

/// Progress indicator shown next to each tab title.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TabBadge {
    #[default]
    None,
    /// `3/5` — completed / total.
    Ratio,
    /// `60%` — completed percentage.
    Percent,
    /// `(2)` — tasks still open.
    Remaining,
}

impl TabBadge {
    pub fn id(self) -> &'static str {
        match self {
            TabBadge::None => "none",
            TabBadge::Ratio => "ratio",
            TabBadge::Percent => "percent",
            TabBadge::Remaining => "remaining",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "snake_case")]
pub struct TabsConfig {
    pub overflow: TabOverflow,
    pub badge: TabBadge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct EditorConfig {
    /// Vim keybindings in the markdown view (normal/insert/visual modes,
    /// operators, motions, text objects, registers, `/` search, `:` commands).
    pub vim: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self { vim: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct WindowConfig {
    /// Background opacity, 0.0 (fully transparent) … 1.0 (opaque).
    pub opacity: f32,
    /// Float above every other window.
    pub always_on_top: bool,
    pub width: f64,
    pub height: f64,
    /// Corner radius of the floating panel, in px.
    pub corner_radius: f32,
    /// Launch straight into the tray without showing the window.
    pub start_hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct TrayConfig {
    /// Closing the window hides it to the tray instead of quitting.
    pub close_to_tray: bool,
    /// macOS: run as a menu-bar-only app (no Dock icon, no Cmd-Tab entry).
    pub hide_dock_icon: bool,
    /// Windows / Linux: keep the window out of the taskbar.
    pub skip_taskbar: bool,
    /// Show the window on whichever desktop/space is current when summoned,
    /// instead of switching to the desktop it was last on.
    pub visible_on_all_workspaces: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct ShortcutConfig {
    /// Global hotkey that shows/hides the window from anywhere.
    /// Set to an empty string to disable.
    pub toggle_window: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            todo_dir: PathBuf::from("~/todos"),
            dark_scheme: Some(ColorScheme::MidnightBlue),
            light_scheme: Some(ColorScheme::White),
            appearance: Appearance::FollowOs,
            font_size: 14.0,
            font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif"
                .into(),
            window: WindowConfig::default(),
            tray: TrayConfig::default(),
            shortcuts: ShortcutConfig::default(),
            editor: EditorConfig::default(),
            tabs: TabsConfig::default(),
        }
    }
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            opacity: 0.92,
            always_on_top: false,
            width: 380.0,
            height: 540.0,
            corner_radius: 12.0,
            start_hidden: false,
        }
    }
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            hide_dock_icon: true,
            skip_taskbar: true,
            visible_on_all_workspaces: true,
        }
    }
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            toggle_window: "CmdOrCtrl+Shift+Space".into(),
        }
    }
}

impl Config {
    /// `~/.todo_config.toml`
    pub fn path() -> Result<PathBuf> {
        Ok(dirs::home_dir()
            .ok_or(Error::NoHome)?
            .join(CONFIG_FILE_NAME))
    }

    /// Load the config; if the file does not exist, write the template first.
    pub fn load_or_create() -> Result<Config> {
        let path = Self::path()?;
        if !path.exists() {
            std::fs::write(&path, TEMPLATE)?;
        }
        Self::load_from(&path)
    }

    pub fn load_from(path: &Path) -> Result<Config> {
        let text = std::fs::read_to_string(path)?;
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Config> {
        let mut cfg: Config = toml::from_str(text)?;
        cfg.normalize();
        Ok(cfg)
    }

    fn normalize(&mut self) {
        self.window.opacity = self.window.opacity.clamp(0.05, 1.0);
        self.font_size = self.font_size.clamp(8.0, 40.0);
        self.window.corner_radius = self.window.corner_radius.clamp(0.0, 40.0);
        self.window.width = self.window.width.max(200.0);
        self.window.height = self.window.height.max(150.0);
    }

    /// `todo_dir` with `~` expanded to the home directory.
    pub fn todo_dir_expanded(&self) -> PathBuf {
        expand_tilde(&self.todo_dir)
    }

    pub fn dark_scheme(&self) -> ColorScheme {
        self.dark_scheme.unwrap_or(ColorScheme::MidnightBlue)
    }

    pub fn light_scheme(&self) -> ColorScheme {
        self.light_scheme.unwrap_or(ColorScheme::White)
    }

    /// Update dotted keys (e.g. `"window.opacity"`) in the config file while
    /// preserving comments/formatting. Missing tables are created.
    pub fn write_values(path: &Path, values: &[(&str, toml_edit::Value)]) -> Result<()> {
        let text = std::fs::read_to_string(path).unwrap_or_else(|_| TEMPLATE.to_string());
        let mut doc: toml_edit::DocumentMut = text.parse()?;
        for (key, value) in values {
            let mut parts = key.split('.').peekable();
            let mut table: &mut toml_edit::Table = doc.as_table_mut();
            while let Some(part) = parts.next() {
                if parts.peek().is_none() {
                    table[part] = toml_edit::value(value.clone());
                } else {
                    let entry = table.entry(part).or_insert(toml_edit::table());
                    if !entry.is_table() {
                        *entry = toml_edit::table();
                    }
                    table = entry.as_table_mut().expect("just made a table");
                    table.set_implicit(false);
                }
            }
        }
        std::fs::write(path, doc.to_string())?;
        Ok(())
    }
}

pub fn expand_tilde(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    } else if s == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    p.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_parses_to_defaults() {
        let cfg = Config::parse(TEMPLATE).unwrap();
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn empty_file_is_all_defaults() {
        let cfg = Config::parse("").unwrap();
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn partial_override() {
        let cfg = Config::parse(
            r#"
            appearance = "dark"
            dark_scheme = "forest_mist"
            [window]
            opacity = 0.5
            "#,
        )
        .unwrap();
        assert_eq!(cfg.appearance, Appearance::Dark);
        assert_eq!(cfg.dark_scheme, Some(ColorScheme::ForestMist));
        assert_eq!(cfg.window.opacity, 0.5);
        assert!(!cfg.window.always_on_top);
    }

    #[test]
    fn expand_tilde_variants() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde(Path::new("~")), home);
        assert_eq!(expand_tilde(Path::new("~/todos")), home.join("todos"));
        assert_eq!(
            expand_tilde(Path::new("/abs/path")),
            PathBuf::from("/abs/path")
        );
        assert_eq!(expand_tilde(Path::new("~user/x")), PathBuf::from("~user/x"));
        assert_eq!(
            Config::parse("todo_dir = \"~/lists\"")
                .unwrap()
                .todo_dir_expanded(),
            home.join("lists")
        );
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let cfg = Config::parse(
            "font_size = 200\n[window]\nopacity = 7\ncorner_radius = -3\nwidth = 10\nheight = 10\n",
        )
        .unwrap();
        assert_eq!(cfg.font_size, 40.0);
        assert_eq!(cfg.window.opacity, 1.0);
        assert_eq!(cfg.window.corner_radius, 0.0);
        assert_eq!(cfg.window.width, 200.0);
        assert_eq!(cfg.window.height, 150.0);
        assert_eq!(
            Config::parse("[window]\nopacity = 0\n")
                .unwrap()
                .window
                .opacity,
            0.05
        );
    }

    #[test]
    fn unknown_enum_values_are_errors_but_unknown_keys_are_ignored() {
        assert!(Config::parse("appearance = \"sepia\"").is_err());
        assert!(Config::parse("dark_scheme = \"nope\"").is_err());
        let cfg = Config::parse("future_key = 1\n[window]\nother = true\n").unwrap();
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn scheme_fallbacks_when_unset() {
        let cfg = Config::parse("dark_scheme = \"black\"").unwrap();
        assert_eq!(cfg.dark_scheme(), ColorScheme::Black);
        assert_eq!(cfg.light_scheme(), ColorScheme::White);
        assert_eq!(Config::default().dark_scheme(), ColorScheme::MidnightBlue);
    }

    #[test]
    fn write_values_creates_missing_file_from_template() {
        let dir = std::env::temp_dir().join(format!("todo-core-wv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fresh.toml");
        Config::write_values(&path, &[("tabs.badge", toml_edit::Value::from("percent"))]).unwrap();
        let cfg = Config::load_from(&path).unwrap();
        assert_eq!(cfg.tabs.badge, TabBadge::Percent);
        assert_eq!(
            cfg.todo_dir,
            PathBuf::from("~/todos"),
            "template values kept"
        );
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .starts_with("# ~/.todo_config.toml"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_values_preserves_comments() {
        let dir = std::env::temp_dir().join(format!("todo-core-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cfg.toml");
        std::fs::write(
            &path,
            "# keep me\nappearance = \"light\"\n\n[window]\n# and me\nopacity = 0.9\n",
        )
        .unwrap();
        Config::write_values(
            &path,
            &[
                ("window.opacity", toml_edit::Value::from(0.5)),
                ("window.always_on_top", toml_edit::Value::from(true)),
                ("appearance", toml_edit::Value::from("dark")),
                ("tray.close_to_tray", toml_edit::Value::from(false)),
            ],
        )
        .unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("# keep me"));
        assert!(text.contains("# and me"));
        let cfg = Config::parse(&text).unwrap();
        assert_eq!(cfg.window.opacity, 0.5);
        assert!(cfg.window.always_on_top);
        assert_eq!(cfg.appearance, Appearance::Dark);
        assert!(!cfg.tray.close_to_tray);
        std::fs::remove_dir_all(&dir).ok();
    }
}
