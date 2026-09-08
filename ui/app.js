'use strict';
/* Todo — vanilla JS, no framework, no build step. */
const T = window.__TAURI__;
const invoke = T.core.invoke;
window.addEventListener('error', (e) => invoke('log', { msg: `${e.message} @ ${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => invoke('log', { msg: `unhandled: ${e.reason}` }));
const listen = T.event.listen;
const appWindow = T.window.getCurrentWindow();
/** Directory app.js was loaded from — used to lazy-load vendor/editor.js. */
const BASE = new URL('.', document.currentScript?.src || location.href);

const $ = (s) => document.querySelector(s);
const el = {
  tabs: $('#tabs'), newTab: $('#new-tab'), list: $('#list'), md: $('#md'), mdHost: $('#md-host'), empty: $('#empty'), count: $('#count'),
  viewSeg: $('#view-seg'), pin: $('#pin-btn'), hide: $('#hide-btn'), settingsBtn: $('#settings-btn'), settings: $('#settings'),
  ctx: $('#ctx'), modal: $('#modal'), modalMsg: $('#modal-msg'), modalOk: $('#modal-ok'), modalCancel: $('#modal-cancel'), toast: $('#toast'),
  sAppearance: $('#s-appearance'), sLight: $('#s-light'), sDark: $('#s-dark'), sOpacity: $('#s-opacity'), sFont: $('#s-font'),
  sTop: $('#s-top'), sClose: $('#s-close'), sSpaces: $('#s-spaces'), sVim: $('#s-vim'), sTabs: $('#s-tabs'), sHint: $('#s-hint'),
};
const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

const S = {
  cfg: null, snap: null, active: null, view: 'rendered',
  editing: null, dragging: false, suppressClick: false, pendingSnap: null,
  mdTimer: null, mdDirty: false, opacityTimer: null,
  selected: null,            // index of the selected task row (rendered view)
  clip: null, clipText: '',  // internal clipboard: blocks + the markdown we put on the system clipboard
};

/* ── theme ─────────────────────────────────────────────── */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
darkMQ.addEventListener('change', applyTheme);

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; }
function currentPalette() {
  const a = S.cfg.config.appearance;
  const dark = a === 'dark' || (a === 'follow_os' && darkMQ.matches);
  return dark ? S.cfg.dark : S.cfg.light;
}
function applyTheme() {
  if (!S.cfg) return;
  const p = currentPalette(), c = S.cfg.config, r = document.documentElement.style;
  for (const k of ['bg', 'surface', 'fg', 'muted', 'accent', 'border', 'danger']) r.setProperty('--' + k, p[k]);
  r.setProperty('--accent-fg', p.accent_fg);
  r.setProperty('--bg-rgb', hexToRgb(p.bg));
  r.setProperty('--opacity', c.window.opacity);
  r.setProperty('--radius', c.window.corner_radius + 'px');
  r.setProperty('--font-size', c.font_size + 'px');
  r.setProperty('--font', c.font_family);
  document.documentElement.style.colorScheme = p.is_dark ? 'dark' : 'light';
  el.pin.classList.toggle('active', c.window.always_on_top);
}

/* ── helpers ───────────────────────────────────────────── */
const file = () => S.snap?.files.find((f) => f.name === S.active);
const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
const indentLevel = (s) => Math.floor(s.replace(/\t/g, '  ').length / 2);
const INDENT = '  ';
const LEVEL_PX = 18;
const levelOf = (b) => indentLevel(b.indent);
const vimOn = () => !!S.cfg?.config.editor?.vim;

/* ── nesting: a task's subtree is the run of deeper-indented tasks below it ── */
function subtreeEnd(blocks, i) {
  const lvl = levelOf(blocks[i]);
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === 'task' && levelOf(blocks[j]) > lvl) j++;
  return j;
}
/** Level of the nearest task above `i` in the same section, or -1 if none. */
function prevTaskLevel(blocks, i) {
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.kind === 'task') return levelOf(b);
    if (b.kind === 'heading' || b.kind === 'rule') return -1;
  }
  return -1;
}
/** Re-indent task `i` (and its subtree) so the root sits at `level`. */
function setLevel(blocks, i, level) {
  const delta = level - levelOf(blocks[i]);
  if (!delta) return false;
  const end = subtreeEnd(blocks, i);
  for (let k = i; k < end; k++) blocks[k].indent = INDENT.repeat(Math.max(0, levelOf(blocks[k]) + delta));
  return true;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = String(msg);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 4000);
}

function confirmDialog(msg) {
  return new Promise((resolve) => {
    el.modalMsg.textContent = msg;
    el.modal.hidden = false;
    const done = (v) => { el.modal.hidden = true; el.modalOk.onclick = el.modalCancel.onclick = null; S.modalResolve = null; resolve(v); };
    el.modalOk.onclick = () => done(true);
    el.modalCancel.onclick = () => done(false);
    S.modalResolve = done;
    el.modalOk.focus();
  });
}

async function save(f) {
  try {
    f.raw = await invoke('save_blocks', { name: f.name, blocks: f.blocks });
  } catch (e) { toast(e); }
}

/* ── tabs ──────────────────────────────────────────────── */
function renderTabs() {
  el.tabs.textContent = '';
  for (const f of S.snap.files) {
    const b = document.createElement('button');
    b.className = 'tab' + (f.name === S.active ? ' active' : '');
    b.textContent = f.name;
    b.dataset.name = f.name;
    b.title = f.name + '.md  (double-click to rename, right-click for menu)';
    if (f.color) { b.dataset.color = f.color; b.style.setProperty('--tab-color', f.color); }
    el.tabs.append(b);
  }
  el.tabs.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function setActive(name) {
  if (name === S.active) return;
  flushMd();
  if (S.editing) commitEdit();
  S.active = name;
  S.selected = null;
  localStorage.setItem('active', name ?? '');
  renderTabs();
  refreshView();
}

el.tabs.addEventListener('click', (e) => {
  if (S.suppressClick) return;
  const t = e.target.closest('.tab');
  if (t) setActive(t.dataset.name);
});

/* ── tab reordering: drag a tab left/right; order persists in tabs.toml ── */
let tabDrag = null;
el.tabs.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const tab = e.target.closest('.tab');
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
  let target = null;
  for (const t of el.tabs.querySelectorAll('.tab:not(.dragging)')) {
    const b = t.getBoundingClientRect();
    if (e.clientX < b.left + b.width / 2) { target = t; break; }
  }
  if (target) { if (tabDrag.tab.nextElementSibling !== target) el.tabs.insertBefore(tabDrag.tab, target); }
  else if (el.tabs.lastElementChild !== tabDrag.tab) el.tabs.append(tabDrag.tab);
});
async function endTabDrag() {
  if (!tabDrag) return;
  const d = tabDrag; tabDrag = null;
  if (!d.active) return;
  d.tab.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  S.suppressClick = true;
  setTimeout(() => (S.suppressClick = false), 0);
  const names = [...el.tabs.querySelectorAll('.tab')].map((t) => t.dataset.name);
  if (names.join('\n') === S.snap.files.map((f) => f.name).join('\n')) return;
  try { applySnapshot(await invoke('set_tab_order', { names })); } catch (e) { toast(e); renderTabs(); }
}
window.addEventListener('pointerup', endTabDrag);
window.addEventListener('pointercancel', endTabDrag);
el.tabs.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.tab');
  if (t) renameTabPrompt(t);
});

function renameTabPrompt(tab) {
  if (el.tabs.querySelector('.tab-input')) return;
  const oldName = tab.dataset.name;
  const inp = document.createElement('input');
  inp.className = 'tab-input';
  inp.value = oldName;
  inp.style.width = Math.max(90, tab.offsetWidth + 20) + 'px';
  tab.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = async (commit) => {
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
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
}

/* ── context menu (tabs and todos) ─────────────────────── */
/** items: {label, onClick, danger?, disabled?, items?: [...]} or {sep: true}. */
function showMenu(x, y, items) {
  el.ctx.textContent = '';
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { el.ctx.append(div('sep')); continue; }
    const b = document.createElement('button');
    if ('color' in it) {
      const sw = document.createElement('span');
      sw.className = 'swatch' + (it.color ? '' : ' none');
      if (it.color) sw.style.background = it.color;
      b.append(sw);
    }
    b.append(document.createTextNode(it.label));
    if (it.checked) b.classList.add('checked');
    if (it.danger) b.classList.add('danger');
    b.disabled = !!it.disabled;
    b.onclick = () => {
      if (it.items) showMenu(x, y, [{ label: '‹ Back', onClick: () => showMenu(x, y, items) }, { sep: true }, ...it.items]);
      else { closeCtx(); it.onClick?.(); }
    };
    el.ctx.append(b);
  }
  el.ctx.hidden = false;
  const app = $('#app').getBoundingClientRect();
  const w = el.ctx.offsetWidth, h = el.ctx.offsetHeight;
  el.ctx.style.left = Math.max(4, Math.min(x - app.left, app.width - w - 4)) + 'px';
  el.ctx.style.top = Math.max(4, Math.min(y - app.top, app.height - h - 4)) + 'px';
}
function closeCtx() { el.ctx.hidden = true; }

el.tabs.addEventListener('contextmenu', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  e.preventDefault();
  const name = t.dataset.name;
  const current = S.snap.files.find((f) => f.name === name)?.color || null;
  showMenu(e.clientX, e.clientY, [
    { label: 'Rename…', onClick: () => { const tab = el.tabs.querySelector(`.tab[data-name="${CSS.escape(name)}"]`); if (tab) renameTabPrompt(tab); } },
    { label: 'Color…', items: [
      { label: 'None', color: null, checked: !current, onClick: () => setTabColor(name, null) },
      ...TAB_COLORS.map(([label, color]) => ({ label, color, checked: current === color, onClick: () => setTabColor(name, color) })),
    ] },
    { sep: true },
    { label: 'Delete…', danger: true, onClick: () => deleteListPrompt(name) },
  ]);
});

const TAB_COLORS = [
  ['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#f5d90a'], ['Green', '#30a46c'], ['Teal', '#12a594'],
  ['Blue', '#3e63dd'], ['Purple', '#8e4ec6'], ['Pink', '#e93d82'], ['Gray', '#8b8d98'],
];

async function setTabColor(name, color) {
  try { applySnapshot(await invoke('set_tab_color', { name, color })); renderTabs(); } catch (err) { toast(err); }
}

async function deleteListPrompt(name) {
  if (await confirmDialog(`Delete the list "${name}" and its file ${name}.md?`)) {
    try { applySnapshot(await invoke('delete_file', { name })); } catch (err) { toast(err); }
  }
}

document.addEventListener('mousedown', (e) => { if (!el.ctx.hidden && !e.target.closest('#ctx')) closeCtx(); });

function newListPrompt() {
  if (el.tabs.querySelector('.tab-input')) return;
  const inp = document.createElement('input');
  inp.className = 'tab-input';
  inp.placeholder = 'List name';
  el.tabs.append(inp);
  inp.scrollIntoView({ inline: 'nearest' });
  inp.focus();
  let done = false;
  const finish = async (create) => {
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
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
}
el.newTab.addEventListener('click', newListPrompt);

/* ── rendered list ─────────────────────────────────────── */
function blockEl(b, i) {
  let d;
  switch (b.kind) {
    case 'heading':
      d = div('block heading h' + b.level);
      d.textContent = b.text;
      break;
    case 'task': {
      d = div('block task' + (b.done ? ' done' : ''));
      const lvl = levelOf(b);
      if (lvl) d.style.marginLeft = lvl * LEVEL_PX + 'px';
      const c = document.createElement('button'); c.className = 'check'; c.innerHTML = CHECK_SVG; c.title = 'Toggle';
      const t = document.createElement('span'); t.className = 'text'; t.textContent = b.text || ' ';
      const x = document.createElement('button'); x.className = 'del'; x.textContent = '✕'; x.title = 'Delete';
      d.append(c, t, x);
      break;
    }
    case 'text':
      d = div('block para');
      d.textContent = b.text;
      break;
    case 'rule':
      d = div('block rule');
      break;
    default:
      d = div('block blank');
  }
  d.dataset.i = i;
  return d;
}

function addRow() {
  const d = div('add-row');
  const plus = document.createElement('span'); plus.className = 'plus'; plus.textContent = '+';
  const inp = document.createElement('input'); inp.className = 'add'; inp.placeholder = 'Add a todo…';
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inp.value.trim()) { addTask(inp.value.trim()); }
    else if (e.key === 'Escape') { inp.value = ''; inp.blur(); e.stopPropagation(); }
  });
  d.append(plus, inp);
  return d;
}

function renderList() {
  const f = file();
  el.empty.hidden = !!f;
  if (!f) { el.list.textContent = ''; el.count.textContent = ''; return; }
  const frag = document.createDocumentFragment();
  f.blocks.forEach((b, i) => frag.append(blockEl(b, i)));
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

function updateCount() {
  const f = file();
  if (!f) { el.count.textContent = ''; return; }
  const tasks = f.blocks.filter((b) => b.kind === 'task');
  const open = tasks.filter((b) => !b.done).length;
  el.count.textContent = tasks.length === 0 ? '' : open === 0 ? 'all done ✓' : `${open} left`;
}

function rowAt(i) { return el.list.querySelector(`.block[data-i="${i}"]`); }

/** Where a new item goes when appended: before trailing blanks, unless those blanks
 *  are the spacing after a heading/divider (then after them). */
function appendIndex(blocks) {
  let at = blocks.length;
  while (at > 0 && blocks[at - 1].kind === 'blank') at--;
  if (at > 0 && at < blocks.length && (blocks[at - 1].kind === 'heading' || blocks[at - 1].kind === 'rule')) return blocks.length;
  return at;
}

/** `---`, `***`, `___` (3+ chars, spaces allowed) typed as a todo means "a divider". */
const isRuleText = (t) => /^([-*_])(\s*\1){2,}$/.test(t.trim());
/** `# Title` … `###### Title` typed as a todo means "a heading". */
function headingFromText(t) {
  const m = /^(#{1,6})[ \t]+(\S.*)$/.exec(t.trim());
  return m ? { kind: 'heading', level: m[1].length, text: m[2].trim() } : null;
}
/** The block a freshly typed todo text really represents. */
function blockFromTyped(text, indent = '') {
  if (isRuleText(text)) return { kind: 'rule', text: text.trim() };
  return headingFromText(text) || { kind: 'task', done: false, text, indent };
}

function addTask(text) {
  const f = file(); if (!f) return;
  const idx = appendIndex(f.blocks);
  f.blocks.splice(idx, 0, blockFromTyped(text));
  renderList();
  const add = el.list.querySelector('.add');
  add.focus();
  add.scrollIntoView({ block: 'nearest' });
  save(f);
}

el.list.addEventListener('click', async (e) => {
  if (S.suppressClick) return;
  const f = file(); if (!f) return;
  const row = e.target.closest('.block'); if (!row) return;
  const i = +row.dataset.i; const b = f.blocks[i];
  if (b.kind === 'task') setSelected(i); else setSelected(null);
  if (e.target.closest('.check')) {
    b.done = !b.done;
    row.classList.toggle('done', b.done);
    updateCount();
    save(f);
  } else if (e.target.closest('.del')) {
    deleteTask(i);
  } else if (e.target.closest('.text, .heading, .para') && !e.target.closest('.edit')) {
    startEdit(row);
  }
});

el.list.addEventListener('contextmenu', (e) => {
  const rule = e.target.closest('.rule');
  if (rule) {
    e.preventDefault();
    const ri = +rule.dataset.i;
    showMenu(e.clientX, e.clientY, [{ label: 'Delete divider', danger: true, onClick: () => {
      const f = file(); if (!f || f.blocks[ri]?.kind !== 'rule') return;
      f.blocks.splice(ri, 1); renderList(); save(f);
    } }]);
    return;
  }
  const row = e.target.closest('.task');
  if (!row || e.target.closest('input')) return;
  e.preventDefault();
  if (S.editing) commitEdit();
  const i = +row.dataset.i;
  setSelected(i);
  const others = S.snap.files.map((f) => f.name).filter((n) => n !== S.active);
  const to = (fn) => others.map((n) => ({ label: n, onClick: () => fn(n) }));
  showMenu(e.clientX, e.clientY, [
    { label: 'Copy', onClick: copySelected },
    { label: 'Cut', onClick: cutSelected },
    { label: 'Paste', disabled: !S.clip, onClick: () => pasteBlocks(S.clip) },
    { sep: true },
    others.length ? { label: 'Copy to…', items: to(copySelectedTo) } : null,
    others.length ? { label: 'Move to…', items: to(moveSelectedTo) } : null,
    others.length ? { sep: true } : null,
    { label: 'Delete…', danger: true, onClick: () => deleteTask(i) },
  ]);
});

/* ── selection, clipboard, cross-tab moves ─────────────── */
function setSelected(i) {
  S.selected = i;
  for (const r of el.list.querySelectorAll('.task.selected')) r.classList.remove('selected');
  if (i != null) rowAt(i)?.classList.add('selected');
}

const deepClone = (blocks) => JSON.parse(JSON.stringify(blocks));

/** A task with its subtree, re-based so the root sits at level 0. */
function subtreeBlocks(f, i) {
  const out = deepClone(f.blocks.slice(i, subtreeEnd(f.blocks, i)));
  const root = levelOf(out[0]);
  for (const b of out) b.indent = INDENT.repeat(Math.max(0, levelOf(b) - root));
  return out;
}

function blocksToMarkdown(blocks) {
  return blocks.map((b) =>
    b.kind === 'heading' ? '#'.repeat(b.level) + ' ' + b.text
    : b.kind === 'task' ? b.indent + (b.done ? '- [x]' : '- [ ]') + (b.text ? ' ' + b.text : '')
    : b.kind === 'rule' ? (b.text || '---')
    : b.kind === 'text' ? b.text : '').map((l) => l + '\n').join('');
}

/** Task lines from arbitrary text (e.g. the system clipboard), re-based to level 0. */
function parseTaskLines(text) {
  const out = [];
  for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^(\s*)[-*+]\s+\[( |x|X)\](?:\s+(.*)|\s*$)/.exec(line);
    if (m) out.push({ kind: 'task', indent: m[1], done: m[2] !== ' ', text: (m[3] || '').trim() });
  }
  if (!out.length) return out;
  const min = Math.min(...out.map(levelOf));
  for (const b of out) b.indent = INDENT.repeat(levelOf(b) - min);
  return out;
}

function selectedTask() {
  const f = file();
  return f && S.selected != null && f.blocks[S.selected]?.kind === 'task' ? S.selected : null;
}

function copySelected() {
  const i = selectedTask(); if (i == null) return;
  const blocks = subtreeBlocks(file(), i);
  S.clip = blocks;
  S.clipText = blocksToMarkdown(blocks);
  try { navigator.clipboard?.writeText(S.clipText).catch(() => {}); } catch { /* clipboard unavailable */ }
}

function removeSubtree(f, i) {
  const n = subtreeEnd(f.blocks, i) - i;
  f.blocks.splice(i, n);
  return n;
}

function cutSelected() {
  const i = selectedTask(); if (i == null) return;
  copySelected();
  const f = file();
  removeSubtree(f, i);
  setSelected(null);
  renderList();
  save(f);
}

/** Insert `blocks` after the selected task's subtree at its level, else at the end of the list. */
function pasteBlocks(blocks) {
  const f = file(); if (!f || !blocks?.length) return;
  const clone = deepClone(blocks);
  let at, level;
  const i = selectedTask();
  if (i != null) { level = levelOf(f.blocks[i]); at = subtreeEnd(f.blocks, i); }
  else { level = 0; at = appendIndex(f.blocks); }
  for (const b of clone) b.indent = INDENT.repeat(levelOf(b) + level);
  f.blocks.splice(at, 0, ...clone);
  renderList();
  setSelected(at);
  rowAt(at)?.scrollIntoView({ block: 'nearest' });
  save(f);
}

/** Cmd/Ctrl+V: prefer fresher text from the system clipboard, else our own copy. */
async function pasteFromClipboard() {
  let text = null;
  try {
    // Reading may prompt or hang on some platforms; never let that block a paste.
    text = await Promise.race([navigator.clipboard.readText(), new Promise((r) => setTimeout(() => r(null), 150))]);
  } catch { /* not permitted or unavailable */ }
  if (text != null && text !== S.clipText) {
    const blocks = parseTaskLines(text);
    if (blocks.length) { pasteBlocks(blocks); return; }
  }
  pasteBlocks(S.clip);
}

function appendTo(name, blocks) {
  const t = S.snap.files.find((x) => x.name === name); if (!t) return;
  const clone = deepClone(blocks);
  t.blocks.splice(appendIndex(t.blocks), 0, ...clone);
  save(t);
}

function copySelectedTo(name) {
  const i = selectedTask(); if (i == null) return;
  appendTo(name, subtreeBlocks(file(), i));
}

function moveSelectedTo(name) {
  const i = selectedTask(); if (i == null) return;
  const f = file();
  const blocks = subtreeBlocks(f, i);
  removeSubtree(f, i);
  setSelected(null);
  renderList();
  save(f);
  appendTo(name, blocks);
}

async function deleteTask(i) {
  const f = file(); if (!f || f.blocks[i]?.kind !== 'task') return;
  const n = subtreeEnd(f.blocks, i) - i;
  const nested = n > 1 ? ` and ${n - 1} nested item${n > 2 ? 's' : ''}` : '';
  if (await confirmDialog(`Delete "${f.blocks[i].text || '(empty)'}"${nested}?`)) {
    removeSubtree(f, i);
    if (S.selected === i) S.selected = null;
    renderList();
    save(f);
  }
}

function moveSelection(dir) {
  const f = file(); if (!f) return;
  const tasks = f.blocks.map((b, i) => (b.kind === 'task' ? i : -1)).filter((i) => i >= 0);
  if (!tasks.length) return;
  const cur = S.selected == null ? -1 : tasks.indexOf(S.selected);
  const next = cur < 0 ? (dir > 0 ? tasks[0] : tasks[tasks.length - 1]) : tasks[Math.max(0, Math.min(tasks.length - 1, cur + dir))];
  setSelected(next);
  rowAt(next)?.scrollIntoView({ block: 'nearest' });
}

/* ── inline editing ────────────────────────────────────── */
function startEdit(row, isNew = false) {
  if (S.editing) commitEdit();
  const f = file(); const i = +row.dataset.i; const b = f.blocks[i];
  const input = document.createElement('input');
  input.className = 'edit';
  input.value = b.text;
  if (b.kind === 'task') row.querySelector('.text').replaceWith(input);
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
function indentEditing(dir) {
  const e = S.editing; if (!e) return;
  const f = file(); const i = e.i;
  const max = prevTaskLevel(f.blocks, i) + 1;
  const level = Math.max(0, Math.min(max, levelOf(f.blocks[i]) + dir));
  if (!setLevel(f.blocks, i, level)) return;
  for (let k = i, end = subtreeEnd(f.blocks, i); k < end; k++) {
    const r = rowAt(k); if (r) r.style.marginLeft = levelOf(f.blocks[k]) * LEVEL_PX + 'px';
  }
  save(f);
}

function commitEdit(opts = {}) {
  const e = S.editing; if (!e) return;
  S.editing = null;
  const f = file();
  if (!f) return;
  const b = f.blocks[e.i];
  const text = e.input.value.trim();
  let changed = text !== e.orig;
  let removed = false;
  if (text === '') {
    if (e.kind === 'task') {
      if (e.isNew || e.orig === '') { f.blocks.splice(e.i, 1); removed = true; changed = !e.isNew; }
      else { b.text = ''; }
    } else if (e.kind === 'text') { f.blocks[e.i] = { kind: 'blank' }; }
    else { changed = false; } // headings keep their previous text
  } else if (e.kind === 'task' && (isRuleText(text) || headingFromText(text))) {
    f.blocks[e.i] = blockFromTyped(text, b.indent);
    opts = { ...opts, newAfter: false };
    if (S.selected === e.i) S.selected = null;
  } else {
    b.text = text;
  }
  if (opts.newAfter && !removed) {
    f.blocks.splice(e.i + 1, 0, { kind: 'task', done: false, text: '', indent: b.indent });
  }
  renderList();
  if (changed) save(f);
  if (opts.newAfter && !removed) {
    startEdit(rowAt(e.i + 1), true);
    rowAt(e.i + 1)?.scrollIntoView({ block: 'nearest' });
    return; // keep the pending snapshot queued while the new item is being typed
  }
  flushPending();
}

function cancelEdit() {
  const e = S.editing; if (!e) return;
  S.editing = null;
  const f = file();
  if (f && e.isNew) f.blocks.splice(e.i, 1);
  renderList();
  flushPending();
}

/* ── drag & drop (pointer based, no HTML5 DnD jank) ────── */
let drag = null;
el.list.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const row = e.target.closest('.task');
  if (!row || e.target.closest('.check, .del, input')) return;
  drag = { row, x: e.clientX, y: e.clientY, active: false, ghost: null, offY: 0, offX: 0 };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    startDrag();
  }
  moveDrag(e);
});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

function startDrag() {
  if (S.editing) commitEdit();
  drag.active = true;
  S.dragging = true;
  document.body.classList.add('is-dragging');
  const f = file();
  const i = +drag.row.dataset.i;
  const end = subtreeEnd(f.blocks, i);
  drag.group = [];
  for (let k = i; k < end; k++) { const r = rowAt(k); if (r) drag.group.push(r); }
  drag.rootLevel = levelOf(f.blocks[i]);
  drag.level = drag.rootLevel;
  // Pointer x that corresponds to level 0; each LEVEL_PX to the right is one level deeper.
  drag.originX = drag.x - drag.rootLevel * LEVEL_PX;
  drag.inside = null;          // row we will drop *into* (as last child)
  drag.insideCandidate = null; // row the pointer is hovering the middle of
  drag.insideTimer = null;
  const r = drag.row.getBoundingClientRect();
  const rootMargin = parseFloat(getComputedStyle(drag.row).marginLeft) || 0;
  drag.offY = drag.y - r.top;
  const g = div('ghost');
  g.style.width = r.width + rootMargin + 'px';
  g.style.left = r.left - rootMargin + 'px';
  g.style.top = r.top + 'px';
  for (const row of drag.group) {
    const c = row.cloneNode(true);
    c.classList.remove('dragging');
    g.append(c);
  }
  document.body.append(g);
  drag.ghost = g;
  for (const row of drag.group) row.classList.add('dragging');
}

function visibleNext(node) {
  let n = node.nextElementSibling;
  while (n && n.classList.contains('blank')) n = n.nextElementSibling;
  return n;
}

/** Level of the first non-dragged task below the group in the DOM (0 if the section ends). */
function nextLevelInDom(row) {
  const f = file();
  for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList.contains('dragging') || n.classList.contains('blank')) continue;
    if (n.classList.contains('task')) return levelOf(f.blocks[+n.dataset.i]);
    return 0;
  }
  return 0;
}

