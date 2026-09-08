//! The todo directory: scanning `*.md` files, detecting external changes,
//! and writing atomically.

use crate::markdown::{Block, Document};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Tab order lives next to the lists, in TOML, so it is easy to hand-edit:
/// `order = ["Work", "Home"]`. Anything not listed follows alphabetically.
pub const ORDER_FILE: &str = "tabs.toml";
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
    /// Explicit tab order from `tabs.toml` (may name files that don't exist).
    order: Vec<String>,
}

/// Parse `tabs.toml` leniently: any parse error, missing key, or non-string
/// entry just means "no explicit order" for that part. Never fails.
pub fn parse_order(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let clean = |n: &str| n.trim().trim_end_matches(".md").to_string();
    let from_toml: Option<Vec<String>> = text
        .parse::<toml::Table>()
        .ok()
        .and_then(|t| t.get("order").and_then(|v| v.as_array()).cloned())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(clean).collect());
    // Corrupt TOML? Salvage whatever quoted names sit inside `order = [ … ]`.
    let raw: Vec<String> = from_toml.unwrap_or_else(|| {
        let Some(start) = text
            .find("order")
            .and_then(|i| text[i..].find('[').map(|j| i + j + 1))
        else {
            return Vec::new();
        };
        let body = &text[start..];
        let body = &body[..body.find(']').unwrap_or(body.len())];
        body.split('"').skip(1).step_by(2).map(clean).collect()
    });
    raw.into_iter()
        .filter(|n| !n.is_empty() && seen.insert(n.clone()))
        .collect()
}

fn load_order(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join(ORDER_FILE))
        .map(|t| parse_order(&t))
        .unwrap_or_default()
}

fn order_file_text(order: &[String]) -> String {
    #[derive(Serialize)]
    struct OrderFile<'a> {
        order: &'a [String],
    }
    let body = toml::to_string(&OrderFile { order }).unwrap_or_default();
    format!(
        "# Tab order for the Todo app. Lists not mentioned here follow, alphabetically.\n{body}"
    )
}

