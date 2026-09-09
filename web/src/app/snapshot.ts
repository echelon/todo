/** Saving files and applying snapshots that arrive from the backend. */
import { renderList, updateCount } from './list.ts';
import { getEditor, showEditorPane } from './editor.ts';
import { pruneEmptyTasks } from './model.ts';
import { el, file, S } from './state.ts';
import { renderTabs } from './tabs.ts';
import { invoke } from './tauri.ts';
import type { Snapshot, TodoFile } from './types.ts';
import { toast } from './ui.ts';

export async function save(f: TodoFile): Promise<void> {
  try {
    f.raw = await invoke('save_blocks', { name: f.name, blocks: f.blocks });
  } catch (e) { toast(e); }
}

export function applySnapshot(snap: Snapshot): void {
  const busy = S.editing || S.dragging || (S.view === 'markdown' && S.mdDirty);
  if (busy) { S.pendingSnap = snap; return; }
  S.pendingSnap = null;
  const old = S.snap;
  S.snap = snap;
  if (!snap.files.some((f) => f.name === S.active)) S.active = snap.files[0]?.name ?? null;
  const names = (s: Snapshot): string => s.files.map((f) => f.name).join('\n');
  const namesChanged = !old || names(old) !== names(snap);
  if (namesChanged) renderTabs();
  const f = file(), of = old?.files.find((x) => x.name === S.active);
  if (namesChanged || !of || !f || of.raw !== f.raw) refreshView();
}

export function refreshView(): void {
  const f = file();
  el.empty.hidden = !!f;
  if (S.view === 'markdown') {
    const editor = getEditor();
    if (!editor) return; // still loading; setView will call us back
    showEditorPane(!!f);
    editor.setValue(f?.raw ?? '');
    updateCount();
  } else {
    // Empty `- [ ]` lines (left by an interrupted edit, or already in the file) are dropped as soon as the list is shown.
    if (f && !S.editing && pruneEmptyTasks(f.blocks).length) { S.selected = null; void save(f); }
    renderList();
  }
}

export async function flushPending(): Promise<void> {
  if (!S.pendingSnap) return;
  S.pendingSnap = null;
  // Our own write may have superseded the queued snapshot; ask for the truth.
  try { applySnapshot(await invoke('get_snapshot')); } catch (e) { toast(e); }
}
