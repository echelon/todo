/** Pure, DOM-free logic over the block model. Everything here is unit tested. */
import type { BadgeMode, Block, Task } from './types.ts';

export const INDENT = '  ';
/** Pixels of left margin per nesting level in the rendered list. */
export const LEVEL_PX = 18;

export const indentLevel = (s: string): number => Math.floor(s.replace(/\t/g, '  ').length / 2);
export const levelOf = (b: Block): number => (b.kind === 'task' ? indentLevel(b.indent) : 0);
export const isTask = (b: Block): b is Task => b.kind === 'task';

export const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Index just past the last descendant of task `i` (the run of deeper tasks below it). */
export function subtreeEnd(blocks: Block[], i: number): number {
  const lvl = levelOf(blocks[i]);
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === 'task' && levelOf(blocks[j]) > lvl) j++;
  return j;
}

/** Level of the nearest task above `i` in the same section, or -1 if none. */
export function prevTaskLevel(blocks: Block[], i: number): number {
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.kind === 'task') return levelOf(b);
    if (b.kind === 'heading' || b.kind === 'rule') return -1;
  }
  return -1;
}

/** Re-indent task `i` and its subtree so the root sits at `level`. Returns whether anything changed. */
export function setLevel(blocks: Block[], i: number, level: number): boolean {
  const delta = level - levelOf(blocks[i]);
  if (!delta) return false;
  const end = subtreeEnd(blocks, i);
  for (let k = i; k < end; k++) {
    const b = blocks[k];
    if (b.kind === 'task') b.indent = INDENT.repeat(Math.max(0, levelOf(b) + delta));
  }
  return true;
}

/** Shift exactly these blocks by `delta` levels (used after a drag, where the group is known). */
export function shiftLevels(blocks: Block[], delta: number): void {
  if (!delta) return;
  for (const b of blocks) if (b.kind === 'task') b.indent = INDENT.repeat(Math.max(0, levelOf(b) + delta));
}

/**
 * Where a dropped item may land, given the item above (`prevLevel`, -1 if the
 * section starts) and the item below (`nextLevel`, 0 if the section ends):
 * at most one deeper than the item above, never shallower than the item below
 * (so it can't adopt that item's siblings/children).
 */
export function clampDropLevel(want: number, prevLevel: number, nextLevel: number): number {
  const max = prevLevel + 1;
  const min = nextLevel;
  return Math.max(min, Math.min(max, want));
}

/** Where a new item goes when appended: before trailing blanks, unless those are the spacing after a heading/divider. */
export function appendIndex(blocks: Block[]): number {
  let at = blocks.length;
  while (at > 0 && blocks[at - 1].kind === 'blank') at--;
  if (at > 0 && at < blocks.length && (blocks[at - 1].kind === 'heading' || blocks[at - 1].kind === 'rule')) return blocks.length;
  return at;
}

/** `---`, `***`, `___` (3+ chars, spaces allowed) typed as a todo means "a divider". */
export const isRuleText = (t: string): boolean => /^([-*_])(\s*\1){2,}$/.test(t.trim());

/** `# Title` … `###### Title` typed as a todo means "a heading". */
export function headingFromText(t: string): Block | null {
  const m = /^(#{1,6})[ \t]+(\S.*)$/.exec(t.trim());
  return m ? { kind: 'heading', level: m[1].length, text: m[2].trim() } : null;
}

/** The block a freshly typed todo text really represents. */
export function blockFromTyped(text: string, indent = ''): Block {
  if (isRuleText(text)) return { kind: 'rule', text: text.trim() };
  return headingFromText(text) ?? { kind: 'task', done: false, text, indent };
}

/** Tags that mean "parked, not being worked on right now"; rows carrying one are grayed out. */
export const DEFERRED_TAGS: ReadonlySet<string> = new Set(['tomorrow', 'later', 'someday']);

export type TextPart = { kind: 'text'; text: string } | { kind: 'tag'; tag: string; deferred: boolean };

export const isDeferredTag = (tag: string): boolean => DEFERRED_TAGS.has(tag.trim().toLowerCase());

/**
 * Split task text into plain runs and `[tag]` badges. A tag is a short bracketed word
 * or phrase (`[urgent]`, `[next week]`); brackets around nothing or around more
 * brackets are left as text.
 */
export function splitTags(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /\[([^\[\]\n]{1,40})\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tag = m[1].trim();
    if (!tag) continue;
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'tag', tag, deferred: isDeferredTag(tag) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Whether a task or heading carries a deferred tag such as `[later]`. */
export const isDeferred = (text: string): boolean => splitTags(text).some((p) => p.kind === 'tag' && p.deferred);

/**
 * Per block: whether it is parked, either by its own tag or by sitting under a
 * deferred heading. A deferred heading covers everything up to the next heading
 * of the same or a higher level (`# A [later]` covers its `##` subsections too).
 */
export function deferredFlags(blocks: Block[]): boolean[] {
  let sectionLevel = 0; // 0 = no deferred heading in effect; else the level of the heading that parked this section
  return blocks.map((b) => {
    if (b.kind === 'heading') {
      if (sectionLevel && b.level <= sectionLevel) sectionLevel = 0;
      if (!sectionLevel && isDeferred(b.text)) sectionLevel = b.level;
      return sectionLevel > 0;
    }
    if (sectionLevel) return true;
    return b.kind === 'task' && isDeferred(b.text);
  });
}

/** Serialize blocks the same way `todo-core` does (one line per block, `\n` endings). */
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading': return '#'.repeat(b.level) + ' ' + b.text;
        case 'task': return b.indent + (b.done ? '- [x]' : '- [ ]') + (b.text ? ' ' + b.text : '');
        case 'rule': return b.text || '---';
        case 'text': return b.text;
        default: return '';
      }
    })
    .map((l) => l + '\n')
    .join('');
}

