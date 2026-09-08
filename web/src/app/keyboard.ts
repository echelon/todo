/** Global keyboard shortcuts, window dragging on empty space, and the context-menu default. */
import { copySelected, cutSelected, pasteFromClipboard } from './clipboard.ts';
import { startEdit } from './edit.ts';
import { setView } from './editor.ts';
import { deleteTask, moveSelection, selectedTask, setSelected } from './list.ts';
import { toggleSettings } from './settings.ts';
import { el, rowAt, S, targetEl } from './state.ts';
import { newListPrompt, setActive } from './tabs.ts';
import { appWindow, invoke } from './tauri.ts';
import { closeCtx } from './ui.ts';

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (targetEl(e).closest('input, textarea, button, select, a, .task, .heading, .para, .tab, .popover, .modal, .ctx, .add-row, .md-host')) return;
  void appWindow.startDragging();
});
document.addEventListener('contextmenu', (e) => {
  if (!targetEl(e).closest('input, textarea')) e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const target = targetEl(e);
  if (e.key === 'Escape') {
    if (!el.modal.hidden) { S.modalResolve?.(false); return; }
    if (!el.ctx.hidden) { closeCtx(); return; }
    if (!el.settings.hidden) { toggleSettings(false); return; }
    if (S.editing) return; // handled by the input itself
    if (target.closest('.md-host')) return; // vim owns Escape inside the editor
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active === el.md || active.classList.contains('add'))) { active.blur(); return; }
    if (S.selected != null) { setSelected(null); return; }
    void invoke('hide_window');
    return;
  }
  const typing = target.closest('input, textarea, select, .md-host');
  if (!typing && S.view === 'rendered' && !S.editing) {
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && (k === 'c' || k === 'x') && selectedTask() != null) {
      e.preventDefault();
      if (k === 'c') copySelected(); else cutSelected();
      return;
    }
    if (mod && !e.shiftKey && k === 'v') { if (S.clip) { e.preventDefault(); void pasteFromClipboard(); } return; }
    if (!mod && !e.altKey) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
      const i = selectedTask();
      if (i != null) {
        if (e.key === 'Enter') { e.preventDefault(); const r = rowAt(i); if (r) startEdit(r); return; }
        if (e.key === ' ') { e.preventDefault(); rowAt(i)?.querySelector<HTMLElement>('.check')?.click(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); void deleteTask(i); return; }
      }
    }
  }
  if (!mod) return;
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setView(S.view === 'rendered' ? 'markdown' : 'rendered'); }
  else if ((e.key === 'n' || e.key === 'N') && e.shiftKey) { e.preventDefault(); newListPrompt(); }
  else if (e.key === 'n') { e.preventDefault(); if (S.view !== 'rendered') setView('rendered'); el.list.querySelector<HTMLElement>('.add')?.focus(); }
  else if (e.key === ',') { e.preventDefault(); toggleSettings(); }
  else if (e.key === 'w') { e.preventDefault(); void invoke('hide_window'); }
  else if (e.key >= '1' && e.key <= '9') {
    const f = S.snap?.files[+e.key - 1];
    if (f) { e.preventDefault(); setActive(f.name); }
  }
});
