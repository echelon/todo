/** The tab strip: rendering, badges, switching, reordering, renaming, colors. */
import { commitEdit } from './edit.ts';
import { flushMd } from './editor.ts';
import { badgeText, TAB_COLORS } from './model.ts';
import { applySnapshot, refreshView } from './snapshot.ts';
import { badgeMode, el, file, S, suppressClicks, targetEl } from './state.ts';
import { invoke } from './tauri.ts';
import { confirmDialog, showMenu, toast } from './ui.ts';

export function renderTabs(): void {
  if (!S.snap) return;
  el.tabs.textContent = '';
  for (const f of S.snap.files) {
    const b = document.createElement('button');
    b.className = 'tab' + (f.name === S.active ? ' active' : '');
    b.textContent = f.name;
    const badge = badgeText(f.blocks, badgeMode());
    if (badge) { const sp = document.createElement('span'); sp.className = 'badge'; sp.textContent = badge; b.append(sp); }
    b.dataset.name = f.name;
    b.title = f.name + '.md  (double-click to rename, right-click for menu)';
    if (f.color) { b.dataset.color = f.color; b.style.setProperty('--tab-color', f.color); }
    el.tabs.append(b);
  }
  el.tabs.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

/** Refresh just the active tab's badge (cheap; used after toggles). */
export function updateActiveBadge(): void {
  if (badgeMode() === 'none') return;
  const f = file();
  const tab = f && tabFor(f.name);
  if (!f || !tab) return;
  const text = badgeText(f.blocks, badgeMode());
  let sp = tab.querySelector('.badge');
  if (text && !sp) { sp = document.createElement('span'); sp.className = 'badge'; tab.append(sp); }
  if (sp) { if (text) sp.textContent = text; else sp.remove(); }
}

export const tabFor = (name: string): HTMLElement | null => el.tabs.querySelector<HTMLElement>(`.tab[data-name="${CSS.escape(name)}"]`);

export function setActive(name: string | null): void {
  if (name === S.active) return;
  void flushMd();
  if (S.editing) commitEdit();
  S.active = name;
  S.selected = null;
  localStorage.setItem('active', name ?? '');
  renderTabs();
  refreshView();
}

el.tabs.addEventListener('click', (e) => {
  if (S.suppressClick) return;
  const t = targetEl(e).closest<HTMLElement>('.tab');
  if (t) setActive(t.dataset.name ?? null);
});

/* ── reordering: drag a tab left/right; order persists in tabs.toml ── */
interface TabDrag { tab: HTMLElement; x: number; y: number; active: boolean }
let tabDrag: TabDrag | null = null;

el.tabs.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const tab = targetEl(e).closest<HTMLElement>('.tab');
  if (!tab) return;
  tabDrag = { tab, x: e.clientX, y: e.clientY, active: false };
});
window.addEventListener('pointermove', (e) => {
  if (!tabDrag) return;
  if (!tabDrag.active) {
    if (Math.hypot(e.clientX - tabDrag.x, e.clientY - tabDrag.y) < 6) return;
    tabDrag.active = true;
    tabDrag.tab.classList.add('dragging');
    document.body.classList.add('is-dragging');
  }
  const tr = el.tabs.getBoundingClientRect();
  if (e.clientX < tr.left + 16) el.tabs.scrollLeft -= 8;
  else if (e.clientX > tr.right - 16) el.tabs.scrollLeft += 8;
  let target: Element | null = null;
  for (const t of el.tabs.querySelectorAll('.tab:not(.dragging)')) {
    const b = t.getBoundingClientRect();
    if (e.clientX < b.left + b.width / 2) { target = t; break; }
  }
  if (target) { if (tabDrag.tab.nextElementSibling !== target) el.tabs.insertBefore(tabDrag.tab, target); }
  else if (el.tabs.lastElementChild !== tabDrag.tab) el.tabs.append(tabDrag.tab);
});
async function endTabDrag(): Promise<void> {
  if (!tabDrag) return;
  const d = tabDrag; tabDrag = null;
  if (!d.active) return;
  d.tab.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  suppressClicks();
  const names = [...el.tabs.querySelectorAll<HTMLElement>('.tab')].map((t) => t.dataset.name ?? '');
  if (!S.snap || names.join('\n') === S.snap.files.map((f) => f.name).join('\n')) return;
  try { applySnapshot(await invoke('set_tab_order', { names })); } catch (e) { toast(e); renderTabs(); }
}
window.addEventListener('pointerup', () => void endTabDrag());
window.addEventListener('pointercancel', () => void endTabDrag());

