//! Core library for the Todo app: configuration, color schemes,
//! the markdown document model and the on-disk store.
//!
//! Everything in here is UI-agnostic and fully unit tested, so the Tauri
//! crate is a thin shell around it.

pub mod config;
pub mod markdown;
pub mod scheme;
pub mod store;

pub use config::{
    Appearance, Config, EditorConfig, ShortcutConfig, TabOverflow, TabsConfig, TrayConfig,
    WindowConfig,
};
pub use markdown::{Block, Document};
pub use scheme::{ColorScheme, Palette};
pub use store::{parse_order, parse_tabs_file, Snapshot, Store, TabsFile, TodoFile, ORDER_FILE};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("config parse error: {0}")]
    TomlParse(#[from] toml::de::Error),
    #[error("config edit error: {0}")]
    TomlEdit(#[from] toml_edit::TomlError),
    #[error("could not determine home directory")]
    NoHome,
    #[error("invalid file name: {0}")]
    InvalidName(String),
    #[error("no such file: {0}")]
    NotFound(String),
    #[error("file already exists: {0}")]
    AlreadyExists(String),
}

pub type Result<T> = std::result::Result<T, Error>;
