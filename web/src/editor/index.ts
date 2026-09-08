// Entry for ui/vendor/editor.js — a self-contained CodeMirror 6 markdown editor
// with vim emulation, exposed as the global `TodoEditor` (see web/src/app/editor.ts for the consumer).
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, indentUnit, Language, defineLanguageFacet } from '@codemirror/language';
import { parser as mdParser, GFM } from '@lezer/markdown';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { tags as t } from '@lezer/highlight';

// @lezer/markdown directly (not @codemirror/lang-markdown, which drags in the
// whole HTML/JS/CSS parsers for fenced code — ~400 kB we don't need).
const markdownLanguage = new Language(defineLanguageFacet(), mdParser.configure([GFM]), [], 'markdown');

const TASK_RE = /^(\s*)([-*+])\s+\[( |x|X)\]\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+])\s+(.*)$/;
/** Enter inside a task/list line continues the list; Enter on an empty marker ends it. */
function continueList(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  const m = TASK_RE.exec(line.text);
  if (m) {
    if (m[4].trim() === '') { view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } }); return true; }
    const ins = `\n${m[1]}${m[2]} [ ] `;
    view.dispatch({ changes: { from: sel.head, insert: ins }, selection: { anchor: sel.head + ins.length } });
    return true;
  }
  const l = LIST_RE.exec(line.text);
  if (l) {
    if (l[3].trim() === '') { view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } }); return true; }
    const ins = `\n${l[1]}${l[2]} `;
    view.dispatch({ changes: { from: sel.head, insert: ins }, selection: { anchor: sel.head + ins.length } });
    return true;
  }
  return false;
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', color: 'var(--fg)' },
  { tag: [t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--fg)' },
  { tag: t.processingInstruction, color: 'var(--accent)' }, // `#`, `- `, `[ ]`
  { tag: t.atom, color: 'var(--accent)' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.monospace, color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.comment, color: 'var(--muted)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'transparent', fontSize: 'calc(var(--font-size) - 1px)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--surface) 60%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-fat-cursor': { background: 'var(--accent) !important', color: 'var(--accent-fg) !important' },
  '&:not(.cm-focused) .cm-fat-cursor': { outline: '1px solid var(--accent)', background: 'transparent !important', color: 'inherit !important' },
  '.cm-panels': { backgroundColor: 'transparent', color: 'var(--muted)', borderTop: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-vim-panel': { padding: '2px 12px', fontFamily: 'var(--mono)', fontSize: '0.85em', display: 'flex', gap: '8px', minHeight: '20px' },
  '.cm-vim-panel input': { background: 'transparent', border: 'none', outline: 'none', color: 'var(--fg)', fontFamily: 'var(--mono)', fontSize: 'inherit', flex: '1' },
  '.cm-placeholder': { color: 'var(--muted)' },
});

export interface EditorOptions {
  /** Mount point. */
  parent: HTMLElement;
  /** Initial text. */
  doc: string;
  /** Start with vim keys. */
  vim: boolean;
  onChange(text: string): void;
  /** `:w` / Ctrl-S */
  onSave?(): void;
  /** `:q` */
  onQuit?(): void;
}

export interface MdEditor {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
  hasFocus(): boolean;
  setVim(on: boolean): void;
  mode(): string | null;
  destroy(): void;
}

export function create(o: EditorOptions): MdEditor {
  const vimComp = new Compartment();
  const view = new EditorView({
    parent: o.parent,
    state: EditorState.create({
      doc: o.doc || '',
      extensions: [
        // vim must precede the other keymaps so it sees keys first.
        vimComp.of(o.vim ? vim({ status: true }) : []),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        markdownLanguage,
        syntaxHighlighting(highlight),
        theme,
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        cmPlaceholder('# Heading\n\n- [ ] Todo item'),
        keymap.of([
          { key: 'Mod-s', run: () => { o.onSave?.(); return true; } },
          { key: 'Enter', run: continueList },
          indentWithTab,
          ...defaultKeymap, ...historyKeymap, ...searchKeymap,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
      ],
    }),
  });

  // Ex commands that talk to the app.
  Vim.defineEx('write', 'w', () => o.onSave?.());
  Vim.defineEx('quit', 'q', () => o.onQuit?.());
  Vim.defineEx('wq', 'wq', () => { o.onSave?.(); o.onQuit?.(); });
  Vim.defineEx('x', 'x', () => { o.onSave?.(); o.onQuit?.(); });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    /** Replace the document while keeping the cursor where it was (clamped). */
    setValue(text: string) {
      if (text === view.state.doc.toString()) return;
      const { anchor, head } = view.state.selection.main;
      const len = text.length;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(anchor, len), head: Math.min(head, len) },
      });
    },
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    setVim(on: boolean) { view.dispatch({ effects: vimComp.reconfigure(on ? vim({ status: true }) : []) }); },
    /** Current vim mode ('normal' | 'insert' | 'visual' | …) or null when vim is off. */
    mode() {
      const cm = getCM(view) as { state?: { vim?: { insertMode?: boolean; mode?: string } } } | null;
      const v = cm?.state?.vim;
      return v ? (v.insertMode ? 'insert' : v.mode || 'normal') : null;
    },
    destroy: () => view.destroy(),
  };
}