/** Level of the nearest non-dragged task above the group in the DOM (-1 if none in this section). */
function prevLevelInDom(row) {
  const f = file();
  for (let n = row.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.classList.contains('dragging') || n.classList.contains('blank')) continue;
    if (n.classList.contains('task')) return levelOf(f.blocks[+n.dataset.i]);
    if (n.classList.contains('heading') || n.classList.contains('rule')) return -1;
  }
  return -1;
}

const INSIDE_DWELL_MS = 320;

function setInside(row) {
  if (drag.inside === row) return;
  drag.inside?.classList.remove('drop-inside');
  drag.inside = row;
  row?.classList.add('drop-inside');
}

function applyLevel(level) {
  if (level === drag.level) return;
  drag.level = level;
  const f = file();
  const shift = level - drag.rootLevel;
  for (const row of drag.group) {
    row.style.marginLeft = Math.max(0, levelOf(f.blocks[+row.dataset.i]) + shift) * LEVEL_PX + 'px';
  }
}

function moveDrag(e) {
  drag.ghost.style.top = e.clientY - drag.offY + 'px';
  const lr = el.list.getBoundingClientRect();
  if (e.clientY < lr.top + 28) el.list.scrollTop -= 10;
  else if (e.clientY > lr.bottom - 28) el.list.scrollTop += 10;
  const y = e.clientY;

  // Hovering the middle band of a task for a moment means "drop inside it".
  let candidate = null;
  for (const r of el.list.querySelectorAll('.task:not(.dragging)')) {
    const b = r.getBoundingClientRect();
    if (y >= b.top && y <= b.bottom) {
      const frac = (y - b.top) / b.height;
      if (frac > 0.3 && frac < 0.7) candidate = r;
      break;
    }
  }
  if (candidate !== drag.insideCandidate) {
    drag.insideCandidate = candidate;
    clearTimeout(drag.insideTimer);
    setInside(null);
    if (candidate) {
      drag.insideTimer = setTimeout(() => { if (drag && drag.insideCandidate === candidate) setInside(candidate); }, INSIDE_DWELL_MS);
    }
  }
  if (drag.inside) return; // placeholder stays put while an inside-drop is armed

  let target = null;
  for (const r of el.list.querySelectorAll('.block:not(.blank):not(.dragging)')) {
    const b = r.getBoundingClientRect();
    if (y < b.top + b.height / 2) { target = r; break; }
  }
  const ref = target || el.list.querySelector('.add-row');
  if (visibleNext(drag.group[drag.group.length - 1]) !== ref) {
    for (const row of drag.group) el.list.insertBefore(row, ref);
  }
  // A slight move to the right nests under the item above the drop point.
  // Bounds: at most one deeper than the item above, and never shallower than
  // the item below — otherwise the dropped item would adopt that item's
  // siblings/children (dragging C between A and A's child B must give
  // A > [C, B], never A, C > B).
  const want = Math.round((e.clientX - drag.originX) / LEVEL_PX);
  const max = prevLevelInDom(drag.row) + 1;
  const min = nextLevelInDom(drag.group[drag.group.length - 1]);
  applyLevel(Math.max(min, Math.min(max, want)));
}