/* ── rename / create ───────────────────────────────────── */
el.tabs.addEventListener('dblclick', (e) => {
  const t = targetEl(e).closest<HTMLElement>('.tab');
  if (t) renameTabPrompt(t);
});

export function renameTabPrompt(tab: HTMLElement): void {
  if (el.tabs.querySelector('.tab-input')) return;
  const oldName = tab.dataset.name ?? '';
  const inp = document.createElement('input');
  inp.className = 'tab-input';
  inp.value = oldName;
  inp.style.width = Math.max(90, tab.offsetWidth + 20) + 'px';
  tab.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = async (commit: boolean): Promise<void> => {
    if (done) return; done = true;
    const name = inp.value.trim();
    inp.remove();
    if (!commit || !name || name === oldName) { renderTabs(); return; }
    try {
      const res = await invoke('rename_file', { from: oldName, to: name });
      if (S.active === oldName) { S.active = res.name; localStorage.setItem('active', res.name); }
      applySnapshot(res.snapshot);
      renderTabs();
      refreshView();
    } catch (err) { toast(err); renderTabs(); }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void finish(true);
    else if (e.key === 'Escape') void finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => void finish(true));
}

export function newListPrompt(): void {
  if (el.tabs.querySelector('.tab-input')) return;
  const inp = document.createElement('input');
  inp.className = 'tab-input';
  inp.placeholder = 'List name';
  el.tabs.append(inp);
  inp.scrollIntoView({ inline: 'nearest' });
  inp.focus();
  let done = false;
  const finish = async (create: boolean): Promise<void> => {
    if (done) return; done = true;
    const name = inp.value.trim();
    inp.remove();
    if (!create || !name) return;
    try {
      const res = await invoke('create_file', { name });
      S.active = res.name;
      localStorage.setItem('active', res.name);
      applySnapshot(res.snapshot);
      renderTabs();
      refreshView();
    } catch (err) { toast(err); }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void finish(true);
    else if (e.key === 'Escape') void finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => void finish(true));
}
el.newTab.addEventListener('click', newListPrompt);

/* ── context menu: rename / color / delete ─────────────── */
el.tabs.addEventListener('contextmenu', (e) => {
  const t = targetEl(e).closest<HTMLElement>('.tab');
  if (!t || !S.snap) return;
  e.preventDefault();
  const name = t.dataset.name ?? '';
  const current = S.snap.files.find((f) => f.name === name)?.color || null;
  showMenu(e.clientX, e.clientY, [
    { label: 'Rename…', onClick: () => { const tab = tabFor(name); if (tab) renameTabPrompt(tab); } },
    { label: 'Color…', items: [
      { label: 'None', color: null, checked: !current, onClick: () => void setTabColor(name, null) },
      ...TAB_COLORS.map(([label, color]) => ({ label, color, checked: current === color, onClick: () => void setTabColor(name, color) })),
    ] },
    { sep: true },
    { label: 'Delete…', danger: true, onClick: () => void deleteListPrompt(name) },
  ]);
});

export async function setTabColor(name: string, color: string | null): Promise<void> {
  try { applySnapshot(await invoke('set_tab_color', { name, color })); renderTabs(); } catch (err) { toast(err); }
}

export async function deleteListPrompt(name: string): Promise<void> {
  if (await confirmDialog(`Delete the list "${name}" and its file ${name}.md?`)) {
    try { applySnapshot(await invoke('delete_file', { name })); } catch (err) { toast(err); }
  }
}
