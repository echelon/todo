"use strict";
(() => {
  // src/app/model.ts
  var INDENT = "  ";
  var LEVEL_PX = 18;
  var indentLevel = (s) => Math.floor(s.replace(/\t/g, "  ").length / 2);
  var levelOf = (b) => b.kind === "task" ? indentLevel(b.indent) : 0;
  var deepClone = (v) => JSON.parse(JSON.stringify(v));
  function subtreeEnd(blocks, i) {
    const lvl = levelOf(blocks[i]);
    let j = i + 1;
    while (j < blocks.length && blocks[j].kind === "task" && levelOf(blocks[j]) > lvl) j++;
    return j;
  }
  function prevTaskLevel(blocks, i) {
    for (let k = i - 1; k >= 0; k--) {
      const b = blocks[k];
      if (b.kind === "task") return levelOf(b);
      if (b.kind === "heading" || b.kind === "rule") return -1;
    }
    return -1;
  }
  function setLevel(blocks, i, level) {
    const delta = level - levelOf(blocks[i]);
    if (!delta) return false;
    const end = subtreeEnd(blocks, i);
    for (let k = i; k < end; k++) {
      const b = blocks[k];
      if (b.kind === "task") b.indent = INDENT.repeat(Math.max(0, levelOf(b) + delta));
    }
    return true;
  }
  function shiftLevels(blocks, delta) {
    if (!delta) return;
    for (const b of blocks) if (b.kind === "task") b.indent = INDENT.repeat(Math.max(0, levelOf(b) + delta));
  }
  function clampDropLevel(want, prevLevel, nextLevel) {
    const max = prevLevel + 1;
    const min = nextLevel;
    return Math.max(min, Math.min(max, want));
  }
  function appendIndex(blocks) {
    let at = blocks.length;
    while (at > 0 && blocks[at - 1].kind === "blank") at--;
    if (at > 0 && at < blocks.length && (blocks[at - 1].kind === "heading" || blocks[at - 1].kind === "rule")) return blocks.length;
    return at;
  }
  var isRuleText = (t) => /^([-*_])(\s*\1){2,}$/.test(t.trim());
  function headingFromText(t) {
    const m = /^(#{1,6})[ \t]+(\S.*)$/.exec(t.trim());
    return m ? { kind: "heading", level: m[1].length, text: m[2].trim() } : null;
  }
  function blockFromTyped(text, indent = "") {
    if (isRuleText(text)) return { kind: "rule", text: text.trim() };
    return headingFromText(text) ?? { kind: "task", done: false, text, indent };
  }
  function blocksToMarkdown(blocks) {
    return blocks.map((b) => {
      switch (b.kind) {
        case "heading":
          return "#".repeat(b.level) + " " + b.text;
        case "task":
          return b.indent + (b.done ? "- [x]" : "- [ ]") + (b.text ? " " + b.text : "");
        case "rule":
          return b.text || "---";
        case "text":
          return b.text;
        default:
          return "";
      }
    }).map((l) => l + "\n").join("");
  }
  function parseTaskLines(text) {
    const out = [];
    for (const line of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
      const m = /^(\s*)[-*+]\s+\[( |x|X)\](?:\s+(.*)|\s*$)/.exec(line);
      if (m) out.push({ kind: "task", indent: m[1], done: m[2] !== " ", text: (m[3] ?? "").trim() });
    }
    if (!out.length) return out;
    const min = Math.min(...out.map(levelOf));
    for (const b of out) b.indent = INDENT.repeat(levelOf(b) - min);
    return out;
  }
  function subtreeBlocks(blocks, i) {
    const out = deepClone(blocks.slice(i, subtreeEnd(blocks, i)));
    const root = levelOf(out[0]);
    shiftLevels(out, -root);
    return out;
  }
  function removeSubtree(blocks, i) {
    const n = subtreeEnd(blocks, i) - i;
    blocks.splice(i, n);
    return n;
  }
  function pasteTarget(blocks, selected) {
    if (selected != null && blocks[selected]?.kind === "task") {
      return { at: subtreeEnd(blocks, selected), level: levelOf(blocks[selected]) };
    }
    return { at: appendIndex(blocks), level: 0 };
  }
  function insertBlocks(target, at, blocks, level) {
    const clone = deepClone(blocks);
    shiftLevels(clone, level);
    target.splice(at, 0, ...clone);
    return clone;
  }
  function taskCounts(blocks) {
    let total = 0, done = 0;
    for (const b of blocks) if (b.kind === "task") {
      total++;
      if (b.done) done++;
    }
    return { total, done };
  }
  function badgeText(blocks, mode) {
    if (mode === "none") return "";
    const { total, done } = taskCounts(blocks);
    if (!total) return "";
    if (mode === "ratio") return `${done}/${total}`;
    if (mode === "percent") return `${Math.round(done / total * 100)}%`;
    return `(${total - done})`;
  }
  function countText(blocks) {
    const { total, done } = taskCounts(blocks);
    if (!total) return "";
    return done === total ? "all done \u2713" : `${total - done} left`;
  }
  function nextTaskIndex(blocks, selected, dir) {
    const tasks = blocks.map((b, i) => b.kind === "task" ? i : -1).filter((i) => i >= 0);
    if (!tasks.length) return null;
    const cur = selected == null ? -1 : tasks.indexOf(selected);
    if (cur < 0) return dir > 0 ? tasks[0] : tasks[tasks.length - 1];
    return tasks[Math.max(0, Math.min(tasks.length - 1, cur + dir))];
  }
  function collapseBlanks(blocks) {
    const out = [];
    for (const b of blocks) {
      if (b.kind === "blank" && out.length && out[out.length - 1].kind === "blank") continue;
      out.push(b);
    }
    return out;
  }
  var BADGE_MODES = ["none", "ratio", "percent", "remaining"];
  var BADGE_LABELS = { none: "off", ratio: "n/n", percent: "%", remaining: "rem" };
  var nextBadgeMode = (m) => BADGE_MODES[(BADGE_MODES.indexOf(m) + 1) % BADGE_MODES.length];
  var TAB_COLORS = [
    ["Red", "#e5484d"],
    ["Orange", "#f76b15"],
    ["Yellow", "#f5d90a"],
    ["Green", "#30a46c"],
    ["Teal", "#12a594"],
    ["Blue", "#3e63dd"],
    ["Purple", "#8e4ec6"],
    ["Pink", "#e93d82"],
    ["Gray", "#8b8d98"]
  ];
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return `${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}`;
  }

  // src/app/state.ts
  var S = {
    cfg: null,
    snap: null,
    active: null,
    view: "rendered",
    editing: null,
    dragging: false,
    suppressClick: false,
    pendingSnap: null,
    mdTimer: void 0,
    mdDirty: false,
    opacityTimer: void 0,
    /** Index of the selected task row (rendered view). */
    selected: null,
    /** Internal clipboard: blocks plus the markdown we put on the system clipboard. */
    clip: null,
    clipText: "",
    modalResolve: null
  };
  var file = () => S.snap?.files.find((f) => f.name === S.active);
  function $(sel) {
    const e = document.querySelector(sel);
    if (!e) throw new Error("missing element " + sel);
    return e;
  }
  var el = {
    tabs: $("#tabs"),
    newTab: $("#new-tab"),
    list: $("#list"),
    md: $("#md"),
    mdHost: $("#md-host"),
    empty: $("#empty"),
    count: $("#count"),
    viewSeg: $("#view-seg"),
    badgeBtn: $("#badge-btn"),
    pin: $("#pin-btn"),
    hide: $("#hide-btn"),
    settingsBtn: $("#settings-btn"),
    settings: $("#settings"),
    ctx: $("#ctx"),
    modal: $("#modal"),
    modalMsg: $("#modal-msg"),
    modalOk: $("#modal-ok"),
    modalCancel: $("#modal-cancel"),
    toast: $("#toast"),
    sAppearance: $("#s-appearance"),
    sLight: $("#s-light"),
    sDark: $("#s-dark"),
    sOpacity: $("#s-opacity"),
    sFont: $("#s-font"),
    sTop: $("#s-top"),
    sClose: $("#s-close"),
    sSpaces: $("#s-spaces"),
    sVim: $("#s-vim"),
    sTabs: $("#s-tabs"),
    sHint: $("#s-hint")
  };
  function div(cls) {
    const d = document.createElement("div");
    d.className = cls;
    return d;
  }
  var rowAt = (i) => el.list.querySelector(`.block[data-i="${i}"]`);
  var blockIndex = (row) => Number(row.dataset.i);
  var vimOn = () => !!S.cfg?.config.editor?.vim;
  var badgeMode = () => {
    const m = S.cfg?.config.tabs?.badge;
    return m && BADGE_MODES.includes(m) ? m : "none";
  };
  function suppressClicks() {
    S.suppressClick = true;
    setTimeout(() => S.suppressClick = false, 0);
  }
  var targetEl = (e) => e.target instanceof Element ? e.target : document.body;

  // src/app/tauri.ts
  var T = window.__TAURI__;
  function invoke(cmd, ...args) {
    return T.core.invoke(cmd, args[0]);
  }
  function listen(name, cb) {
    return T.event.listen(name, (ev) => cb(ev.payload));
  }
  var appWindow = T.window.getCurrentWindow();
  var BASE = new URL(".", document.currentScript?.src || location.href);
  function reportError(msg) {
    invoke("log", { msg }).catch(() => {
    });
  }

  // src/app/ui.ts
  var toastTimer;
  function toast(msg) {
    el.toast.textContent = String(msg);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.hidden = true, 4e3);
  }
  function confirmDialog(msg) {
    return new Promise((resolve) => {
      el.modalMsg.textContent = msg;
      el.modal.hidden = false;
      const done = (v) => {
        el.modal.hidden = true;
        el.modalOk.onclick = el.modalCancel.onclick = null;
        S.modalResolve = null;
        resolve(v);
      };
      el.modalOk.onclick = () => done(true);
      el.modalCancel.onclick = () => done(false);
      S.modalResolve = done;
      el.modalOk.focus();
    });
  }
  function showMenu(x, y, items) {
    el.ctx.textContent = "";
    for (const it of items) {
      if (!it) continue;
      if ("sep" in it) {
        el.ctx.append(div("sep"));
        continue;
      }
      const b = document.createElement("button");
      if ("color" in it) {
        const sw = document.createElement("span");
        sw.className = "swatch" + (it.color ? "" : " none");
        if (it.color) sw.style.background = it.color;
        b.append(sw);
      }
      b.append(document.createTextNode(it.label));
      if (it.checked) b.classList.add("checked");
      if (it.danger) b.classList.add("danger");
      b.disabled = !!it.disabled;
      b.onclick = () => {
        if (it.items) showMenu(x, y, [{ label: "\u2039 Back", onClick: () => showMenu(x, y, items) }, { sep: true }, ...it.items]);
        else {
          closeCtx();
          it.onClick?.();
        }
      };
      el.ctx.append(b);
    }
    el.ctx.hidden = false;
    const app = $("#app").getBoundingClientRect();
    const w = el.ctx.offsetWidth, h = el.ctx.offsetHeight;
    el.ctx.style.left = Math.max(4, Math.min(x - app.left, app.width - w - 4)) + "px";
    el.ctx.style.top = Math.max(4, Math.min(y - app.top, app.height - h - 4)) + "px";
  }
  function closeCtx() {
    el.ctx.hidden = true;
  }
  document.addEventListener("mousedown", (e) => {
    if (!el.ctx.hidden && !(e.target instanceof Element && e.target.closest("#ctx"))) closeCtx();
  });

  // src/app/editor.ts
  var editor = null;
  var editorLoading = null;
  var getEditor = () => editor;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = src;
      sc.onload = () => resolve();
      sc.onerror = () => reject(new Error("failed to load " + src));
      document.head.append(sc);
    });
  }
  function textareaEditor() {
    return {
      isTextarea: true,
      getValue: () => el.md.value,
      setValue(v) {
        if (el.md.value === v) return;
        const s = el.md.selectionStart, e = el.md.selectionEnd;
        el.md.value = v;
        try {
          el.md.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length));
        } catch {
        }
      },
      focus: () => el.md.focus(),
      hasFocus: () => document.activeElement === el.md,
      setVim() {
      }
    };
  }
  function ensureEditor() {
    if (editor) return Promise.resolve(editor);
    if (editorLoading) return editorLoading;
    editorLoading = loadScript(new URL("vendor/editor.js", BASE).href).then(() => {
      if (!window.TodoEditor) throw new Error("TodoEditor global missing");
      editor = window.TodoEditor.create({
        parent: el.mdHost,
        doc: file()?.raw ?? "",
        vim: vimOn(),
        onChange: onMdInput,
        onSave: () => void flushMd(),
        onQuit: () => setView("rendered")
      });
      return editor;
    }).catch((e) => {
      toast("Editor failed to load, using a plain textarea (" + e.message + ")");
      editor = textareaEditor();
      return editor;
    });
    return editorLoading;
  }
  function showEditorPane(visible) {
    el.mdHost.hidden = !visible || !editor || !!editor.isTextarea;
    el.md.hidden = !visible || !editor || !editor.isTextarea;
  }
  function setView(v, force = false) {
    if (S.view === v && !force) return;
    void flushMd();
    if (S.editing) commitEdit();
    S.view = v;
    localStorage.setItem("view", v);
    el.list.hidden = v !== "rendered";
    for (const b of el.viewSeg.querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === v);
    if (v === "markdown") {
      void ensureEditor().then((ed) => {
        if (S.view !== "markdown") return;
        refreshView();
        ed.focus();
      });
    } else {
      showEditorPane(false);
      refreshView();
    }
  }
  el.viewSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    const v = b?.dataset.view;
    if (v === "rendered" || v === "markdown") setView(v);
  });
  function onMdInput() {
    S.mdDirty = true;
    clearTimeout(S.mdTimer);
    S.mdTimer = setTimeout(() => void flushMd(), 250);
  }
  el.md.addEventListener("input", onMdInput);
  el.md.addEventListener("blur", () => void flushMd());
  el.mdHost.addEventListener("focusout", () => void flushMd());
  el.md.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = el.md.selectionStart, t = el.md.selectionEnd;
      el.md.setRangeText("  ", s, t, "end");
      onMdInput();
    }
  });
  async function flushMd() {
    clearTimeout(S.mdTimer);
    if (!S.mdDirty || !editor) return;
    S.mdDirty = false;
    const f = file();
    if (!f) return;
    const raw = editor.getValue();
    f.raw = raw;
    try {
      f.blocks = await invoke("save_raw", { name: f.name, raw });
      updateCount();
    } catch (e) {
      toast(e);
    }
    void flushPending();
  }

  // src/app/tabs.ts
  function renderTabs() {
    if (!S.snap) return;
    el.tabs.textContent = "";
    for (const f of S.snap.files) {
      const b = document.createElement("button");
      b.className = "tab" + (f.name === S.active ? " active" : "");
      b.textContent = f.name;
      const badge = badgeText(f.blocks, badgeMode());
      if (badge) {
        const sp = document.createElement("span");
        sp.className = "badge";
        sp.textContent = badge;
        b.append(sp);
      }
      b.dataset.name = f.name;
      b.title = f.name + ".md  (double-click to rename, right-click for menu)";
      if (f.color) {
        b.dataset.color = f.color;
        b.style.setProperty("--tab-color", f.color);
      }
      el.tabs.append(b);
    }
    el.tabs.querySelector(".tab.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
  function updateActiveBadge() {
    if (badgeMode() === "none") return;
    const f = file();
    const tab = f && tabFor(f.name);
    if (!f || !tab) return;
    const text = badgeText(f.blocks, badgeMode());
    let sp = tab.querySelector(".badge");
    if (text && !sp) {
      sp = document.createElement("span");
      sp.className = "badge";
      tab.append(sp);
    }
    if (sp) {
      if (text) sp.textContent = text;
      else sp.remove();
    }
  }
  var tabFor = (name) => el.tabs.querySelector(`.tab[data-name="${CSS.escape(name)}"]`);
  function setActive(name) {
    if (name === S.active) return;
    void flushMd();
    if (S.editing) commitEdit();
    S.active = name;
    S.selected = null;
    localStorage.setItem("active", name ?? "");
    renderTabs();
    refreshView();
  }
  el.tabs.addEventListener("click", (e) => {
    if (S.suppressClick) return;
    const t = targetEl(e).closest(".tab");
    if (t) setActive(t.dataset.name ?? null);
  });
  var tabDrag = null;
  el.tabs.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const tab = targetEl(e).closest(".tab");
    if (!tab) return;
    tabDrag = { tab, x: e.clientX, y: e.clientY, active: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!tabDrag) return;
    if (!tabDrag.active) {
      if (Math.hypot(e.clientX - tabDrag.x, e.clientY - tabDrag.y) < 6) return;
      tabDrag.active = true;
      tabDrag.tab.classList.add("dragging");
      document.body.classList.add("is-dragging");
    }
    const tr = el.tabs.getBoundingClientRect();
    if (e.clientX < tr.left + 16) el.tabs.scrollLeft -= 8;
    else if (e.clientX > tr.right - 16) el.tabs.scrollLeft += 8;
    let target = null;
    for (const t of el.tabs.querySelectorAll(".tab:not(.dragging)")) {
      const b = t.getBoundingClientRect();
      if (e.clientX < b.left + b.width / 2) {
        target = t;
        break;
      }
    }
    if (target) {
      if (tabDrag.tab.nextElementSibling !== target) el.tabs.insertBefore(tabDrag.tab, target);
    } else if (el.tabs.lastElementChild !== tabDrag.tab) el.tabs.append(tabDrag.tab);
  });
  async function endTabDrag() {
    if (!tabDrag) return;
    const d = tabDrag;
    tabDrag = null;
    if (!d.active) return;
    d.tab.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
    suppressClicks();
    const names = [...el.tabs.querySelectorAll(".tab")].map((t) => t.dataset.name ?? "");
    if (!S.snap || names.join("\n") === S.snap.files.map((f) => f.name).join("\n")) return;
    try {
      applySnapshot(await invoke("set_tab_order", { names }));
    } catch (e) {
      toast(e);
      renderTabs();
    }
  }
  window.addEventListener("pointerup", () => void endTabDrag());
  window.addEventListener("pointercancel", () => void endTabDrag());
  el.tabs.addEventListener("dblclick", (e) => {
    const t = targetEl(e).closest(".tab");
    if (t) renameTabPrompt(t);
  });
  function renameTabPrompt(tab) {
    if (el.tabs.querySelector(".tab-input")) return;
    const oldName = tab.dataset.name ?? "";
    const inp = document.createElement("input");
    inp.className = "tab-input";
    inp.value = oldName;
    inp.style.width = Math.max(90, tab.offsetWidth + 20) + "px";
    tab.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = inp.value.trim();
      inp.remove();
      if (!commit || !name || name === oldName) {
        renderTabs();
        return;
      }
      try {
        const res = await invoke("rename_file", { from: oldName, to: name });
        if (S.active === oldName) {
          S.active = res.name;
          localStorage.setItem("active", res.name);
        }
        applySnapshot(res.snapshot);
        renderTabs();
        refreshView();
      } catch (err) {
        toast(err);
        renderTabs();
      }
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void finish(true);
      else if (e.key === "Escape") void finish(false);
      e.stopPropagation();
    });
    inp.addEventListener("blur", () => void finish(true));
  }
  function newListPrompt() {
    if (el.tabs.querySelector(".tab-input")) return;
    const inp = document.createElement("input");
    inp.className = "tab-input";
    inp.placeholder = "List name";
    el.tabs.append(inp);
    inp.scrollIntoView({ inline: "nearest" });
    inp.focus();
    let done = false;
    const finish = async (create) => {
      if (done) return;
      done = true;
      const name = inp.value.trim();
      inp.remove();
      if (!create || !name) return;
      try {
        const res = await invoke("create_file", { name });
        S.active = res.name;
        localStorage.setItem("active", res.name);
        applySnapshot(res.snapshot);
        renderTabs();
        refreshView();
      } catch (err) {
        toast(err);
      }
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void finish(true);
      else if (e.key === "Escape") void finish(false);
      e.stopPropagation();
    });
    inp.addEventListener("blur", () => void finish(true));
  }
  el.newTab.addEventListener("click", newListPrompt);
  el.tabs.addEventListener("contextmenu", (e) => {
    const t = targetEl(e).closest(".tab");
    if (!t || !S.snap) return;
    e.preventDefault();
    const name = t.dataset.name ?? "";
    const current = S.snap.files.find((f) => f.name === name)?.color || null;
    showMenu(e.clientX, e.clientY, [
      { label: "Rename\u2026", onClick: () => {
        const tab = tabFor(name);
        if (tab) renameTabPrompt(tab);
      } },
      { label: "Color\u2026", items: [
        { label: "None", color: null, checked: !current, onClick: () => void setTabColor(name, null) },
        ...TAB_COLORS.map(([label, color]) => ({ label, color, checked: current === color, onClick: () => void setTabColor(name, color) }))
      ] },
      { sep: true },
      { label: "Delete\u2026", danger: true, onClick: () => void deleteListPrompt(name) }
    ]);
  });
  async function setTabColor(name, color) {
    try {
      applySnapshot(await invoke("set_tab_color", { name, color }));
      renderTabs();
    } catch (err) {
      toast(err);
    }
  }
  async function deleteListPrompt(name) {
    if (await confirmDialog(`Delete the list "${name}" and its file ${name}.md?`)) {
      try {
        applySnapshot(await invoke("delete_file", { name }));
      } catch (err) {
        toast(err);
      }
    }
  }

  // src/app/snapshot.ts
  async function save(f) {
    try {
      f.raw = await invoke("save_blocks", { name: f.name, blocks: f.blocks });
    } catch (e) {
      toast(e);
    }
  }
  function applySnapshot(snap) {
    const busy = S.editing || S.dragging || S.view === "markdown" && S.mdDirty;
    if (busy) {
      S.pendingSnap = snap;
      return;
    }
    S.pendingSnap = null;
    const old = S.snap;
    S.snap = snap;
    if (!snap.files.some((f2) => f2.name === S.active)) S.active = snap.files[0]?.name ?? null;
    const names = (s) => s.files.map((f2) => f2.name).join("\n");
    const namesChanged = !old || names(old) !== names(snap);
    if (namesChanged) renderTabs();
    const f = file(), of = old?.files.find((x) => x.name === S.active);
    if (namesChanged || !of || !f || of.raw !== f.raw) refreshView();
  }
  function refreshView() {
    const f = file();
    el.empty.hidden = !!f;
    if (S.view === "markdown") {
      const editor2 = getEditor();
      if (!editor2) return;
      showEditorPane(!!f);
      editor2.setValue(f?.raw ?? "");
      updateCount();
    } else {
      renderList();
    }
  }
  async function flushPending() {
    if (!S.pendingSnap) return;
    S.pendingSnap = null;
    try {
      applySnapshot(await invoke("get_snapshot"));
    } catch (e) {
      toast(e);
    }
  }

  // src/app/edit.ts
  function startEdit(row, isNew = false) {
    if (S.editing) commitEdit();
    const f = file();
    if (!f) return;
    const i = blockIndex(row);
    const b = f.blocks[i];
    if (b.kind === "blank" || b.kind === "rule") return;
    const input = document.createElement("input");
    input.className = "edit";
    input.value = b.text;
    if (b.kind === "task") row.querySelector(".text")?.replaceWith(input);
    else {
      row.textContent = "";
      row.append(input);
    }
    S.editing = { row, input, i, isNew, kind: b.kind, orig: b.text };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit({ newAfter: b.kind === "task" });
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
      } else if (e.key === "Tab" && b.kind === "task") {
        e.preventDefault();
        indentEditing(e.shiftKey ? -1 : 1);
      }
    });
    input.addEventListener("blur", () => {
      if (S.editing && S.editing.input === input) commitEdit();
    });
  }
  function indentEditing(dir) {
    const e = S.editing;
    if (!e) return;
    const f = file();
    if (!f) return;
    const i = e.i;
    const max = prevTaskLevel(f.blocks, i) + 1;
    const level = Math.max(0, Math.min(max, levelOf(f.blocks[i]) + dir));
    if (!setLevel(f.blocks, i, level)) return;
    for (let k = i, end = subtreeEnd(f.blocks, i); k < end; k++) {
      const r = rowAt(k);
      if (r) r.style.marginLeft = levelOf(f.blocks[k]) * LEVEL_PX + "px";
    }
    void save(f);
  }
  function commitEdit(opts = {}) {
    const e = S.editing;
    if (!e) return;
    S.editing = null;
    const f = file();
    if (!f) return;
    const b = f.blocks[e.i];
    const text = e.input.value.trim();
    let changed = text !== e.orig;
    let removed = false;
    let newAfter = !!opts.newAfter;
    if (text === "") {
      if (b.kind === "task") {
        if (e.isNew || e.orig === "") {
          f.blocks.splice(e.i, 1);
          removed = true;
          changed = !e.isNew;
        } else b.text = "";
      } else if (b.kind === "text") {
        f.blocks[e.i] = { kind: "blank" };
      } else {
        changed = false;
      }
    } else if (b.kind === "task" && (isRuleText(text) || headingFromText(text))) {
      f.blocks[e.i] = blockFromTyped(text, b.indent);
      newAfter = false;
      if (S.selected === e.i) S.selected = null;
    } else if (b.kind !== "blank" && b.kind !== "rule") {
      b.text = text;
    }
    const indent = b.kind === "task" ? b.indent : "";
    if (newAfter && !removed) f.blocks.splice(e.i + 1, 0, { kind: "task", done: false, text: "", indent });
    renderList();
    if (changed) void save(f);
    if (newAfter && !removed) {
      const next = rowAt(e.i + 1);
      if (next) {
        startEdit(next, true);
        next.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    void flushPending();
  }
  function cancelEdit() {
    const e = S.editing;
    if (!e) return;
    S.editing = null;
    const f = file();
    if (f && e.isNew) f.blocks.splice(e.i, 1);
    renderList();
    void flushPending();
  }

  // src/app/list.ts
  var CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';
  function blockEl(b, i) {
    let d;
    switch (b.kind) {
      case "heading":
        d = div("block heading h" + b.level);
        d.textContent = b.text;
        break;
      case "task": {
        d = div("block task" + (b.done ? " done" : ""));
        const lvl = levelOf(b);
        if (lvl) d.style.marginLeft = lvl * LEVEL_PX + "px";
        const c = document.createElement("button");
        c.className = "check";
        c.innerHTML = CHECK_SVG;
        c.title = "Toggle";
        const t = document.createElement("span");
        t.className = "text";
        t.textContent = b.text || " ";
        const x = document.createElement("button");
        x.className = "del";
        x.textContent = "\u2715";
        x.title = "Delete";
        d.append(c, t, x);
        break;
      }
      case "text":
        d = div("block para");
        d.textContent = b.text;
        break;
      case "rule":
        d = div("block rule");
        break;
      default:
        d = div("block blank");
    }
    d.dataset.i = String(i);
    return d;
  }
  function addRow() {
    const d = div("add-row");
    const plus = document.createElement("span");
    plus.className = "plus";
    plus.textContent = "+";
    const inp = document.createElement("input");
    inp.className = "add";
    inp.placeholder = "Add a todo\u2026";
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && inp.value.trim()) addTask(inp.value.trim());
      else if (e.key === "Escape") {
        inp.value = "";
        inp.blur();
        e.stopPropagation();
      }
    });
    d.append(plus, inp);
    return d;
  }
  function renderList() {
    const f = file();
    el.empty.hidden = !!f;
    if (!f) {
      el.list.textContent = "";
      el.count.textContent = "";
      return;
    }
    const frag = document.createDocumentFragment();
    f.blocks.forEach((b, i) => frag.append(blockEl(b, i)));
    frag.append(addRow());
    const scroll = el.list.scrollTop;
    el.list.replaceChildren(frag);
    el.list.scrollTop = scroll;
    if (S.selected != null) {
      const r = rowAt(S.selected);
      if (r?.classList.contains("task")) r.classList.add("selected");
      else S.selected = null;
    }
    updateCount();
  }
  function updateCount() {
    updateActiveBadge();
    const f = file();
    el.count.textContent = f ? countText(f.blocks) : "";
  }
  function addTask(text) {
    const f = file();
    if (!f) return;
    f.blocks.splice(appendIndex(f.blocks), 0, blockFromTyped(text));
    renderList();
    const add = el.list.querySelector(".add");
    add?.focus();
    add?.scrollIntoView({ block: "nearest" });
    void save(f);
  }
  function setSelected(i) {
    S.selected = i;
    for (const r of el.list.querySelectorAll(".task.selected")) r.classList.remove("selected");
    if (i != null) rowAt(i)?.classList.add("selected");
  }
  function selectedTask() {
    const f = file();
    return f && S.selected != null && f.blocks[S.selected]?.kind === "task" ? S.selected : null;
  }
  async function deleteTask(i) {
    const f = file();
    const b = f?.blocks[i];
    if (!f || !b || b.kind !== "task") return;
    const n = subtreeEnd(f.blocks, i) - i;
    const nested = n > 1 ? ` and ${n - 1} nested item${n > 2 ? "s" : ""}` : "";
    if (await confirmDialog(`Delete "${b.text || "(empty)"}"${nested}?`)) {
      removeSubtree(f.blocks, i);
      if (S.selected === i) S.selected = null;
      renderList();
      void save(f);
    }
  }
  function moveSelection(dir) {
    const f = file();
    if (!f) return;
    const next = nextTaskIndex(f.blocks, S.selected, dir);
    if (next == null) return;
    setSelected(next);
    rowAt(next)?.scrollIntoView({ block: "nearest" });
  }
  el.list.addEventListener("click", (e) => {
    if (S.suppressClick) return;
    const f = file();
    if (!f) return;
    const target = targetEl(e);
    const row = target.closest(".block");
    if (!row) return;
    const i = blockIndex(row);
    const b = f.blocks[i];
    setSelected(b.kind === "task" ? i : null);
    if (target.closest(".check")) {
      if (b.kind !== "task") return;
      b.done = !b.done;
      row.classList.toggle("done", b.done);
      updateCount();
      void save(f);
    } else if (target.closest(".del")) {
      void deleteTask(i);
    } else if (target.closest(".text, .heading, .para") && !target.closest(".edit")) {
      startEdit(row);
    }
  });
  el.list.addEventListener("contextmenu", (e) => {
    const target = targetEl(e);
    const rule = target.closest(".rule");
    if (rule) {
      e.preventDefault();
      const ri = blockIndex(rule);
      showMenu(e.clientX, e.clientY, [{ label: "Delete divider", danger: true, onClick: () => {
        const f = file();
        if (!f || f.blocks[ri]?.kind !== "rule") return;
        f.blocks.splice(ri, 1);
        renderList();
        void save(f);
      } }]);
      return;
    }
    const row = target.closest(".task");
    if (!row || target.closest("input") || !S.snap) return;
    e.preventDefault();
    if (S.editing) commitEdit();
    const i = blockIndex(row);
    setSelected(i);
    const others = S.snap.files.map((f) => f.name).filter((n) => n !== S.active);
    const to = (fn) => others.map((n) => ({ label: n, onClick: () => fn(n) }));
    showMenu(e.clientX, e.clientY, [
      { label: "Copy", onClick: copySelected },
      { label: "Cut", onClick: cutSelected },
      { label: "Paste", disabled: !S.clip, onClick: () => pasteBlocks(S.clip) },
      { sep: true },
      others.length > 0 && { label: "Copy to\u2026", items: to(copySelectedTo) },
      others.length > 0 && { label: "Move to\u2026", items: to(moveSelectedTo) },
      others.length > 0 && { sep: true },
      { label: "Delete\u2026", danger: true, onClick: () => void deleteTask(i) }
    ]);
  });

  // src/app/clipboard.ts
  function copySelected() {
    const i = selectedTask();
    const f = file();
    if (i == null || !f) return;
    const blocks = subtreeBlocks(f.blocks, i);
    S.clip = blocks;
    S.clipText = blocksToMarkdown(blocks);
    try {
      navigator.clipboard?.writeText(S.clipText).catch(() => {
      });
    } catch {
    }
  }
  function cutSelected() {
    const i = selectedTask();
    const f = file();
    if (i == null || !f) return;
    copySelected();
    removeSubtree(f.blocks, i);
    setSelected(null);
    renderList();
    void save(f);
  }
  function pasteBlocks(blocks) {
    const f = file();
    if (!f || !blocks?.length) return;
    const { at, level } = pasteTarget(f.blocks, selectedTask());
    insertBlocks(f.blocks, at, blocks, level);
    renderList();
    setSelected(at);
    rowAt(at)?.scrollIntoView({ block: "nearest" });
    void save(f);
  }
  async function pasteFromClipboard() {
    let text = null;
    try {
      text = await Promise.race([navigator.clipboard.readText(), new Promise((r) => setTimeout(() => r(null), 150))]);
    } catch {
    }
    if (text != null && text !== S.clipText) {
      const blocks = parseTaskLines(text);
      if (blocks.length) {
        pasteBlocks(blocks);
        return;
      }
    }
    pasteBlocks(S.clip);
  }
  function appendTo(name, blocks) {
    const t = S.snap?.files.find((x) => x.name === name);
    if (!t) return;
    insertBlocks(t.blocks, appendIndex(t.blocks), blocks, 0);
    void save(t);
  }
  function copySelectedTo(name) {
    const i = selectedTask();
    const f = file();
    if (i == null || !f) return;
    appendTo(name, subtreeBlocks(f.blocks, i));
  }
  function moveSelectedTo(name) {
    const i = selectedTask();
    const f = file();
    if (i == null || !f) return;
    const blocks = subtreeBlocks(f.blocks, i);
    removeSubtree(f.blocks, i);
    setSelected(null);
    renderList();
    void save(f);
    appendTo(name, blocks);
  }
  document.addEventListener("paste", (e) => {
    if (S.view !== "rendered" || S.editing || targetEl(e).closest("input, textarea, .md-host")) return;
    const blocks = parseTaskLines(e.clipboardData?.getData("text/plain"));
    if (!blocks.length) return;
    e.preventDefault();
    pasteBlocks(blocks);
  });

  // src/app/drag.ts
  var drag = null;
  var INSIDE_DWELL_MS = 320;
  el.list.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = targetEl(e);
    const row = target.closest(".task");
    if (!row || target.closest(".check, .del, input")) return;
    drag = {
      row,
      x: e.clientX,
      y: e.clientY,
      active: false,
      ghost: null,
      offY: 0,
      group: [],
      rootLevel: 0,
      level: 0,
      originX: 0,
      inside: null,
      insideCandidate: null,
      insideTimer: void 0
    };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      startDrag(drag);
    }
    moveDrag(drag, e);
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  function startDrag(d) {
    if (S.editing) commitEdit();
    const f = file();
    if (!f) {
      drag = null;
      return;
    }
    d.active = true;
    S.dragging = true;
    document.body.classList.add("is-dragging");
    const i = blockIndex(d.row);
    const end = subtreeEnd(f.blocks, i);
    for (let k = i; k < end; k++) {
      const r2 = rowAt(k);
      if (r2) d.group.push(r2);
    }
    d.rootLevel = levelOf(f.blocks[i]);
    d.level = d.rootLevel;
    d.originX = d.x - d.rootLevel * LEVEL_PX;
    const r = d.row.getBoundingClientRect();
    const rootMargin = parseFloat(getComputedStyle(d.row).marginLeft) || 0;
    d.offY = d.y - r.top;
    const g = div("ghost");
    g.style.width = r.width + rootMargin + "px";
    g.style.left = r.left - rootMargin + "px";
    g.style.top = r.top + "px";
    for (const row of d.group) {
      const c = row.cloneNode(true);
      c.classList.remove("dragging");
      g.append(c);
    }
    document.body.append(g);
    d.ghost = g;
    for (const row of d.group) row.classList.add("dragging");
  }
  function visibleNext(node) {
    let n = node.nextElementSibling;
    while (n && n.classList.contains("blank")) n = n.nextElementSibling;
    return n;
  }
  function nextLevelInDom(blocks, row) {
    for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.classList.contains("dragging") || n.classList.contains("blank")) continue;
      if (n.classList.contains("task")) return levelOf(blocks[blockIndex(n)]);
      return 0;
    }
    return 0;
  }
  function prevLevelInDom(blocks, row) {
    for (let n = row.previousElementSibling; n; n = n.previousElementSibling) {
      if (n.classList.contains("dragging") || n.classList.contains("blank")) continue;
      if (n.classList.contains("task")) return levelOf(blocks[blockIndex(n)]);
      if (n.classList.contains("heading") || n.classList.contains("rule")) return -1;
    }
    return -1;
  }
  function setInside(d, row) {
    if (d.inside === row) return;
    d.inside?.classList.remove("drop-inside");
    d.inside = row;
    row?.classList.add("drop-inside");
  }
  function applyLevel(d, blocks, level) {
    if (level === d.level) return;
    d.level = level;
    const shift = level - d.rootLevel;
    for (const row of d.group) {
      row.style.marginLeft = Math.max(0, levelOf(blocks[blockIndex(row)]) + shift) * LEVEL_PX + "px";
    }
  }
  function moveDrag(d, e) {
    const f = file();
    if (!f || !d.ghost) return;
    d.ghost.style.top = e.clientY - d.offY + "px";
    const lr = el.list.getBoundingClientRect();
    if (e.clientY < lr.top + 28) el.list.scrollTop -= 10;
    else if (e.clientY > lr.bottom - 28) el.list.scrollTop += 10;
    const y = e.clientY;
    let candidate = null;
    for (const r of el.list.querySelectorAll(".task:not(.dragging)")) {
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
        d.insideTimer = setTimeout(() => {
          if (drag === d && d.insideCandidate === candidate) setInside(d, candidate);
        }, INSIDE_DWELL_MS);
      }
    }
    if (d.inside) return;
    let target = null;
    for (const r of el.list.querySelectorAll(".block:not(.blank):not(.dragging)")) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) {
        target = r;
        break;
      }
    }
    const ref = target ?? el.list.querySelector(".add-row");
    const last = d.group[d.group.length - 1];
    if (visibleNext(last) !== ref) for (const row of d.group) el.list.insertBefore(row, ref);
    const want = Math.round((e.clientX - d.originX) / LEVEL_PX);
    applyLevel(d, f.blocks, clampDropLevel(want, prevLevelInDom(f.blocks, d.row), nextLevelInDom(f.blocks, last)));
  }
  function placeInside(d, blocks, target) {
    const ti = blockIndex(target);
    const end = subtreeEnd(blocks, ti);
    let last = null;
    for (let k = end - 1; k >= ti; k--) {
      const r = rowAt(k);
      if (r && !r.classList.contains("dragging")) {
        last = r;
        break;
      }
    }
    let ref = (last ?? target).nextSibling;
    for (const row of d.group) {
      el.list.insertBefore(row, ref);
      ref = row.nextSibling;
    }
    applyLevel(d, blocks, levelOf(blocks[ti]) + 1);
  }
  function snapGroup(group) {
    const first = group[0], last = group[group.length - 1];
    const next = visibleNext(last);
    const endsSection = !next || next.classList.contains("heading") || next.classList.contains("rule") || next.classList.contains("add-row");
    if (!endsSection) return;
    let prev = first.previousElementSibling, firstBlank = null;
    while (prev && prev.classList.contains("blank")) {
      firstBlank = prev;
      prev = prev.previousElementSibling;
    }
    if (!prev || prev.classList.contains("heading") || prev.classList.contains("rule")) return;
    if (firstBlank) for (const row of group) el.list.insertBefore(row, firstBlank);
  }
  function endDrag() {
    if (!drag) return;
    const d = drag;
    if (!d.active) {
      drag = null;
      return;
    }
    clearTimeout(d.insideTimer);
    const f = file();
    if (d.inside && f) {
      placeInside(d, f.blocks, d.inside);
      d.inside.classList.remove("drop-inside");
    }
    drag = null;
    S.dragging = false;
    document.body.classList.remove("is-dragging");
    d.ghost?.remove();
    for (const row of d.group) row.classList.remove("dragging");
    suppressClicks();
    if (!d.inside) snapGroup(d.group);
    if (!f) return;
    const order = collapseBlanks([...el.list.querySelectorAll(".block")].map((x) => f.blocks[blockIndex(x)]));
    let changed = order.length !== f.blocks.length || order.some((b, i) => b !== f.blocks[i]);
    const delta = d.level - d.rootLevel;
    if (delta) {
      shiftLevels(d.group.map((row) => f.blocks[blockIndex(row)]), delta);
      changed = true;
    }
    if (changed) {
      f.blocks = order;
      renderList();
      void save(f);
    } else renderList();
    void flushPending();
  }

  // src/app/theme.ts
  var darkMQ = matchMedia("(prefers-color-scheme: dark)");
  darkMQ.addEventListener("change", () => applyTheme());
  function currentPalette() {
    if (!S.cfg) return null;
    const a = S.cfg.config.appearance;
    const dark = a === "dark" || a === "follow_os" && darkMQ.matches;
    return dark ? S.cfg.dark : S.cfg.light;
  }
  function applyTheme() {
    const p = currentPalette();
    if (!p || !S.cfg) return;
    const c = S.cfg.config, r = document.documentElement.style;
    for (const k of ["bg", "surface", "fg", "muted", "accent", "border", "danger"]) r.setProperty("--" + k, p[k]);
    r.setProperty("--accent-fg", p.accent_fg);
    r.setProperty("--bg-rgb", hexToRgb(p.bg));
    r.setProperty("--opacity", String(c.window.opacity));
    r.setProperty("--radius", c.window.corner_radius + "px");
    r.setProperty("--font-size", c.font_size + "px");
    r.setProperty("--font", c.font_family);
    document.documentElement.style.colorScheme = p.is_dark ? "dark" : "light";
    el.pin.classList.toggle("active", c.window.always_on_top);
  }

  // src/app/settings.ts
  function fillSchemes() {
    if (!S.cfg) return;
    for (const sel of [el.sLight, el.sDark]) {
      sel.textContent = "";
      for (const s of S.cfg.schemes) {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label + (s.is_dark ? " \u25D0" : " \u25CB");
        sel.append(o);
      }
    }
  }
  function syncSettingsUI() {
    if (!S.cfg) return;
    const c = S.cfg.config;
    el.sAppearance.value = c.appearance;
    el.sLight.value = c.light_scheme ?? "white";
    el.sDark.value = c.dark_scheme ?? "midnight_blue";
    el.sOpacity.value = String(c.window.opacity);
    el.sFont.value = String(c.font_size);
    el.sTop.checked = c.window.always_on_top;
    el.sClose.checked = c.tray.close_to_tray;
    el.sSpaces.checked = c.tray.visible_on_all_workspaces;
    el.sVim.checked = !!c.editor?.vim;
    getEditor()?.setVim(!!c.editor?.vim);
    const overflow = c.tabs?.overflow === "wrap" ? "wrap" : "scroll";
    el.sTabs.value = overflow;
    el.tabs.classList.toggle("wrap", overflow === "wrap");
    el.badgeBtn.textContent = BADGE_LABELS[badgeMode()];
    el.badgeBtn.classList.toggle("active", badgeMode() !== "none");
    if (S.snap) renderTabs();
    const hk = c.shortcuts.toggle_window ? `Toggle: ${c.shortcuts.toggle_window} \xB7 ` : "";
    el.sHint.textContent = `${hk}Config: ${S.cfg.config_path}`;
  }
  async function patch(p) {
    try {
      S.cfg = await invoke("update_settings", { patch: p });
      applyTheme();
      syncSettingsUI();
    } catch (e) {
      toast(e);
    }
  }
  el.sAppearance.addEventListener("change", () => void patch({ appearance: el.sAppearance.value }));
  el.sLight.addEventListener("change", () => void patch({ light_scheme: el.sLight.value }));
  el.sDark.addEventListener("change", () => void patch({ dark_scheme: el.sDark.value }));
  el.sFont.addEventListener("change", () => void patch({ font_size: +el.sFont.value }));
  el.sTop.addEventListener("change", () => void patch({ always_on_top: el.sTop.checked }));
  el.sClose.addEventListener("change", () => void patch({ close_to_tray: el.sClose.checked }));
  el.sSpaces.addEventListener("change", () => void patch({ visible_on_all_workspaces: el.sSpaces.checked }));
  el.sVim.addEventListener("change", () => void patch({ vim: el.sVim.checked }));
  el.sTabs.addEventListener("change", () => void patch({ tab_overflow: el.sTabs.value }));
  el.sOpacity.addEventListener("input", () => {
    document.documentElement.style.setProperty("--opacity", el.sOpacity.value);
    clearTimeout(S.opacityTimer);
    S.opacityTimer = setTimeout(() => void patch({ opacity: +el.sOpacity.value }), 200);
  });
  $("#s-open-config").addEventListener("click", () => invoke("open_config").catch(toast));
  $("#s-open-dir").addEventListener("click", () => invoke("open_todo_dir").catch(toast));
  $("#s-quit").addEventListener("click", () => void invoke("quit"));
  function toggleSettings(show = el.settings.hidden) {
    el.settings.hidden = !show;
    el.settingsBtn.classList.toggle("active", show);
  }
  el.settingsBtn.addEventListener("click", () => toggleSettings());
  document.addEventListener("mousedown", (e) => {
    if (!el.settings.hidden && !(e.target instanceof Element && e.target.closest("#settings, #settings-btn"))) toggleSettings(false);
  });
  el.pin.addEventListener("click", () => {
    if (S.cfg) void patch({ always_on_top: !S.cfg.config.window.always_on_top });
  });
  el.badgeBtn.addEventListener("click", () => void patch({ tab_badge: nextBadgeMode(badgeMode()) }));
  el.hide.addEventListener("click", () => void invoke("hide_window"));

  // src/app/keyboard.ts
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (targetEl(e).closest("input, textarea, button, select, a, .task, .heading, .para, .tab, .popover, .modal, .ctx, .add-row, .md-host")) return;
    void appWindow.startDragging();
  });
  document.addEventListener("contextmenu", (e) => {
    if (!targetEl(e).closest("input, textarea")) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const target = targetEl(e);
    if (e.key === "Escape") {
      if (!el.modal.hidden) {
        S.modalResolve?.(false);
        return;
      }
      if (!el.ctx.hidden) {
        closeCtx();
        return;
      }
      if (!el.settings.hidden) {
        toggleSettings(false);
        return;
      }
      if (S.editing) return;
      if (target.closest(".md-host")) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active === el.md || active.classList.contains("add"))) {
        active.blur();
        return;
      }
      if (S.selected != null) {
        setSelected(null);
        return;
      }
      void invoke("hide_window");
      return;
    }
    const typing = target.closest("input, textarea, select, .md-host");
    if (!typing && S.view === "rendered" && !S.editing) {
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && (k === "c" || k === "x") && selectedTask() != null) {
        e.preventDefault();
        if (k === "c") copySelected();
        else cutSelected();
        return;
      }
      if (mod && !e.shiftKey && k === "v") {
        if (S.clip) {
          e.preventDefault();
          void pasteFromClipboard();
        }
        return;
      }
      if (!mod && !e.altKey) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelection(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelection(-1);
          return;
        }
        const i = selectedTask();
        if (i != null) {
          if (e.key === "Enter") {
            e.preventDefault();
            const r = rowAt(i);
            if (r) startEdit(r);
            return;
          }
          if (e.key === " ") {
            e.preventDefault();
            rowAt(i)?.querySelector(".check")?.click();
            return;
          }
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            void deleteTask(i);
            return;
          }
        }
      }
    }
    if (!mod) return;
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      setView(S.view === "rendered" ? "markdown" : "rendered");
    } else if ((e.key === "n" || e.key === "N") && e.shiftKey) {
      e.preventDefault();
      newListPrompt();
    } else if (e.key === "n") {
      e.preventDefault();
      if (S.view !== "rendered") setView("rendered");
      el.list.querySelector(".add")?.focus();
    } else if (e.key === ",") {
      e.preventDefault();
      toggleSettings();
    } else if (e.key === "w") {
      e.preventDefault();
      void invoke("hide_window");
    } else if (e.key >= "1" && e.key <= "9") {
      const f = S.snap?.files[+e.key - 1];
      if (f) {
        e.preventDefault();
        setActive(f.name);
      }
    }
  });

  // src/app/main.ts
  window.addEventListener("error", (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => reportError(`unhandled: ${String(e.reason)}`));
  function reset(cfg, snap, active) {
    closeCtx();
    S.modalResolve?.(false);
    el.settings.hidden = true;
    el.settingsBtn.classList.remove("active");
    S.editing = null;
    S.selected = null;
    S.clip = null;
    S.clipText = "";
    S.pendingSnap = null;
    S.mdDirty = false;
    S.dragging = false;
    S.suppressClick = false;
    clearTimeout(S.mdTimer);
    S.cfg = cfg;
    applyTheme();
    fillSchemes();
    syncSettingsUI();
    S.snap = null;
    S.active = active;
    applySnapshot(snap);
    setView("rendered", true);
  }
  window.__todo = { get editor() {
    return getEditor();
  }, state: S, reset };
  async function init() {
    S.view = localStorage.getItem("view") === "markdown" ? "markdown" : "rendered";
    S.active = localStorage.getItem("active") || null;
    try {
      const [cfg, snap] = await Promise.all([invoke("get_config"), invoke("get_snapshot")]);
      S.cfg = cfg;
      applyTheme();
      fillSchemes();
      syncSettingsUI();
      applySnapshot(snap);
      setView(S.view, true);
      await listen("todo:snapshot", (p) => applySnapshot(p));
      await listen("todo:config", (p) => {
        S.cfg = p;
        applyTheme();
        syncSettingsUI();
      });
      await listen("todo:error", (p) => toast(p));
    } catch (e) {
      toast(e);
    }
    void invoke("window_ready");
  }
  void init();
})();