/** Move the dragged group so it becomes the last child of `target` (in the DOM). */
function placeInside(target) {
  const f = file();
  const ti = +target.dataset.i;
  const end = subtreeEnd(f.blocks, ti);
  let last = null;
  for (let k = end - 1; k >= ti; k--) {
    const r = rowAt(k);
    if (r && !r.classList.contains('dragging')) { last = r; break; }
  }
  let ref = (last || target).nextSibling;
  for (const row of drag.group) { el.list.insertBefore(row, ref); ref = row.nextSibling; }
  applyLevel(levelOf(f.blocks[ti]) + 1);
}

function snapGroup(group) {
  // Dropped just after blank line(s) and right before a heading / the end:
  // hop above the blanks so the items stay inside the previous section.
  const first = group[0], last = group[group.length - 1];
  const next = visibleNext(last);
  const endsSection = !next || next.classList.contains('heading') || next.classList.contains('rule') || next.classList.contains('add-row');
  if (!endsSection) return;
  let prev = first.previousElementSibling, firstBlank = null;
  while (prev && prev.classList.contains('blank')) { firstBlank = prev; prev = prev.previousElementSibling; }
  // A blank right after a heading/divider is that element's spacing, not the section's tail.
  if (!prev || prev.classList.contains('heading') || prev.classList.contains('rule')) return;
  if (firstBlank) for (const row of group) el.list.insertBefore(row, firstBlank);
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  if (!d.active) { drag = null; return; }
  clearTimeout(d.insideTimer);
  if (d.inside) { placeInside(d.inside); d.inside.classList.remove('drop-inside'); }
  drag = null;
  S.dragging = false;
  document.body.classList.remove('is-dragging');
  d.ghost.remove();
  for (const row of d.group) row.classList.remove('dragging');
  S.suppressClick = true;
  setTimeout(() => (S.suppressClick = false), 0);
  if (!d.inside) snapGroup(d.group);
  const f = file(); if (!f) return;
  const order = [];
  for (const x of el.list.querySelectorAll('.block')) {
    const b = f.blocks[+x.dataset.i];
    if (b.kind === 'blank' && order.length && order[order.length - 1].kind === 'blank') continue; // collapse runs
    order.push(b);
  }
  let changed = order.length !== f.blocks.length || order.some((b, i) => b !== f.blocks[i]);
  // Re-indent exactly the blocks that were dragged (never the neighbours they
  // landed next to, which would silently re-parent them).
  const delta = d.level - d.rootLevel;
  if (delta) {
    for (const row of d.group) {
      const b = f.blocks[+row.dataset.i];
      b.indent = INDENT.repeat(Math.max(0, levelOf(b) + delta));
    }
    changed = true;
  }
  if (changed) { f.blocks = order; renderList(); save(f); }
  else renderList(); // restore margins touched during the drag
  flushPending();
}

