/** Pointer-based drag & drop of task rows (with their subtree). */
import { commitEdit } from './edit.ts';
import { renderList } from './list.ts';
import { clampDropLevel, collapseBlanks, LEVEL_PX, levelOf, shiftLevels, subtreeEnd } from './model.ts';
import { flushPending, save } from './snapshot.ts';
import { blockIndex, div, el, file, rowAt, S, suppressClicks, targetEl } from './state.ts';
import type { Block } from './types.ts';

interface Drag {
  row: HTMLElement;
  x: number;
  y: number;
  active: boolean;
  ghost: HTMLElement | null;
  offY: number;
  group: HTMLElement[];
  rootLevel: number;
  level: number;
  /** Pointer x that corresponds to level 0; each LEVEL_PX to the right is one level deeper. */
  originX: number;
  /** Row we will drop *into* (as last child). */
  inside: HTMLElement | null;
  /** Row the pointer is hovering the middle of. */
  insideCandidate: HTMLElement | null;
  insideTimer: ReturnType<typeof setTimeout> | undefined;
}

let drag: Drag | null = null;
export const INSIDE_DWELL_MS = 320;

el.list.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const target = targetEl(e);
  const row = target.closest<HTMLElement>('.task');
  if (!row || target.closest('.check, .del, input')) return;
  drag = {
    row, x: e.clientX, y: e.clientY, active: false, ghost: null, offY: 0, group: [], rootLevel: 0, level: 0, originX: 0,
    inside: null, insideCandidate: null, insideTimer: undefined,
  };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    startDrag(drag);
  }
  moveDrag(drag, e);
});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

function startDrag(d: Drag): void {
  if (S.editing) commitEdit();
  const f = file(); if (!f) { drag = null; return; }
  d.active = true;
  S.dragging = true;
  document.body.classList.add('is-dragging');
  const i = blockIndex(d.row);
  const end = subtreeEnd(f.blocks, i);
  for (let k = i; k < end; k++) { const r = rowAt(k); if (r) d.group.push(r); }
  d.rootLevel = levelOf(f.blocks[i]);
  d.level = d.rootLevel;
  d.originX = d.x - d.rootLevel * LEVEL_PX;
  const r = d.row.getBoundingClientRect();
  const rootMargin = parseFloat(getComputedStyle(d.row).marginLeft) || 0;
  d.offY = d.y - r.top;
  const g = div('ghost');
  g.style.width = r.width + rootMargin + 'px';
  g.style.left = r.left - rootMargin + 'px';
  g.style.top = r.top + 'px';
  for (const row of d.group) {
    const c = row.cloneNode(true) as HTMLElement;
    c.classList.remove('dragging');
    g.append(c);
  }
  document.body.append(g);
  d.ghost = g;
  for (const row of d.group) row.classList.add('dragging');
}

function visibleNext(node: Element): Element | null {
  let n = node.nextElementSibling;
  while (n && n.classList.contains('blank')) n = n.nextElementSibling;
  return n;
}

/** Level of the first non-dragged task below the group in the DOM (0 if the section ends). */
function nextLevelInDom(blocks: Block[], row: Element): number {
  for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList.contains('dragging') || n.classList.contains('blank')) continue;
    if (n.classList.contains('task')) return levelOf(blocks[blockIndex(n)]);
    return 0;
  }
  return 0;
}

/** Level of the nearest non-dragged task above the group in the DOM (-1 if none in this section). */
function prevLevelInDom(blocks: Block[], row: Element): number {
  for (let n = row.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.classList.contains('dragging') || n.classList.contains('blank')) continue;
    if (n.classList.contains('task')) return levelOf(blocks[blockIndex(n)]);
    if (n.classList.contains('heading') || n.classList.contains('rule')) return -1;
  }
  return -1;
}

function setInside(d: Drag, row: HTMLElement | null): void {
  if (d.inside === row) return;
  d.inside?.classList.remove('drop-inside');
  d.inside = row;
  row?.classList.add('drop-inside');
}

function applyLevel(d: Drag, blocks: Block[], level: number): void {
  if (level === d.level) return;
  d.level = level;
  const shift = level - d.rootLevel;
  for (const row of d.group) {
    row.style.marginLeft = Math.max(0, levelOf(blocks[blockIndex(row)]) + shift) * LEVEL_PX + 'px';
  }
}

