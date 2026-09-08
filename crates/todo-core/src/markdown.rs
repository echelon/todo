//! Line-oriented markdown model. The parser is deliberately tiny and
//! allocation-light: every line maps to exactly one [`Block`], and
//! `Document::to_markdown` reproduces the input byte-for-byte for the
//! constructs we understand (headings, task items) while passing every
//! other line through untouched.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    /// `# Heading` … `###### Heading`
    Heading { level: u8, text: String },
    /// `- [ ] text` / `- [x] text`, with the leading whitespace preserved
    /// so nested lists round-trip.
    Task {
        done: bool,
        text: String,
        indent: String,
    },
    /// `---` / `***` / `___` — a horizontal rule. The original text is kept.
    Rule { text: String },
    /// Any other non-empty line, passed through verbatim.
    Text { text: String },
    /// An empty (or whitespace-only) line.
    Blank,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Document {
    pub blocks: Vec<Block>,
}

impl Block {
    pub fn task(text: impl Into<String>) -> Self {
        Block::Task {
            done: false,
            text: text.into(),
            indent: String::new(),
        }
    }

    pub fn is_task(&self) -> bool {
        matches!(self, Block::Task { .. })
    }

    fn parse_line(line: &str) -> Block {
        if line.trim().is_empty() {
            return Block::Blank;
        }
        if let Some(h) = parse_heading(line) {
            return h;
        }
        if let Some(t) = parse_task(line) {
            return t;
        }
        if is_rule(line) {
            return Block::Rule {
                text: line.to_string(),
            };
        }
        Block::Text {
            text: line.to_string(),
        }
    }

    fn write_to(&self, out: &mut String) {
        match self {
            Block::Heading { level, text } => {
                for _ in 0..(*level).clamp(1, 6) {
                    out.push('#');
                }
                out.push(' ');
                out.push_str(text);
            }
            Block::Task { done, text, indent } => {
                out.push_str(indent);
                out.push_str(if *done { "- [x]" } else { "- [ ]" });
                if !text.is_empty() {
                    out.push(' ');
                    out.push_str(text);
                }
            }
            Block::Rule { text } => out.push_str(if text.is_empty() { "---" } else { text }),
            Block::Text { text } => out.push_str(text),
            Block::Blank => {}
        }
    }
}

/// Thematic break: three or more of the same `-`, `*` or `_` (spaces allowed
/// between them, per CommonMark), and nothing else on the line.
fn is_rule(line: &str) -> bool {
    let t = line.trim();
    let mut chars = t.chars().filter(|c| !c.is_whitespace());
    let Some(first) = chars.next() else {
        return false;
    };
    if !matches!(first, '-' | '*' | '_') {
        return false;
    }
    let mut count = 1;
    for c in chars {
        if c != first {
            return false;
        }
        count += 1;
    }
    count >= 3
}

fn parse_heading(line: &str) -> Option<Block> {
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &line[hashes..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    Some(Block::Heading {
        level: hashes as u8,
        text: rest.trim().to_string(),
    })
}

fn parse_task(line: &str) -> Option<Block> {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, rest) = line.split_at(indent_len);
    let mut chars = rest.chars();
    let bullet = chars.next()?;
    if !matches!(bullet, '-' | '*' | '+') {
        return None;
    }
    let rest = chars.as_str();
    let rest = rest.strip_prefix(' ').or_else(|| rest.strip_prefix('\t'))?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('[')?;
    let mut chars = rest.chars();
    let mark = chars.next()?;
    let done = match mark {
        ' ' => false,
        'x' | 'X' => true,
        _ => return None,
    };
    let rest = chars.as_str().strip_prefix(']')?;
    // Must be followed by whitespace or end of line, otherwise it's not a task
    // (e.g. `- [x]y`).
    let text = match rest.chars().next() {
        None => "",
        Some(c) if c.is_whitespace() => rest.trim(),
        Some(_) => return None,
    };
    Some(Block::Task {
        done,
        text: text.to_string(),
        indent: indent.to_string(),
    })
}