/* ── markdown view (CodeMirror 6 + vim, lazy-loaded from vendor/editor.js) ── */
let editor = null;
let editorLoading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = resolve; sc.onerror = () => reject(new Error('failed to load ' + src));
    document.head.append(sc);
  });
}

/** Plain <textarea> fallback with the same interface as the CodeMirror editor. */
function textareaEditor() {
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

function ensureEditor() {
  if (editor) return Promise.resolve(editor);
  if (editorLoading) return editorLoading;
  editorLoading = loadScript(new URL('vendor/editor.js', BASE).href)
    .then(() => {
      editor = window.TodoEditor.create({
        parent: el.mdHost, doc: file()?.raw ?? '', vim: vimOn(),
        onChange: onMdInput, onSave: flushMd, onQuit: () => setView('rendered'),
      });
      return editor;
    })
    .catch((e) => { toast('Editor failed to load, using a plain textarea (' + e.message + ')'); editor = textareaEditor(); return editor; });
  return editorLoading;
}

function showEditorPane(visible) {
  el.mdHost.hidden = !visible || !editor || !!editor.isTextarea;
  el.md.hidden = !visible || !editor || !editor.isTextarea;
}

function setView(v, force = false) {
  if (S.view === v && !force) return;
  flushMd();
  if (S.editing) commitEdit();
  S.view = v;
  localStorage.setItem('view', v);
  el.list.hidden = v !== 'rendered';
  for (const b of el.viewSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === v);
  if (v === 'markdown') {
    ensureEditor().then(() => {
      if (S.view !== 'markdown') return;
      refreshView();
      editor.focus();
    });
  } else {
    showEditorPane(false);
    refreshView();
  }
}
el.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

function onMdInput() {
  S.mdDirty = true;
  clearTimeout(S.mdTimer);
  S.mdTimer = setTimeout(flushMd, 250);
}
el.md.addEventListener('input', onMdInput);
el.md.addEventListener('blur', flushMd);
el.mdHost.addEventListener('focusout', () => flushMd());
el.md.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { // insert two spaces instead of leaving the textarea
    e.preventDefault();
    const s = el.md.selectionStart, t = el.md.selectionEnd;
    el.md.setRangeText('  ', s, t, 'end');
    onMdInput();
  }
});