/** Task lines from arbitrary text (e.g. the system clipboard), re-based to level 0. */
export function parseTaskLines(text: string | null | undefined): Task[] {
  const out: Task[] = [];
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^(\s*)[-*+]\s+\[( |x|X)\](?:\s+(.*)|\s*$)/.exec(line);
    if (m) out.push({ kind: 'task', indent: m[1], done: m[2] !== ' ', text: (m[3] ?? '').trim() });
  }
  if (!out.length) return out;
  const min = Math.min(...out.map(levelOf));
  for (const b of out) b.indent = INDENT.repeat(levelOf(b) - min);
  return out;
}

/** A deep copy of task `i` with its subtree, re-based so the root sits at level 0. */
export function subtreeBlocks(blocks: Block[], i: number): Block[] {
  const out = deepClone(blocks.slice(i, subtreeEnd(blocks, i)));
  const root = levelOf(out[0]);
  shiftLevels(out, -root);
  return out;
}

/** Remove task `i` and its subtree; returns how many blocks were removed. */
export function removeSubtree(blocks: Block[], i: number): number {
  const n = subtreeEnd(blocks, i) - i;
  blocks.splice(i, n);
  return n;
}

/** A task line with nothing on it (`- [ ]`, `- [ ]   `): kept only while it is being typed into. */
export const isEmptyTask = (b: Block): boolean => b.kind === 'task' && b.text.trim() === '';

/**
 * Drop empty task lines in place; their children (if any) move up a level so
 * nothing is orphaned. Returns the original indices that were removed, so a
 * caller can re-base an index it is holding on to.
 */
export function pruneEmptyTasks(blocks: Block[]): number[] {
  const removed: number[] = [];
  for (let i = 0, orig = 0; i < blocks.length; orig++) {
    if (!isEmptyTask(blocks[i])) { i++; continue; }
    const end = subtreeEnd(blocks, i);
    shiftLevels(blocks.slice(i + 1, end), -1);
    blocks.splice(i, 1);
    removed.push(orig);
  }
  return removed;
}

/** Where pasted blocks go: after the selected task's subtree at its level, else appended at level 0. */
export function pasteTarget(blocks: Block[], selected: number | null): { at: number; level: number } {
  if (selected != null && blocks[selected]?.kind === 'task') {
    return { at: subtreeEnd(blocks, selected), level: levelOf(blocks[selected]) };
  }
  return { at: appendIndex(blocks), level: 0 };
}

/** Insert a copy of `blocks` at `at`, re-based so their root sits at `level`. */
export function insertBlocks(target: Block[], at: number, blocks: Block[], level: number): Block[] {
  const clone = deepClone(blocks);
  shiftLevels(clone, level);
  target.splice(at, 0, ...clone);
  return clone;
}

export function taskCounts(blocks: Block[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const b of blocks) if (b.kind === 'task') { total++; if (b.done) done++; }
  return { total, done };
}

/** Text of the progress badge for a tab, or '' when hidden. */
export function badgeText(blocks: Block[], mode: BadgeMode): string {
  if (mode === 'none') return '';
  const { total, done } = taskCounts(blocks);
  if (!total) return '';
  if (mode === 'ratio') return `${done}/${total}`;
  if (mode === 'percent') return `${Math.round((done / total) * 100)}%`;
  return `(${total - done})`;
}

/** Footer text: '' / 'all done ✓' / 'N left'. */
export function countText(blocks: Block[]): string {
  const { total, done } = taskCounts(blocks);
  if (!total) return '';
  return done === total ? 'all done ✓' : `${total - done} left`;
}

/** Index of the next/previous task relative to the selection (wraps to the ends when nothing is selected). */
export function nextTaskIndex(blocks: Block[], selected: number | null, dir: 1 | -1): number | null {
  const tasks = blocks.map((b, i) => (b.kind === 'task' ? i : -1)).filter((i) => i >= 0);
  if (!tasks.length) return null;
  const cur = selected == null ? -1 : tasks.indexOf(selected);
  if (cur < 0) return dir > 0 ? tasks[0] : tasks[tasks.length - 1];
  return tasks[Math.max(0, Math.min(tasks.length - 1, cur + dir))];
}

/** Collapse runs of blank lines to one (used when rebuilding order after a drag). */
export function collapseBlanks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'blank' && out.length && out[out.length - 1].kind === 'blank') continue;
    out.push(b);
  }
  return out;
}

export const BADGE_MODES: BadgeMode[] = ['none', 'ratio', 'percent', 'remaining'];
export const BADGE_LABELS: Record<BadgeMode, string> = { none: 'off', ratio: 'n/n', percent: '%', remaining: 'rem' };
export const nextBadgeMode = (m: BadgeMode): BadgeMode => BADGE_MODES[(BADGE_MODES.indexOf(m) + 1) % BADGE_MODES.length];

export const TAB_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#f5d90a'], ['Green', '#30a46c'], ['Teal', '#12a594'],
  ['Blue', '#3e63dd'], ['Purple', '#8e4ec6'], ['Pink', '#e93d82'], ['Gray', '#8b8d98'],
];

export function hexToRgb(h: string): string {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The background opacity to use right now: the inactive one only when enabled and the window is neither focused nor hovered. */
export function effectiveOpacity(w: { opacity: number; inactive_opacity_enabled: boolean; inactive_opacity: number }, focused: boolean, hovered: boolean): number {
  if (w.inactive_opacity_enabled && !focused && !hovered) return w.inactive_opacity;
  return w.opacity;
}
