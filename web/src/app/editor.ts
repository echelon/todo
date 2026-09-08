/** The markdown view: CodeMirror 6 + vim, lazy-loaded from vendor/editor.js, with a textarea fallback. */
import { commitEdit } from './edit.ts';
import { updateCount } from './list.ts';
import { flushPending, refreshView } from './snapshot.ts';
import { el, file, S, vimOn } from './state.ts';
import { BASE, invoke } from './tauri.ts';
import type { View } from './types.ts';
import { toast } from './ui.ts';

export interface MdEditor {
  isTextarea?: boolean;
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
  hasFocus(): boolean;
  setVim(on: boolean): void;
  /** 'normal' | 'insert' | 'visual' | … or null when vim is off (CodeMirror only). */
  mode?(): string | null;
  /** The CodeMirror view (CodeMirror only). */
  view?: unknown;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  vim: boolean;
  onChange(text: string): void;
  onSave?(): void;
  onQuit?(): void;
}

declare global {
  interface Window {
    TodoEditor?: { create(o: EditorOptions): MdEditor };
  }
}

let editor: MdEditor | null = null;
let editorLoading: Promise<MdEditor> | null = null;

export const getEditor = (): MdEditor | null => editor;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error('failed to load ' + src));
    document.head.append(sc);
  });
}

/** Plain <textarea> fallback with the same interface as the CodeMirror editor. */
function textareaEditor(): MdEditor {
  return {
    isTextarea: true,
    getValue: () => el.md.value,
    setValue(v) {
      if (el.md.value === v) return;
      const s = el.md.selectionStart, e = el.md.selectionEnd;
      el.md.value = v;
      try { el.md.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length)); } catch { /* ignore */ }
    },
    focus: () => el.md.focus(),
    hasFocus: () => document.activeElement === el.md,
    setVim() {},
  };
}

export function ensureEditor(): Promise<MdEditor> {
  if (editor) return Promise.resolve(editor);
  if (editorLoading) return editorLoading;
  editorLoading = loadScript(new URL('vendor/editor.js', BASE).href)
    .then(() => {
      if (!window.TodoEditor) throw new Error('TodoEditor global missing');
      editor = window.TodoEditor.create({
        parent: el.mdHost, doc: file()?.raw ?? '', vim: vimOn(),
        onChange: onMdInput, onSave: () => void flushMd(), onQuit: () => setView('rendered'),
      });
      return editor;
    })
    .catch((e: Error) => {
      toast('Editor failed to load, using a plain textarea (' + e.message + ')');
      editor = textareaEditor();
      return editor;
    });
  return editorLoading;
}

export function showEditorPane(visible: boolean): void {
  el.mdHost.hidden = !visible || !editor || !!editor.isTextarea;
  el.md.hidden = !visible || !editor || !editor.isTextarea;
}

export function setView(v: View, force = false): void {
  if (S.view === v && !force) return;
  void flushMd();
  if (S.editing) commitEdit();
  S.view = v;
  localStorage.setItem('view', v);
  el.list.hidden = v !== 'rendered';
  for (const b of el.viewSeg.querySelectorAll<HTMLElement>('button')) b.classList.toggle('active', b.dataset.view === v);
  if (v === 'markdown') {
    void ensureEditor().then((ed) => {
      if (S.view !== 'markdown') return;
      refreshView();
      ed.focus();
    });
  } else {
    showEditorPane(false);
    refreshView();
  }
}
el.viewSeg.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button');
  const v = b?.dataset.view;
  if (v === 'rendered' || v === 'markdown') setView(v);
});

export function onMdInput(): void {
  S.mdDirty = true;
  clearTimeout(S.mdTimer);
  S.mdTimer = setTimeout(() => void flushMd(), 250);
}
el.md.addEventListener('input', onMdInput);
el.md.addEventListener('blur', () => void flushMd());
el.mdHost.addEventListener('focusout', () => void flushMd());
el.md.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { // insert two spaces instead of leaving the textarea
    e.preventDefault();
    const s = el.md.selectionStart, t = el.md.selectionEnd;
    el.md.setRangeText('  ', s, t, 'end');
    onMdInput();
  }
});

export async function flushMd(): Promise<void> {
  clearTimeout(S.mdTimer);
  if (!S.mdDirty || !editor) return;
  S.mdDirty = false;
  const f = file(); if (!f) return;
  const raw = editor.getValue();
  f.raw = raw;
  try {
    f.blocks = await invoke('save_raw', { name: f.name, raw });
    updateCount();
  } catch (e) { toast(e); }
  void flushPending();
}