impl Document {
    pub fn parse(src: &str) -> Document {
        let mut blocks: Vec<Block> = src
            .split('\n')
            .map(|l| l.strip_suffix('\r').unwrap_or(l))
            .map(Block::parse_line)
            .collect();
        // A trailing newline produces a phantom empty last line; drop it so
        // we don't grow the file by one blank line on every round-trip.
        if src.ends_with('\n') && matches!(blocks.last(), Some(Block::Blank)) {
            blocks.pop();
        }
        if src.is_empty() {
            blocks.clear();
        }
        Document { blocks }
    }

    /// Build a document from UI blocks. A task whose text is only a rule
    /// marker (`---`, `***`, `___`) becomes a horizontal rule, and one whose
    /// text is `# Title` … `###### Title` becomes a heading, so typing those
    /// as a todo produces the markdown construct rather than `- [ ] # Title`.
    pub fn from_blocks(blocks: Vec<Block>) -> Document {
        let blocks = blocks
            .into_iter()
            .map(|b| match b {
                Block::Task { text, .. } if is_rule(&text) => Block::Rule { text },
                Block::Task { text, .. } if parse_heading(&text).is_some() => {
                    parse_heading(&text).expect("checked above")
                }
                other => other,
            })
            .collect();
        Document { blocks }
    }

    /// Serialize with `\n` line endings and exactly one trailing newline
    /// (or empty output for an empty document).
    pub fn to_markdown(&self) -> String {
        let mut out = String::with_capacity(self.blocks.len() * 24);
        for b in &self.blocks {
            b.write_to(&mut out);
            out.push('\n');
        }
        out
    }

    pub fn tasks(&self) -> impl Iterator<Item = &Block> {
        self.blocks.iter().filter(|b| b.is_task())
    }