impl Store {
    /// Create a store for `dir`, creating the directory (and a welcome file
    /// if the directory is empty).
    pub fn new(dir: impl Into<PathBuf>) -> Store {
        let s = Store {
            dir: dir.into(),
            files: BTreeMap::new(),
            order: Vec::new(),
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
        self.order.clear();
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
        let order = load_order(&self.dir);
        let changed = next != self.files || order != self.order;
        self.files = next;
        self.order = order;
        changed
    }

    /// The explicit order as last read from / written to `tabs.toml`.
    pub fn order(&self) -> &[String] {
        &self.order
    }

    /// Persist a new tab order. Names that don't exist are dropped; files not
    /// mentioned keep following alphabetically.
    pub fn set_order(&mut self, names: &[String]) -> Result<()> {
        let mut seen = HashSet::new();
        let order: Vec<String> = names
            .iter()
            .filter_map(|n| sanitize_name(n).ok())
            .filter(|n| self.files.contains_key(n) && seen.insert(n.clone()))
            .collect();
        self.write_order(order)
    }

    fn write_order(&mut self, order: Vec<String>) -> Result<()> {
        if order == self.order {
            return Ok(());
        }
        atomic_write(&self.dir.join(ORDER_FILE), &order_file_text(&order))?;
        self.order = order;
        Ok(())
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
        let rank: HashMap<&str, usize> = self
            .order
            .iter()
            .enumerate()
            .map(|(i, n)| (n.as_str(), i))
            .collect();
        files.sort_by_cached_key(|f| {
            (
                rank.get(f.name.as_str()).copied().unwrap_or(usize::MAX),
                f.name.to_lowercase(),
            )
        });
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

    /// Rename `from.md` to `to.md`. Returns the sanitized new name.
    pub fn rename(&mut self, from: &str, to: &str) -> Result<String> {
        let from = sanitize_name(from)?;
        let to = sanitize_name(to)?;
        if from == to {
            return Ok(to);
        }
        let src = self.path_of(&from);
        if !src.exists() {
            return Err(Error::NotFound(from));
        }
        let dst = self.path_of(&to);
        // Allow case-only renames on case-insensitive filesystems.
        if dst.exists() && !from.eq_ignore_ascii_case(&to) {
            return Err(Error::AlreadyExists(to));
        }
        std::fs::rename(&src, &dst)?;
        if let Some(raw) = self.files.remove(&from) {
            self.files.insert(to.clone(), raw);
        }
        if self.order.contains(&from) {
            let order = self
                .order
                .iter()
                .map(|n| if *n == from { to.clone() } else { n.clone() })
                .collect();
            let _ = self.write_order(order);
        }
        Ok(to)
    }

    pub fn delete(&mut self, name: &str) -> Result<()> {
        let name = sanitize_name(name)?;
        let path = self.path_of(&name);
        if !path.exists() {
            return Err(Error::NotFound(name));
        }
        std::fs::remove_file(path)?;
        self.files.remove(&name);
        if self.order.contains(&name) {
            let order = self.order.iter().filter(|n| **n != name).cloned().collect();
            let _ = self.write_order(order);
        }
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
    fn rename() {
        let (mut s, dir) = tmp_store();
        s.scan();
        s.write_raw("Todo", "- [ ] keep me\n").unwrap();
        assert_eq!(s.rename("Todo", "Life.md").unwrap(), "Life");
        assert!(dir.join("Life.md").exists() && !dir.join("Todo.md").exists());
        assert!(!s.scan(), "rename must not register as an external change");
        assert_eq!(s.snapshot().files[0].name, "Life");
        assert_eq!(s.snapshot().files[0].raw, "- [ ] keep me\n");
        assert!(s.rename("Nope", "X").is_err());
        s.create("Work").unwrap();
        assert!(s.rename("Life", "Work").is_err(), "must not clobber");
        assert!(s.rename("Life", "../x").is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    fn names(s: &Store) -> Vec<String> {
        s.snapshot().files.into_iter().map(|f| f.name).collect()
    }

    #[test]
    fn order_file_is_lenient() {
        assert!(parse_order("").is_empty());
        assert!(parse_order("this is = not toml [").is_empty());
        assert!(parse_order("other = 1").is_empty());
        assert!(parse_order("order = 5").is_empty());
        assert_eq!(
            parse_order("order = [\"A\", \"B\"\ngarbage = [[["),
            vec!["A", "B"]
        );
        assert_eq!(
            parse_order("order = [\"A\", \"B\"] \n = broken"),
            vec!["A", "B"]
        );
        assert_eq!(
            parse_order("order = [\"B\", 3, \"A.md\", \"\", \"B\"]"),
            vec!["B", "A"]
        );
    }

    #[test]
    fn tab_order_applies_then_alphabetical() {
        let (mut s, dir) = tmp_store();
        s.scan();
        for n in ["Alpha", "beta", "Gamma"] {
            s.create(n).unwrap();
        }
        assert_eq!(names(&s), vec!["Alpha", "beta", "Gamma", "Todo"]);
        s.set_order(&["Gamma".into(), "Ghost".into(), "beta".into()])
            .unwrap();
        assert_eq!(names(&s), vec!["Gamma", "beta", "Alpha", "Todo"]);
        assert!(!s.scan(), "own order write is not an external change");
        assert!(dir.join(ORDER_FILE).exists());

        // External edit (partial list) is picked up; unknown names are ignored.
        std::fs::write(dir.join(ORDER_FILE), "order = [\"Todo\", \"Nope\"]\n").unwrap();
        assert!(s.scan());
        assert_eq!(names(&s), vec!["Todo", "Alpha", "beta", "Gamma"]);

        // Corrupt file: fall back to alphabetical, no error.
        std::fs::write(dir.join(ORDER_FILE), "order = [[[").unwrap();
        assert!(s.scan());
        assert_eq!(names(&s), vec!["Alpha", "beta", "Gamma", "Todo"]);

        // Rename and delete keep the order file in sync.
        s.set_order(&["Gamma".into(), "Alpha".into()]).unwrap();
        s.rename("Gamma", "Delta").unwrap();
        assert_eq!(names(&s), vec!["Delta", "Alpha", "beta", "Todo"]);
        s.delete("Delta").unwrap();
        assert_eq!(s.order(), &["Alpha".to_string()]);
        assert_eq!(names(&s), vec!["Alpha", "beta", "Todo"]);
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
