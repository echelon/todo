//! Built-in color schemes. Each scheme resolves to a [`Palette`] that the
//! frontend applies as CSS custom properties.

use serde::{Deserialize, Serialize};

/// The named color schemes selectable from `~/.todo_config.toml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorScheme {
    Black,
    White,
    ForestMist,
    MidnightBlue,
    Nord,
    Dracula,
    GruvboxDark,
    GruvboxLight,
    SolarizedDark,
    SolarizedLight,
    CatppuccinMocha,
    RosePineDawn,
}

/// A resolved set of colors. All values are `#rrggbb` hex strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Palette {
    pub scheme: ColorScheme,
    pub is_dark: bool,
    /// Window / page background.
    pub bg: String,
    /// Slightly raised surface (tabs, inputs, hovered rows).
    pub surface: String,
    /// Primary text.
    pub fg: String,
    /// Secondary text, completed items.
    pub muted: String,
    /// Accent: checkboxes, active tab, focus rings.
    pub accent: String,
    /// Text drawn on top of the accent color.
    pub accent_fg: String,
    /// Hairlines.
    pub border: String,
    /// Destructive actions.
    pub danger: String,
}

impl ColorScheme {
    pub const ALL: [ColorScheme; 12] = [
        ColorScheme::Black,
        ColorScheme::White,
        ColorScheme::ForestMist,
        ColorScheme::MidnightBlue,
        ColorScheme::Nord,
        ColorScheme::Dracula,
        ColorScheme::GruvboxDark,
        ColorScheme::GruvboxLight,
        ColorScheme::SolarizedDark,
        ColorScheme::SolarizedLight,
        ColorScheme::CatppuccinMocha,
        ColorScheme::RosePineDawn,
    ];

    /// The `snake_case` identifier used in the config file.
    pub fn id(self) -> &'static str {
        match self {
            ColorScheme::Black => "black",
            ColorScheme::White => "white",
            ColorScheme::ForestMist => "forest_mist",
            ColorScheme::MidnightBlue => "midnight_blue",
            ColorScheme::Nord => "nord",
            ColorScheme::Dracula => "dracula",
            ColorScheme::GruvboxDark => "gruvbox_dark",
            ColorScheme::GruvboxLight => "gruvbox_light",
            ColorScheme::SolarizedDark => "solarized_dark",
            ColorScheme::SolarizedLight => "solarized_light",
            ColorScheme::CatppuccinMocha => "catppuccin_mocha",
            ColorScheme::RosePineDawn => "rose_pine_dawn",
        }
    }

    /// Human readable name.
    pub fn label(self) -> &'static str {
        match self {
            ColorScheme::Black => "Black",
            ColorScheme::White => "White",
            ColorScheme::ForestMist => "Forest Mist",
            ColorScheme::MidnightBlue => "Midnight Blue",
            ColorScheme::Nord => "Nord",
            ColorScheme::Dracula => "Dracula",
            ColorScheme::GruvboxDark => "Gruvbox Dark",
            ColorScheme::GruvboxLight => "Gruvbox Light",
            ColorScheme::SolarizedDark => "Solarized Dark",
            ColorScheme::SolarizedLight => "Solarized Light",
            ColorScheme::CatppuccinMocha => "Catppuccin Mocha",
            ColorScheme::RosePineDawn => "Rosé Pine Dawn",
        }
    }

    pub fn is_dark(self) -> bool {
        !matches!(
            self,
            ColorScheme::White
                | ColorScheme::GruvboxLight
                | ColorScheme::SolarizedLight
                | ColorScheme::RosePineDawn
        )
    }

    pub fn palette(self) -> Palette {
        // (bg, surface, fg, muted, accent, accent_fg, border, danger)
        let c: [&str; 8] = match self {
            ColorScheme::Black => [
                "#000000", "#121212", "#f2f2f2", "#8a8a8a", "#7dd3fc", "#00131a", "#262626",
                "#f87171",
            ],
            ColorScheme::White => [
                "#ffffff", "#f4f4f5", "#18181b", "#71717a", "#2563eb", "#ffffff", "#e4e4e7",
                "#dc2626",
            ],
            ColorScheme::ForestMist => [
                "#0f1a14", "#182419", "#d9e5dc", "#7f9a88", "#6fcf97", "#06120b", "#243428",
                "#f08080",
            ],
            ColorScheme::MidnightBlue => [
                "#0b1220", "#141d31", "#dbe4f3", "#7f8fae", "#5b9dff", "#04101f", "#22304c",
                "#ff6b6b",
            ],
            ColorScheme::Nord => [
                "#2e3440", "#3b4252", "#eceff4", "#9199a8", "#88c0d0", "#2e3440", "#434c5e",
                "#bf616a",
            ],
            ColorScheme::Dracula => [
                "#282a36", "#343746", "#f8f8f2", "#6272a4", "#bd93f9", "#282a36", "#44475a",
                "#ff5555",
            ],
            ColorScheme::GruvboxDark => [
                "#282828", "#3c3836", "#ebdbb2", "#a89984", "#fabd2f", "#282828", "#504945",
                "#fb4934",
            ],
            ColorScheme::GruvboxLight => [
                "#fbf1c7", "#f2e5bc", "#3c3836", "#7c6f64", "#d65d0e", "#fbf1c7", "#e6d9a8",
                "#cc241d",
            ],
            ColorScheme::SolarizedDark => [
                "#002b36", "#073642", "#eee8d5", "#839496", "#2aa198", "#002b36", "#0f4553",
                "#dc322f",
            ],
            ColorScheme::SolarizedLight => [
                "#fdf6e3", "#eee8d5", "#073642", "#93a1a1", "#268bd2", "#fdf6e3", "#e3dcc5",
                "#dc322f",
            ],
            ColorScheme::CatppuccinMocha => [
                "#1e1e2e", "#313244", "#cdd6f4", "#a6adc8", "#cba6f7", "#1e1e2e", "#45475a",
                "#f38ba8",
            ],
            ColorScheme::RosePineDawn => [
                "#faf4ed", "#fffaf3", "#575279", "#9893a5", "#d7827e", "#faf4ed", "#efe6dd",
                "#b4637a",
            ],
        };
        Palette {
            scheme: self,
            is_dark: self.is_dark(),
            bg: c[0].into(),
            surface: c[1].into(),
            fg: c[2].into(),
            muted: c[3].into(),
            accent: c[4].into(),
            accent_fg: c[5].into(),
            border: c[6].into(),
            danger: c[7].into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip_through_serde() {
        for s in ColorScheme::ALL {
            let json = serde_json_like(s);
            assert_eq!(json, s.id());
        }
    }

    fn serde_json_like(s: ColorScheme) -> String {
        // toml::Value renders enum unit variants as strings.
        toml::Value::try_from(s)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn every_palette_is_hex() {
        for s in ColorScheme::ALL {
            let p = s.palette();
            for v in [
                &p.bg,
                &p.surface,
                &p.fg,
                &p.muted,
                &p.accent,
                &p.accent_fg,
                &p.border,
                &p.danger,
            ] {
                assert_eq!(v.len(), 7, "{s:?}: {v}");
                assert!(v.starts_with('#'));
            }
        }
    }
}