    pub fn open_count(&self) -> usize {
        self.tasks()
            .filter(|b| matches!(b, Block::Task { done: false, .. }))
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Heading\n\n- [ ] Todo item\n- [x] Completed todo item\n";

    #[test]
    fn parses_sample() {
        let doc = Document::parse(SAMPLE);
        assert_eq!(
            doc.blocks,
            vec![
                Block::Heading {
                    level: 1,
                    text: "Heading".into()
                },
                Block::Blank,
                Block::Task {
                    done: false,
                    text: "Todo item".into(),
                    indent: "".into()
                },
                Block::Task {
                    done: true,
                    text: "Completed todo item".into(),
                    indent: "".into()
                },
            ]
        );
    }

    #[test]
    fn round_trips() {
        for src in [
            SAMPLE,
            "",
            "- [ ] a\n",
            "- [ ] a",
            "# H\n\n\n- [X] done\n  - [ ] nested\nsome text\n\n",
            "* [ ] star bullet\n+ [x] plus bullet\n",
            "-[ ] not a task\n#no heading\n- [ ]\n",
            "line one\r\nline two\r\n",
        ] {
            let doc = Document::parse(src);
            let out = doc.to_markdown();
            let normalized = src.replace("\r\n", "\n");
            let expected = if normalized.is_empty() || normalized.ends_with('\n') {
                normalized.clone()
            } else {
                format!("{normalized}\n")
            };
            // The only normalisations we apply: CRLF→LF, `[X]`→`[x]`,
            // `*`/`+` bullets→`-`, trailing newline.
            let expected = expected
                .replace("- [X]", "- [x]")
                .replace("* [ ]", "- [ ]")
                .replace("+ [x]", "- [x]");
            assert_eq!(out, expected, "src={src:?}");
        }
    }

    #[test]
    fn non_tasks_are_text() {
        let doc = Document::parse("-[ ] nope\n- [y] nope\n- [x]y nope\n#nope\n####### nope");
        assert!(doc.blocks.iter().all(|b| matches!(b, Block::Text { .. })));
    }

    #[test]
    fn rules() {
        let doc = Document::parse("---\n***\n_ _ _\n--\n- - -\n-- -\n");
        assert_eq!(doc.blocks[0], Block::Rule { text: "---".into() });
        assert_eq!(doc.blocks[1], Block::Rule { text: "***".into() });
        assert_eq!(
            doc.blocks[2],
            Block::Rule {
                text: "_ _ _".into()
            }
        );
        assert_eq!(doc.blocks[3], Block::Text { text: "--".into() });
        assert_eq!(
            doc.blocks[4],
            Block::Rule {
                text: "- - -".into()
            }
        );
        assert_eq!(
            doc.blocks[5],
            Block::Rule {
                text: "-- -".into()
            }
        );
        assert_eq!(doc.to_markdown(), "---\n***\n_ _ _\n--\n- - -\n-- -\n");
        assert_eq!(
            Document::from_blocks(vec![Block::Rule {
                text: String::new()
            }])
            .to_markdown(),
            "---\n"
        );
    }

    #[test]
    fn task_of_dashes_becomes_rule() {
        let doc = Document::from_blocks(vec![
            Block::task("---"),
            Block::task("-----"),
            Block::task("* * *"),
            Block::task("--"),
            Block::task("--- not a rule"),
        ]);
        assert_eq!(
            doc.to_markdown(),
            "---\n-----\n* * *\n- [ ] --\n- [ ] --- not a rule\n"
        );
        assert!(matches!(doc.blocks[0], Block::Rule { .. }));
    }

    #[test]
    fn task_of_heading_text_becomes_heading() {
        let doc = Document::from_blocks(vec![
            Block::task("# Title"),
            Block::task("###  Deep  "),
            Block::task("#nope"),
            Block::task("####### seven"),
        ]);
        assert_eq!(
            doc.to_markdown(),
            "# Title\n### Deep\n- [ ] #nope\n- [ ] ####### seven\n"
        );
        assert_eq!(
            doc.blocks[1],
            Block::Heading {
                level: 3,
                text: "Deep".into()
            }
        );
    }

    #[test]
    fn heading_levels_and_edge_forms() {
        let doc = Document::parse("###### six\n#\ttab\n##   spaced   \n#");
        assert_eq!(
            doc.blocks[0],
            Block::Heading {
                level: 6,
                text: "six".into()
            }
        );
        assert_eq!(
            doc.blocks[1],
            Block::Heading {
                level: 1,
                text: "tab".into()
            }
        );
        assert_eq!(
            doc.blocks[2],
            Block::Heading {
                level: 2,
                text: "spaced".into()
            }
        );
        assert_eq!(doc.blocks[3], Block::Text { text: "#".into() });
        // Levels beyond 6 are clamped when serialising a hand-built block.
        let d = Document::from_blocks(vec![Block::Heading {
            level: 9,
            text: "x".into(),
        }]);
        assert_eq!(d.to_markdown(), "###### x\n");
    }

    #[test]
    fn task_text_whitespace_is_trimmed_but_indent_kept() {
        let doc = Document::parse("  - [ ]   padded   \n- [x]\t tabbed\n");
        assert_eq!(
            doc.blocks[0],
            Block::Task {
                done: false,
                text: "padded".into(),
                indent: "  ".into()
            }
        );
        assert_eq!(
            doc.blocks[1],
            Block::Task {
                done: true,
                text: "tabbed".into(),
                indent: "".into()
            }
        );
    }

    #[test]
    fn crlf_and_missing_final_newline_normalise() {
        let doc = Document::parse("- [ ] a\r\n\r\n- [x] b");
        assert_eq!(doc.blocks.len(), 3);
        assert_eq!(doc.to_markdown(), "- [ ] a\n\n- [x] b\n");
        assert_eq!(Document::parse("\n").to_markdown(), "\n");
        assert_eq!(Document::parse("\n\n").to_markdown(), "\n\n");
    }

    #[test]
    fn indent_preserved() {
        let doc = Document::parse("  - [ ] nested\n\t- [x] tab");
        assert_eq!(
            doc.blocks[0],
            Block::Task {
                done: false,
                text: "nested".into(),
                indent: "  ".into()
            }
        );
        assert_eq!(
            doc.blocks[1],
            Block::Task {
                done: true,
                text: "tab".into(),
                indent: "\t".into()
            }
        );
        assert_eq!(doc.to_markdown(), "  - [ ] nested\n\t- [x] tab\n");
    }

    #[test]
    fn counts() {
        let doc = Document::parse(SAMPLE);
        assert_eq!(doc.tasks().count(), 2);
        assert_eq!(doc.open_count(), 1);
    }
}
