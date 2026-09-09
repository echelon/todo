/** The rendered list: rows, selection, add box, delete, keyboard navigation. */
import { copySelected, copySelectedTo, cutSelected, moveSelectedTo, pasteBlocks } from './clipboard.ts';
import { commitEdit, startEdit } from './edit.ts';
import { appendIndex, blockFromTyped, countText, deferredFlags, LEVEL_PX, levelOf, nextTaskIndex, removeSubtree, splitTags, subtreeEnd } from './model.ts';
import { save } from './snapshot.ts';
import { blockIndex, div, el, file, rowAt, S, targetEl } from './state.ts';
import { updateActiveBadge } from './tabs.ts';
import type { Block } from './types.ts';
import { confirmDialog, showMenu } from './ui.ts';

const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

/** `deferred`: the block is parked by its own `[later]`-style tag or by a deferred heading above it (see `deferredFlags`). */
export function blockEl(b: Block, i: number, deferred = false): HTMLElement {
  let d: HTMLElement;
  const parked = deferred ? ' deferred' : '';
  switch (b.kind) {
    case 'heading':
      d = div('block heading h' + b.level + parked);
      renderTags(d, b.text);
      break;
    case 'task': {
      d = div('block task' + (b.done ? ' done' : '') + parked);
      const lvl = levelOf(b);
      if (lvl) d.style.marginLeft = lvl * LEVEL_PX + 'px';
      const c = document.createElement('button'); c.className = 'check'; c.innerHTML = CHECK_SVG; c.title = 'Toggle';
      const t = document.createElement('span'); t.className = 'text';
      renderTags(t, b.text);
      const x = document.createElement('button'); x.className = 'del'; x.textContent = '✕'; x.title = 'Delete';
      d.append(c, t, x);
      break;
    }
    case 'text':
      d = div('block para' + parked);
      d.textContent = b.text;
      break;
    case 'rule':
      d = div('block rule');
      break;
    default:
      d = div('block blank');
  }
  d.dataset.i = String(i);
  return d;
}

/** Fill `host` with the text: plain runs as text nodes, `[tag]`s as badges. */
function renderTags(host: HTMLElement, text: string): void {
  const parts = splitTags(text);
  if (!parts.length) { host.textContent = ' '; return; }
  for (const p of parts) {
    if (p.kind === 'text') { host.append(p.text); continue; }
    const tag = document.createElement('span');
    tag.className = 'tag' + (p.deferred ? ' deferred' : '');
    tag.textContent = p.tag;
    tag.title = `[${p.tag}]`;
    host.append(tag);
  }
}

function addRow(): HTMLElement {
  const d = div('add-row');
  const plus = document.createElement('span'); plus.className = 'plus'; plus.textContent = '+';
  const inp = document.createElement('input'); inp.className = 'add'; inp.placeholder = 'Add a todo…';
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inp.value.trim()) addTask(inp.value.trim());
    else if (e.key === 'Escape') { inp.value = ''; inp.blur(); e.stopPropagation(); }
  });
  d.append(plus, inp);
  return d;
}

export function renderList(): void {
  const f = file();
  el.empty.hidden = !!f;
  if (!f) { el.list.textContent = ''; el.count.textContent = ''; return; }
  const frag = document.createDocumentFragment();
  const deferred = deferredFlags(f.blocks);
  f.blocks.forEach((b, i) => frag.append(blockEl(b, i, deferred[i])));
  frag.append(addRow());
  const scroll = el.list.scrollTop;
  el.list.replaceChildren(frag);
  el.list.scrollTop = scroll;
  if (S.selected != null) {
    const r = rowAt(S.selected);
    if (r?.classList.contains('task')) r.classList.add('selected'); else S.selected = null;
  }
  updateCount();
}

export function updateCount(): void {
  updateActiveBadge();
  const f = file();
  el.count.textContent = f ? countText(f.blocks) : '';
}

export function addTask(text: string): void {
  const f = file(); if (!f) return;
  f.blocks.splice(appendIndex(f.blocks), 0, blockFromTyped(text));
  renderList();
  const add = el.list.querySelector<HTMLInputElement>('.add');
  add?.focus();
  add?.scrollIntoView({ block: 'nearest' });
  void save(f);
}

export function setSelected(i: number | null): void {
  S.selected = i;
  for (const r of el.list.querySelectorAll('.task.selected')) r.classList.remove('selected');
  if (i != null) rowAt(i)?.classList.add('selected');
}

export function selectedTask(): number | null {
  const f = file();
  return f && S.selected != null && f.blocks[S.selected]?.kind === 'task' ? S.selected : null;
}

export async function deleteTask(i: number): Promise<void> {
  const f = file();
  const b = f?.blocks[i];
  if (!f || !b || b.kind !== 'task') return;
  const n = subtreeEnd(f.blocks, i) - i;
  const nested = n > 1 ? ` and ${n - 1} nested item${n > 2 ? 's' : ''}` : '';
  if (await confirmDialog(`Delete "${b.text || '(empty)'}"${nested}?`)) {
    removeSubtree(f.blocks, i);
    if (S.selected === i) S.selected = null;
    renderList();
    void save(f);
  }
}

export function moveSelection(dir: 1 | -1): void {
  const f = file(); if (!f) return;
  const next = nextTaskIndex(f.blocks, S.selected, dir);
  if (next == null) return;
  setSelected(next);
  rowAt(next)?.scrollIntoView({ block: 'nearest' });
}

el.list.addEventListener('click', (e) => {
  if (S.suppressClick) return;
  const f = file(); if (!f) return;
  const target = targetEl(e);
  const row = target.closest<HTMLElement>('.block'); if (!row) return;
  const i = blockIndex(row); const b = f.blocks[i];
  setSelected(b.kind === 'task' ? i : null);
  if (target.closest('.check')) {
    if (b.kind !== 'task') return;
    b.done = !b.done;
    row.classList.toggle('done', b.done);
    updateCount();
    void save(f);
  } else if (target.closest('.del')) {
    void deleteTask(i);
  } else if (target.closest('.text, .heading, .para') && !target.closest('.edit')) {
    startEdit(row);
  }
});

el.list.addEventListener('contextmenu', (e) => {
  const target = targetEl(e);
  const rule = target.closest<HTMLElement>('.rule');
  if (rule) {
    e.preventDefault();
    const ri = blockIndex(rule);
    showMenu(e.clientX, e.clientY, [{ label: 'Delete divider', danger: true, onClick: () => {
      const f = file(); if (!f || f.blocks[ri]?.kind !== 'rule') return;
      f.blocks.splice(ri, 1); renderList(); void save(f);
    } }]);
    return;
  }
  const row = target.closest<HTMLElement>('.task');
  if (!row || target.closest('input') || !S.snap) return;
  e.preventDefault();
  if (S.editing) commitEdit();
  const i = blockIndex(row);
  setSelected(i);
  const others = S.snap.files.map((f) => f.name).filter((n) => n !== S.active);
  const to = (fn: (name: string) => void) => others.map((n) => ({ label: n, onClick: () => fn(n) }));
  showMenu(e.clientX, e.clientY, [
    { label: 'Copy', onClick: copySelected },
    { label: 'Cut', onClick: cutSelected },
    { label: 'Paste', disabled: !S.clip, onClick: () => pasteBlocks(S.clip) },
    { sep: true },
    others.length > 0 && { label: 'Copy to…', items: to(copySelectedTo) },
    others.length > 0 && { label: 'Move to…', items: to(moveSelectedTo) },
    others.length > 0 && { sep: true },
    { label: 'Delete…', danger: true, onClick: () => void deleteTask(i) },
  ]);
});