async function flushMd() {
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
  flushPending();
}

/* ── snapshots from the backend ────────────────────────── */
function applySnapshot(snap) {
  const busy = S.editing || S.dragging || (S.view === 'markdown' && S.mdDirty);
  if (busy) { S.pendingSnap = snap; return; }
  S.pendingSnap = null;
  const old = S.snap;
  S.snap = snap;
  if (!snap.files.some((f) => f.name === S.active)) S.active = snap.files[0]?.name ?? null;
  const names = (s) => s.files.map((f) => f.name).join('\n');
  const namesChanged = !old || names(old) !== names(snap);
  if (namesChanged) renderTabs();
  const f = file(), of = old?.files.find((x) => x.name === S.active);
  if (namesChanged || !of || !f || of.raw !== f.raw) refreshView();
}

function refreshView() {
  const f = file();
  el.empty.hidden = !!f;
  if (S.view === 'markdown') {
    if (!editor) return; // still loading; setView will call us back
    showEditorPane(!!f);
    editor.setValue(f?.raw ?? '');
    updateCount();
  } else {
    renderList();
  }
}

async function flushPending() {
  if (!S.pendingSnap) return;
  S.pendingSnap = null;
  // Our own write may have superseded the queued snapshot; ask for the truth.
  try { applySnapshot(await invoke('get_snapshot')); } catch (e) { toast(e); }
}

