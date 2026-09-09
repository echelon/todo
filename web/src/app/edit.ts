/** Inline editing of a row: click to edit, Enter for the next item, Tab to nest. */
import { renderList } from './list.ts';
import { blockFromTyped, headingFromText, isRuleText, LEVEL_PX, levelOf, prevTaskLevel, pruneEmptyTasks, setLevel, subtreeEnd } from './model.ts';
import { flushPending, save } from './snapshot.ts';
import { blockIndex, file, rowAt, S } from './state.ts';

export function startEdit(row: HTMLElement, isNew = false): void {
  if (S.editing) commitEdit();
  const f = file(); if (!f) return;
  const i = blockIndex(row); const b = f.blocks[i];
  if (b.kind === 'blank' || b.kind === 'rule') return;
  const input = document.createElement('input');
  input.className = 'edit';
  input.value = b.text;
  if (b.kind === 'task') row.querySelector('.text')?.replaceWith(input);
  else { row.textContent = ''; row.append(input); }
  S.editing = { row, input, i, isNew, kind: b.kind, orig: b.text };
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit({ newAfter: b.kind === 'task' }); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
    else if (e.key === 'Tab' && b.kind === 'task') { e.preventDefault(); indentEditing(e.shiftKey ? -1 : 1); }
  });
  input.addEventListener('blur', () => { if (S.editing && S.editing.input === input) commitEdit(); });
}

/** Tab / Shift+Tab while editing: nest under the item above, or un-nest. */
export function indentEditing(dir: 1 | -1): void {
  const e = S.editing; if (!e) return;
  const f = file(); if (!f) return;
  const i = e.i;
  const max = prevTaskLevel(f.blocks, i) + 1;
  const level = Math.max(0, Math.min(max, levelOf(f.blocks[i]) + dir));
  if (!setLevel(f.blocks, i, level)) return;
  for (let k = i, end = subtreeEnd(f.blocks, i); k < end; k++) {
    const r = rowAt(k); if (r) r.style.marginLeft = levelOf(f.blocks[k]) * LEVEL_PX + 'px';
  }
  void save(f);
}

export function commitEdit(opts: { newAfter?: boolean } = {}): void {
  const e = S.editing; if (!e) return;
  S.editing = null;
  const f = file();
  if (!f) return;
  const b = f.blocks[e.i];
  const text = e.input.value.trim();
  let changed = text !== e.orig;
  let newAfter = !!opts.newAfter;
  if (text === '') {
    if (b.kind === 'task') { b.text = ''; changed = !e.isNew; } // pruned below
    else if (b.kind === 'text') { f.blocks[e.i] = { kind: 'blank' }; }
    else { changed = false; } // headings keep their previous text
  } else if (b.kind === 'task' && (isRuleText(text) || headingFromText(text))) {
    f.blocks[e.i] = blockFromTyped(text, b.indent);
    newAfter = false;
    if (S.selected === e.i) S.selected = null;
  } else if (b.kind !== 'blank' && b.kind !== 'rule') {
    b.text = text;
  }
  // Typing has stopped: every empty `- [ ]` goes, this one included if it was left blank.
  const pruned = pruneEmptyTasks(f.blocks);
  const removed = pruned.includes(e.i);
  if (pruned.length && !removed) changed = true;
  const at = e.i - pruned.filter((r) => r < e.i).length; // where the edited block now sits
  const indent = b.kind === 'task' ? b.indent : '';
  if (newAfter && !removed) f.blocks.splice(at + 1, 0, { kind: 'task', done: false, text: '', indent });
  renderList();
  if (changed) void save(f);
  if (newAfter && !removed) {
    const next = rowAt(at + 1);
    if (next) { startEdit(next, true); next.scrollIntoView({ block: 'nearest' }); }
    return; // keep the pending snapshot queued while the new item is being typed
  }
  void flushPending();
}

export function cancelEdit(): void {
  const e = S.editing; if (!e) return;
  S.editing = null;
  const f = file();
  if (f && e.isNew) f.blocks.splice(e.i, 1);
  renderList();
  void flushPending();
}
