/** Copy / cut / paste of todo trees, within a list, across tabs, and via the system clipboard. */
import { renderList, selectedTask, setSelected } from './list.ts';
import { appendIndex, blocksToMarkdown, insertBlocks, parseTaskLines, pasteTarget, removeSubtree, subtreeBlocks } from './model.ts';
import { save } from './snapshot.ts';
import { file, rowAt, S, targetEl } from './state.ts';
import type { Block } from './types.ts';

export function copySelected(): void {
  const i = selectedTask(); const f = file();
  if (i == null || !f) return;
  const blocks = subtreeBlocks(f.blocks, i);
  S.clip = blocks;
  S.clipText = blocksToMarkdown(blocks);
  try { navigator.clipboard?.writeText(S.clipText).catch(() => {}); } catch { /* clipboard unavailable */ }
}

export function cutSelected(): void {
  const i = selectedTask(); const f = file();
  if (i == null || !f) return;
  copySelected();
  removeSubtree(f.blocks, i);
  setSelected(null);
  renderList();
  void save(f);
}

/** Insert `blocks` after the selected task's subtree at its level, else at the end of the list. */
export function pasteBlocks(blocks: Block[] | null): void {
  const f = file(); if (!f || !blocks?.length) return;
  const { at, level } = pasteTarget(f.blocks, selectedTask());
  insertBlocks(f.blocks, at, blocks, level);
  renderList();
  setSelected(at);
  rowAt(at)?.scrollIntoView({ block: 'nearest' });
  void save(f);
}

/** Cmd/Ctrl+V: prefer fresher text from the system clipboard, else our own copy. */
export async function pasteFromClipboard(): Promise<void> {
  let text: string | null = null;
  try {
    // Reading may prompt or hang on some platforms; never let that block a paste.
    text = await Promise.race([navigator.clipboard.readText(), new Promise<null>((r) => setTimeout(() => r(null), 150))]);
  } catch { /* not permitted or unavailable */ }
  if (text != null && text !== S.clipText) {
    const blocks = parseTaskLines(text);
    if (blocks.length) { pasteBlocks(blocks); return; }
  }
  pasteBlocks(S.clip);
}

function appendTo(name: string, blocks: Block[]): void {
  const t = S.snap?.files.find((x) => x.name === name); if (!t) return;
  insertBlocks(t.blocks, appendIndex(t.blocks), blocks, 0);
  void save(t);
}

export function copySelectedTo(name: string): void {
  const i = selectedTask(); const f = file();
  if (i == null || !f) return;
  appendTo(name, subtreeBlocks(f.blocks, i));
}

export function moveSelectedTo(name: string): void {
  const i = selectedTask(); const f = file();
  if (i == null || !f) return;
  const blocks = subtreeBlocks(f.blocks, i);
  removeSubtree(f.blocks, i);
  setSelected(null);
  renderList();
  void save(f);
  appendTo(name, blocks);
}

/* External markdown pasted while nothing editable is focused. */
document.addEventListener('paste', (e) => {
  if (S.view !== 'rendered' || S.editing || targetEl(e).closest('input, textarea, .md-host')) return;
  const blocks = parseTaskLines(e.clipboardData?.getData('text/plain'));
  if (!blocks.length) return;
  e.preventDefault();
  pasteBlocks(blocks);
});