/* ── settings ──────────────────────────────────────────── */
function fillSchemes() {
  for (const sel of [el.sLight, el.sDark]) {
    sel.textContent = '';
    for (const s of S.cfg.schemes) {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.label + (s.is_dark ? ' ◐' : ' ○');
      sel.append(o);
    }
  }
}
function syncSettingsUI() {
  const c = S.cfg.config;
  el.sAppearance.value = c.appearance;
  el.sLight.value = c.light_scheme ?? 'white';
  el.sDark.value = c.dark_scheme ?? 'midnight_blue';
  el.sOpacity.value = c.window.opacity;
  el.sFont.value = c.font_size;
  el.sTop.checked = c.window.always_on_top;
  el.sClose.checked = c.tray.close_to_tray;
  el.sSpaces.checked = c.tray.visible_on_all_workspaces;
  el.sVim.checked = !!c.editor?.vim;
  editor?.setVim(!!c.editor?.vim);
  const overflow = c.tabs?.overflow === 'wrap' ? 'wrap' : 'scroll';
  el.sTabs.value = overflow;
  el.tabs.classList.toggle('wrap', overflow === 'wrap');
  const hk = c.shortcuts.toggle_window ? `Toggle: ${c.shortcuts.toggle_window} · ` : '';
  el.sHint.textContent = `${hk}Config: ${S.cfg.config_path}`;
}
async function patch(p) {
  try {
    S.cfg = await invoke('update_settings', { patch: p });
    applyTheme();
    syncSettingsUI();
  } catch (e) { toast(e); }
}
el.sAppearance.addEventListener('change', () => patch({ appearance: el.sAppearance.value }));
el.sLight.addEventListener('change', () => patch({ light_scheme: el.sLight.value }));
el.sDark.addEventListener('change', () => patch({ dark_scheme: el.sDark.value }));
el.sFont.addEventListener('change', () => patch({ font_size: +el.sFont.value }));
el.sTop.addEventListener('change', () => patch({ always_on_top: el.sTop.checked }));
el.sClose.addEventListener('change', () => patch({ close_to_tray: el.sClose.checked }));
el.sSpaces.addEventListener('change', () => patch({ visible_on_all_workspaces: el.sSpaces.checked }));
el.sVim.addEventListener('change', () => patch({ vim: el.sVim.checked }));
el.sTabs.addEventListener('change', () => patch({ tab_overflow: el.sTabs.value }));
el.sOpacity.addEventListener('input', () => {
  document.documentElement.style.setProperty('--opacity', el.sOpacity.value);
  clearTimeout(S.opacityTimer);
  S.opacityTimer = setTimeout(() => patch({ opacity: +el.sOpacity.value }), 200);
});
$('#s-open-config').addEventListener('click', () => invoke('open_config').catch(toast));
$('#s-open-dir').addEventListener('click', () => invoke('open_todo_dir').catch(toast));
$('#s-quit').addEventListener('click', () => invoke('quit'));