function moveDrag(d: Drag, e: PointerEvent): void {
  const f = file(); if (!f || !d.ghost) return;
  d.ghost.style.top = e.clientY - d.offY + 'px';
  const lr = el.list.getBoundingClientRect();
  if (e.clientY < lr.top + 28) el.list.scrollTop -= 10;
  else if (e.clientY > lr.bottom - 28) el.list.scrollTop += 10;
  const y = e.clientY;

  // Hovering the middle band of a task for a moment means "drop inside it".
  let candidate: HTMLElement | null = null;
  for (const r of el.list.querySelectorAll<HTMLElement>('.task:not(.dragging)')) {
    const b = r.getBoundingClientRect();
    if (y >= b.top && y <= b.bottom) {
      const frac = (y - b.top) / b.height;
      if (frac > 0.3 && frac < 0.7) candidate = r;
      break;
    }
  }
  if (candidate !== d.insideCandidate) {
    d.insideCandidate = candidate;
    clearTimeout(d.insideTimer);
    setInside(d, null);
    if (candidate) {
      d.insideTimer = setTimeout(() => { if (drag === d && d.insideCandidate === candidate) setInside(d, candidate); }, INSIDE_DWELL_MS);
    }
  }
  if (d.inside) return; // placeholder stays put while an inside-drop is armed

  let target: Element | null = null;
  for (const r of el.list.querySelectorAll('.block:not(.blank):not(.dragging)')) {
    const b = r.getBoundingClientRect();
    if (y < b.top + b.height / 2) { target = r; break; }
  }
  const ref = target ?? el.list.querySelector('.add-row');
  const last = d.group[d.group.length - 1];
  if (visibleNext(last) !== ref) for (const row of d.group) el.list.insertBefore(row, ref);
  // A slight move to the right nests under the item above the drop point; see clampDropLevel.
  const want = Math.round((e.clientX - d.originX) / LEVEL_PX);
  applyLevel(d, f.blocks, clampDropLevel(want, prevLevelInDom(f.blocks, d.row), nextLevelInDom(f.blocks, last)));
}

/** Move the dragged group so it becomes the last child of `target` (in the DOM). */
function placeInside(d: Drag, blocks: Block[], target: HTMLElement): void {
  const ti = blockIndex(target);
  const end = subtreeEnd(blocks, ti);
  let last: HTMLElement | null = null;
  for (let k = end - 1; k >= ti; k--) {
    const r = rowAt(k);
    if (r && !r.classList.contains('dragging')) { last = r; break; }
  }
  let ref: ChildNode | null = (last ?? target).nextSibling;
  for (const row of d.group) { el.list.insertBefore(row, ref); ref = row.nextSibling; }
  applyLevel(d, blocks, levelOf(blocks[ti]) + 1);
}

function snapGroup(group: HTMLElement[]): void {
  // Dropped just after blank line(s) and right before a heading / divider / the end:
  // hop above the blanks so the items stay inside the previous section.
  const first = group[0], last = group[group.length - 1];
  const next = visibleNext(last);
  const endsSection = !next || next.classList.contains('heading') || next.classList.contains('rule') || next.classList.contains('add-row');
  if (!endsSection) return;
  let prev = first.previousElementSibling, firstBlank: Element | null = null;
  while (prev && prev.classList.contains('blank')) { firstBlank = prev; prev = prev.previousElementSibling; }
  // A blank right after a heading/divider is that element's spacing, not the section's tail.
  if (!prev || prev.classList.contains('heading') || prev.classList.contains('rule')) return;
  if (firstBlank) for (const row of group) el.list.insertBefore(row, firstBlank);
}

function endDrag(): void {
  if (!drag) return;
  const d = drag;
  if (!d.active) { drag = null; return; }
  clearTimeout(d.insideTimer);
  const f = file();
  if (d.inside && f) { placeInside(d, f.blocks, d.inside); d.inside.classList.remove('drop-inside'); }
  drag = null;
  S.dragging = false;
  document.body.classList.remove('is-dragging');
  d.ghost?.remove();
  for (const row of d.group) row.classList.remove('dragging');
  suppressClicks();
  if (!d.inside) snapGroup(d.group);
  if (!f) return;
  const order = collapseBlanks([...el.list.querySelectorAll('.block')].map((x) => f.blocks[blockIndex(x)]));
  let changed = order.length !== f.blocks.length || order.some((b, i) => b !== f.blocks[i]);
  // Re-indent exactly the blocks that were dragged (never the neighbours they
  // landed next to, which would silently re-parent them).
  const delta = d.level - d.rootLevel;
  if (delta) {
    shiftLevels(d.group.map((row) => f.blocks[blockIndex(row)]), delta);
    changed = true;
  }
  if (changed) { f.blocks = order; renderList(); void save(f); }
  else renderList(); // restore margins touched during the drag
  void flushPending();
}
