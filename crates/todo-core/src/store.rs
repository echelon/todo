//! The todo directory: scanning `*.md` files, detecting external changes,
//! and writing atomically.

use crate::markdown::{Block, Document};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const WELCOME_FILE: &str = "Todo.md";
pub const WELCOME_CONTENT: &str = "# Todo\n\n- [ ] Drag me around\n- [ ] Click a checkbox\n- [ ] Click text to edit, press Enter for a new item\n- [ ] Switch to Markdown view (⌘/Ctrl+E) and edit the raw file\n- [x] Install the app\n";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoFile {
    /// File name without the `.md` extension. Doubles as the tab title.
    pub name: String,
    pub raw: String,
    pub blocks: Vec<Block>,
}

/// Everything the UI needs to render: the directory and all files, sorted by
/// name (case-insensitive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub dir: String,
    pub files: Vec<TodoFile>,
}

#[derive(Debug)]
pub struct Store {
    dir: PathBuf,
    /// name → raw content as last seen (either read from disk or written by us).
    files: BTreeMap<String, String>,
}

impl Store {
    /// Create a store for `dir`, creating the directory (and a welcome file
    /// if the directory is empty).
    pub fn new(dir: impl Into<PathBuf>) -> Store {
        let s = Store {
            dir: dir.into(),
            files: BTreeMap::new(),
        };
        s.ensure_dir();
        s
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn set_dir(&mut self, dir: impl Into<PathBuf>) {
        self.dir = dir.into();
        self.files.clear();
        self.ensure_dir();
    }

    fn ensure_dir(&self) {
        if std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let has_md = std::fs::read_dir(&self.dir)
            .map(|rd| rd.flatten().any(|e| is_md(&e.path())))
            .unwrap_or(false);
        if !has_md {
            let _ = atomic_write(&self.dir.join(WELCOME_FILE), WELCOME_CONTENT);
        }
    }

    /// Re-read every `*.md` file. Returns `true` if anything differs from
    /// what we last knew (including our own writes, which therefore do not
    /// register as changes).
    pub fn scan(&mut self) -> bool {
        let mut next = BTreeMap::new();
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                if !is_md(&path) {
                    continue;
                }
                let Some(name) = name_of(&path) else { continue };
                if let Ok(raw) = std::fs::read_to_string(&path) {
                    next.insert(name, raw);
                }
            }
        }
        let changed = next != self.files;
        self.files = next;
        changed
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut files: Vec<TodoFile> = self
            .files
            .iter()
            .map(|(name, raw)| TodoFile {
                name: name.clone(),
                raw: raw.clone(),
                blocks: Document::parse(raw).blocks,
            })
            .collect();
        files.sort_by_cached_key(|f| f.name.to_lowercase());
        Snapshot {
            dir: self.dir.to_string_lossy().into_owned(),
            files,
        }
    }

    pub fn contains(&self, name: &str) -> bool {
        self.files.contains_key(name)
    }

    pub fn path_of(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.md"))
    }

    /// Write raw markdown for `name`. Returns the parsed blocks.
    pub fn write_raw(&mut self, name: &str, raw: &str) -> Result<Vec<Block>> {
        let name = sanitize_name(name)?;
        let raw = raw.replace("\r\n", "\n");
        atomic_write(&self.path_of(&name), &raw)?;
        let blocks = Document::parse(&raw).blocks;
        self.files.insert(name, raw);
        Ok(blocks)
    }

    /// Serialize `blocks` and write them for `name`. Returns the raw markdown.
    pub fn write_blocks(&mut self, name: &str, blocks: Vec<Block>) -> Result<String> {
        let name = sanitize_name(name)?;
        let raw = Document::from_blocks(blocks).to_markdown();
        atomic_write(&self.path_of(&name), &raw)?;
        self.files.insert(name, raw.clone());
        Ok(raw)
    }

    pub fn create(&mut self, name: &str) -> Result<String> {
        let name = sanitize_name(name)?;
        if self.contains(&name) || self.path_of(&name).exists() {
            return Err(Error::AlreadyExists(name));
        }
        let raw = format!("# {name}\n\n");
        atomic_write(&self.path_of(&name), &raw)?;
        self.files.insert(name.clone(), raw);
        Ok(name)
    }

    pub fn delete(&mut self, name: &str) -> Result<()> {
        let name = sanitize_name(name)?;
        let path = self.path_of(&name);
        if !path.exists() {
            return Err(Error::NotFound(name));
        }
        std::fs::remove_file(path)?;
        self.files.remove(&name);
        Ok(())
    }
}

fn is_md(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        && !path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(true)
}

fn name_of(path: &Path) -> Option<String> {
    path.file_stem().map(|s| s.to_string_lossy().into_owned())
}

/// Tab/file names may not contain path separators or be empty/hidden.
pub fn sanitize_name(name: &str) -> Result<String> {
    let name = name.trim().trim_end_matches(".md").trim();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', '\0']) || name == ".."
    {
        return Err(Error::InvalidName(name.to_string()));
    }
    Ok(name.to_string())
}

/// Write via a temp file + rename so watchers/readers never see a torn file.
pub fn atomic_write(path: &Path, content: &str) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| Error::InvalidName(path.display().to_string()))?;
    std::fs::create_dir_all(dir)?;
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{file_name}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, content)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_store() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "todo-store-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        (Store::new(&dir), dir)
    }

    #[test]
    fn creates_welcome_file_and_scans() {
        let (mut s, dir) = tmp_store();
        assert!(s.scan());
        let snap = s.snapshot();
        assert_eq!(snap.files.len(), 1);
        assert_eq!(snap.files[0].name, "Todo");
        assert!(!s.scan(), "second scan must report no change");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn own_writes_do_not_count_as_changes_but_external_do() {
        let (mut s, dir) = tmp_store();
        s.scan();
        s.write_blocks("Todo", vec![Block::task("one")]).unwrap();
        assert!(!s.scan());
        std::fs::write(dir.join("Todo.md"), "- [x] external\n").unwrap();
        assert!(s.scan());
        assert_eq!(
            s.snapshot().files[0].blocks,
            vec![Block::Task {
                done: true,
                text: "external".into(),
                indent: "".into()
            }]
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn create_delete_and_sanitize() {
        let (mut s, dir) = tmp_store();
        s.scan();
        assert_eq!(s.create("Work.md").unwrap(), "Work");
        assert!(s.create("Work").is_err());
        assert!(s.create("../evil").is_err());
        assert!(s.create(".hidden").is_err());
        assert!(dir.join("Work.md").exists());
        s.delete("Work").unwrap();
        assert!(!dir.join("Work.md").exists());
        assert!(s.delete("Work").is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn hidden_and_non_md_ignored() {
        let (mut s, dir) = tmp_store();
        std::fs::write(dir.join(".secret.md"), "- [ ] x").unwrap();
        std::fs::write(dir.join("notes.txt"), "- [ ] x").unwrap();
        s.scan();
        assert_eq!(s.snapshot().files.len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }
}