function toggleSettings(show = el.settings.hidden) {
  el.settings.hidden = !show;
  el.settingsBtn.classList.toggle('active', show);
}
el.settingsBtn.addEventListener('click', () => toggleSettings());
document.addEventListener('mousedown', (e) => {
  if (!el.settings.hidden && !e.target.closest('#settings, #settings-btn')) toggleSettings(false);
});
el.pin.addEventListener('click', () => patch({ always_on_top: !S.cfg.config.window.always_on_top }));
el.hide.addEventListener('click', () => invoke('hide_window'));

/* ── window dragging: anything that isn't interactive moves the window ── */
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('input, textarea, button, select, a, .task, .heading, .para, .tab, .popover, .modal, .ctx, .add-row, .md-host')) return;
  appWindow.startDragging();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

/* ── keyboard ──────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const target = e.target instanceof Element ? e.target : document.body;
  if (e.key === 'Escape') {
    if (!el.modal.hidden) { S.modalResolve?.(false); return; }
    if (!el.ctx.hidden) { closeCtx(); return; }
    if (!el.settings.hidden) { toggleSettings(false); return; }
    if (S.editing) return; // handled by the input itself
    if (target.closest('.md-host')) return; // vim owns Escape inside the editor
    if (document.activeElement === el.md || document.activeElement?.classList.contains('add')) { document.activeElement.blur(); return; }
    if (S.selected != null) { setSelected(null); return; }
    invoke('hide_window');
    return;
  }
  const typing = target.closest('input, textarea, select, .md-host');
  if (!typing && S.view === 'rendered' && !S.editing) {
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && (k === 'c' || k === 'x') && selectedTask() != null) { e.preventDefault(); k === 'c' ? copySelected() : cutSelected(); return; }
    if (mod && !e.shiftKey && k === 'v') { if (S.clip) { e.preventDefault(); pasteFromClipboard(); } return; }
    if (!mod && !e.altKey) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
      const i = selectedTask();
      if (i != null) {
        if (e.key === 'Enter') { e.preventDefault(); startEdit(rowAt(i)); return; }
        if (e.key === ' ') { e.preventDefault(); rowAt(i)?.querySelector('.check')?.click(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteTask(i); return; }
      }
    }
  }
  if (!mod) return;
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setView(S.view === 'rendered' ? 'markdown' : 'rendered'); }
  else if ((e.key === 'n' || e.key === 'N') && e.shiftKey) { e.preventDefault(); newListPrompt(); }
  else if (e.key === 'n') { e.preventDefault(); if (S.view !== 'rendered') setView('rendered'); el.list.querySelector('.add')?.focus(); }
  else if (e.key === ',') { e.preventDefault(); toggleSettings(); }
  else if (e.key === 'w') { e.preventDefault(); invoke('hide_window'); }
  else if (e.key >= '1' && e.key <= '9') {
    const f = S.snap?.files[+e.key - 1];
    if (f) { e.preventDefault(); setActive(f.name); }
  }
});

document.addEventListener('paste', (e) => {
  if (S.view !== 'rendered' || S.editing || e.target.closest('input, textarea, .md-host')) return;
  const blocks = parseTaskLines(e.clipboardData?.getData('text/plain'));
  if (!blocks.length) return;
  e.preventDefault();
  pasteBlocks(blocks);
});

/* test hook (used by tools/harness) */
window.__todo = { get editor() { return editor; }, state: S };

/* ── boot ──────────────────────────────────────────────── */
async function init() {
  S.view = localStorage.getItem('view') === 'markdown' ? 'markdown' : 'rendered';
  S.active = localStorage.getItem('active') || null;
  try {
    const [cfg, snap] = await Promise.all([invoke('get_config'), invoke('get_snapshot')]);
    S.cfg = cfg;
    applyTheme();
    fillSchemes();
    syncSettingsUI();
    applySnapshot(snap);
    setView(S.view, true);
    await listen('todo:snapshot', (ev) => applySnapshot(ev.payload));
    await listen('todo:config', (ev) => { S.cfg = ev.payload; applyTheme(); syncSettingsUI(); });
    await listen('todo:error', (ev) => toast(ev.payload));
  } catch (e) {
    toast(e);
  }
  // Note: rAF never fires while the window is hidden, so call directly.
  invoke('window_ready');
}
init();
