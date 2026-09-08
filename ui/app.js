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
  modal: $('#modal'), modalMsg: $('#modal-msg'), modalOk: $('#modal-ok'), modalCancel: $('#modal-cancel'), toast: $('#toast'),
  sAppearance: $('#s-appearance'), sLight: $('#s-light'), sDark: $('#s-dark'), sOpacity: $('#s-opacity'), sFont: $('#s-font'),
  sTop: $('#s-top'), sClose: $('#s-close'), sSpaces: $('#s-spaces'), sVim: $('#s-vim'), sHint: $('#s-hint'),
};
const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

const S = {
  cfg: null, snap: null, active: null, view: 'rendered',
  editing: null, dragging: false, suppressClick: false, pendingSnap: null,
  mdTimer: null, mdDirty: false, opacityTimer: null,
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
    b.title = f.name + '.md  (right-click to delete)';
    el.tabs.append(b);
  }
  el.tabs.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function setActive(name) {
  if (name === S.active) return;
  flushMd();
  if (S.editing) commitEdit();
  S.active = name;
  localStorage.setItem('active', name ?? '');
  renderTabs();
  refreshView();
}

el.tabs.addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (t) setActive(t.dataset.name);
});
el.tabs.addEventListener('contextmenu', async (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  e.preventDefault();
  const name = t.dataset.name;
  if (await confirmDialog(`Delete the list "${name}" and its file ${name}.md?`)) {
    try { applySnapshot(await invoke('delete_file', { name })); } catch (err) { toast(err); }
  }
});

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

function addTask(text) {
  const f = file(); if (!f) return;
  let idx = f.blocks.length;
  while (idx > 0 && f.blocks[idx - 1].kind === 'blank') idx--;
  f.blocks.splice(idx, 0, { kind: 'task', done: false, text, indent: '' });
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
  if (e.target.closest('.check')) {
    b.done = !b.done;
    row.classList.toggle('done', b.done);
    updateCount();
    save(f);
  } else if (e.target.closest('.del')) {
    if (await confirmDialog(`Delete "${b.text || '(empty)'}"?`)) {
      f.blocks.splice(i, 1);
      renderList();
      save(f);
    }
  } else if (e.target.closest('.text, .heading, .para') && !e.target.closest('.edit')) {
    startEdit(row);
  }
});

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

function moveDrag(e) {
  drag.ghost.style.top = e.clientY - drag.offY + 'px';
  const lr = el.list.getBoundingClientRect();
  if (e.clientY < lr.top + 28) el.list.scrollTop -= 10;
  else if (e.clientY > lr.bottom - 28) el.list.scrollTop += 10;
  const y = e.clientY;
  let target = null;
  for (const r of el.list.querySelectorAll('.block:not(.blank):not(.dragging)')) {
    const b = r.getBoundingClientRect();
    if (y < b.top + b.height / 2) { target = r; break; }
  }
  const ref = target || el.list.querySelector('.add-row');
  if (visibleNext(drag.group[drag.group.length - 1]) !== ref) {
    for (const row of drag.group) el.list.insertBefore(row, ref);
  }
  // Horizontal movement nests / un-nests the whole subtree.
  const want = drag.rootLevel + Math.round((e.clientX - drag.x) / 24);
  const max = prevLevelInDom(drag.row) + 1;
  const level = Math.max(0, Math.min(max, want));
  if (level !== drag.level) {
    drag.level = level;
    const f = file();
    const shift = level - drag.rootLevel;
    for (const row of drag.group) {
      row.style.marginLeft = Math.max(0, levelOf(f.blocks[+row.dataset.i]) + shift) * LEVEL_PX + 'px';
    }
  }
}

function snapGroup(group) {
  // Dropped just after blank line(s) and right before a heading / the end:
  // hop above the blanks so the items stay inside the previous section.
  const first = group[0], last = group[group.length - 1];
  const next = visibleNext(last);
  const endsSection = !next || next.classList.contains('heading') || next.classList.contains('add-row');
  if (!endsSection) return;
  let prev = first.previousElementSibling, firstBlank = null;
  while (prev && prev.classList.contains('blank')) { firstBlank = prev; prev = prev.previousElementSibling; }
  if (firstBlank) for (const row of group) el.list.insertBefore(row, firstBlank);
}

function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.active) return;
  S.dragging = false;
  document.body.classList.remove('is-dragging');
  d.ghost.remove();
  for (const row of d.group) row.classList.remove('dragging');
  S.suppressClick = true;
  setTimeout(() => (S.suppressClick = false), 0);
  snapGroup(d.group);
  const f = file(); if (!f) return;
  const order = [];
  for (const x of el.list.querySelectorAll('.block')) {
    const b = f.blocks[+x.dataset.i];
    if (b.kind === 'blank' && order.length && order[order.length - 1].kind === 'blank') continue; // collapse runs
    order.push(b);
  }
  let changed = order.length !== f.blocks.length || order.some((b, i) => b !== f.blocks[i]);
  const root = f.blocks[+d.row.dataset.i];
  if (setLevel(order, order.indexOf(root), d.level)) changed = true;
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
  if (e.target.closest('input, textarea, button, select, a, .task, .heading, .para, .tab, .popover, .modal, .add-row, .md-host')) return;
  appWindow.startDragging();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

/* ── keyboard ──────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') {
    if (!el.modal.hidden) { S.modalResolve?.(false); return; }
    if (!el.settings.hidden) { toggleSettings(false); return; }
    if (S.editing) return; // handled by the input itself
    if (e.target.closest('.md-host')) return; // vim owns Escape inside the editor
    if (document.activeElement === el.md || document.activeElement?.classList.contains('add')) { document.activeElement.blur(); return; }
    invoke('hide_window');
    return;
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
