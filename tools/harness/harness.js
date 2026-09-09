"use strict";
(() => {
  // src/harness/mock.ts
  var SCHEMES = {
    midnight_blue: ["#0b1220", "#141d31", "#dbe4f3", "#7f8fae", "#5b9dff", "#04101f", "#22304c", "#ff6b6b", true],
    white: ["#ffffff", "#f4f4f5", "#18181b", "#71717a", "#2563eb", "#ffffff", "#e4e4e7", "#dc2626", false],
    forest_mist: ["#0f1a14", "#182419", "#d9e5dc", "#7f9a88", "#6fcf97", "#06120b", "#243428", "#f08080", true],
    rose_pine_dawn: ["#faf4ed", "#fffaf3", "#575279", "#9893a5", "#d7827e", "#faf4ed", "#efe6dd", "#b4637a", false],
    molokai_dark: ["#1b1d1e", "#272a2b", "#f8f8f2", "#7e8e91", "#f92672", "#1b1d1e", "#3a3d3e", "#fd971f", true],
    molokai_light: ["#fafafa", "#f0efe9", "#272822", "#8b8b7f", "#d81b60", "#ffffff", "#e4e3dc", "#e65100", false],
    forest_light: ["#f3f7f2", "#e6eee4", "#24402c", "#6f8a75", "#2f8f5b", "#ffffff", "#d5e2d3", "#c0392b", false]
  };
  function palette(id) {
    const c = SCHEMES[id] ?? SCHEMES.midnight_blue;
    return { scheme: id, is_dark: c[8], bg: c[0], surface: c[1], fg: c[2], muted: c[3], accent: c[4], accent_fg: c[5], border: c[6], danger: c[7] };
  }
  var FIXTURE_FILES = {
    Todo: "# Todo\n\n- [ ] Drag me around\n- [ ] Click a checkbox\n- [ ] Click text to edit, press Enter for a new item\n- [ ] Switch to Markdown view (\u2318/Ctrl+E) and edit the raw file\n- [x] Install the app\n\n## Later\n\nSome note text here.\n- [ ] Nested parent\n  - [ ] Nested child\n",
    Work: "# Work\n\n- [ ] Ship the todo app\n- [x] Write the core crate\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n\n---\n\n- [ ] Below the rule\n",
    Home: "# Home\n\n"
  };
  function defaultConfig() {
    return {
      todo_dir: "~/todos",
      dark_scheme: "midnight_blue",
      light_scheme: "white",
      appearance: "dark",
      font_size: 14,
      font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
      window: { opacity: 0.92, inactive_opacity_enabled: false, inactive_opacity: 0.5, always_on_top: false, width: 380, height: 540, corner_radius: 12, start_hidden: false },
      tray: { close_to_tray: true, hide_dock_icon: true, skip_taskbar: true, visible_on_all_workspaces: true },
      shortcuts: { toggle_window: "CmdOrCtrl+Shift+Space" },
      editor: { vim: true },
      tabs: { overflow: "scroll", badge: "none" }
    };
  }
  function parse(raw) {
    const lines = raw.split("\n");
    if (raw.endsWith("\n")) lines.pop();
    if (raw === "") return [];
    return lines.map((l) => {
      if (!l.trim()) return { kind: "blank" };
      let m = /^(#{1,6})\s+(.*)$/.exec(l);
      if (m) return { kind: "heading", level: m[1].length, text: m[2].trim() };
      m = /^(\s*)[-*+]\s+\[( |x|X)\](?:\s+(.*)|$)/.exec(l);
      if (m) return { kind: "task", indent: m[1], done: m[2] !== " ", text: (m[3] ?? "").trim() };
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return { kind: "rule", text: l };
      return { kind: "text", text: l };
    });
  }
  function ser(blocks) {
    return blocks.map((b) => {
      if (b.kind !== "task") return b;
      if (/^([-*_])(\s*\1){2,}$/.test(b.text.trim())) return { kind: "rule", text: b.text.trim() };
      const h = /^(#{1,6})[ \t]+(\S.*)$/.exec(b.text.trim());
      return h ? { kind: "heading", level: h[1].length, text: h[2].trim() } : b;
    }).map((b) => b.kind === "heading" ? "#".repeat(b.level) + " " + b.text : b.kind === "task" ? b.indent + (b.done ? "- [x]" : "- [ ]") + (b.text ? " " + b.text : "") : b.kind === "text" || b.kind === "rule" ? b.text : "").map((l) => l + "\n").join("");
  }
  var MockBackend = class {
    files = {};
    config = defaultConfig();
    order = [];
    colors = {};
    calls = [];
    side = "left";
    listeners = {};
    constructor() {
      this.reset();
    }
    /** Back to the fixture: three files, default config, no order/colors. */
    reset() {
      this.files = { ...FIXTURE_FILES };
      this.config = defaultConfig();
      this.order = [];
      this.colors = {};
      this.calls = [];
      this.side = "left";
    }
    rank(n) {
      const i = this.order.indexOf(n);
      return i < 0 ? 1e9 : i;
    }
    snapshot() {
      const names = Object.keys(this.files).sort((a, b) => this.rank(a) - this.rank(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
      return { dir: "/mock/todos", files: names.map((name) => ({ name, raw: this.files[name], blocks: parse(this.files[name]), ...this.colors[name] ? { color: this.colors[name] } : {} })) };
    }
    cfgPayload() {
      return {
        config: this.config,
        light: palette(this.config.light_scheme ?? "white"),
        dark: palette(this.config.dark_scheme ?? "midnight_blue"),
        config_path: "/mock/.todo_config.toml",
        platform: "mock",
        schemes: Object.keys(SCHEMES).map((id) => ({ id, label: id, is_dark: SCHEMES[id][8] }))
      };
    }
    /** Simulate an external edit: the backend would emit a snapshot event. */
    emit(name, payload) {
      for (const f of this.listeners[name] ?? []) f({ payload });
    }
    handle(cmd, args) {
      this.calls.push(cmd);
      const a = args;
      switch (cmd) {
        case "get_config":
          return this.cfgPayload();
        case "get_snapshot":
          return this.snapshot();
        case "save_blocks": {
          const { name, blocks } = a;
          this.files[name] = ser(blocks);
          return this.files[name];
        }
        case "save_raw": {
          const { name, raw } = a;
          this.files[name] = raw;
          return parse(raw);
        }
        case "create_file": {
          const name = a.name.replace(/\.md$/, "");
          if (this.files[name]) throw "file already exists: " + name;
          this.files[name] = `# ${name}

`;
          return { name, snapshot: this.snapshot() };
        }
        case "rename_file": {
          const { from } = a;
          const to = a.to.replace(/\.md$/, "");
          if (!this.files[from]) throw "no such file: " + from;
          if (this.files[to] && to !== from) throw "file already exists: " + to;
          this.files[to] = this.files[from];
          delete this.files[from];
          this.order = this.order.map((n) => n === from ? to : n);
          if (this.colors[from]) {
            this.colors[to] = this.colors[from];
            delete this.colors[from];
          }
          return { name: to, snapshot: this.snapshot() };
        }
        case "delete_file": {
          const { name } = a;
          delete this.files[name];
          this.order = this.order.filter((n) => n !== name);
          delete this.colors[name];
          return this.snapshot();
        }
        case "set_tab_order": {
          this.order = a.names.filter((n) => this.files[n]);
          return this.snapshot();
        }
        case "set_tab_color": {
          const { name, color } = a;
          if (color) this.colors[name] = color;
          else delete this.colors[name];
          return this.snapshot();
        }
        case "update_settings": {
          const patch = a.patch;
          for (const [k, v] of Object.entries(patch)) {
            if (k === "opacity" || k === "always_on_top" || k === "inactive_opacity_enabled" || k === "inactive_opacity") this.config.window[k] = v;
            else if (k === "close_to_tray" || k === "visible_on_all_workspaces") this.config.tray[k] = v;
            else if (k === "vim") this.config.editor.vim = v;
            else if (k === "tab_overflow") this.config.tabs.overflow = v;
            else if (k === "tab_badge") this.config.tabs.badge = v;
            else this.config[k] = v;
          }
          return this.cfgPayload();
        }
        case "get_window_side":
          return this.side;
        case "is_window_focused":
          return true;
        case "mirror_window":
          this.side = this.side === "left" ? "right" : "left";
          return this.side;
        case "log":
          console.log("[ui]", a.msg);
          return void 0;
        case "window_ready":
        case "hide_window":
        case "open_config":
        case "open_todo_dir":
        case "quit":
          console.log("[" + cmd + "]");
          return void 0;
        default:
          throw "unknown command " + String(cmd);
      }
    }
    /** The `window.__TAURI__` object the app expects. */
    global() {
      return {
        core: { invoke: async (cmd, args) => this.handle(cmd, args) },
        event: { listen: async (n, f) => {
          (this.listeners[n] ??= []).push(f);
          return () => {
          };
        } },
        window: { getCurrentWindow: () => ({ startDragging: async () => {
          console.log("[startDragging]");
        } }) }
      };
    }
  };

  // src/harness/scenarios.ts
  var q = (s) => document.querySelector(s);
  var qa = (s) => [...document.querySelectorAll(s)];
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var texts = () => qa("#list .task .text").map((t) => (t.textContent ?? "").trim());
  var rows = () => qa("#list .task");
  var tab = (name) => qa(".tab").find((t) => t.firstChild?.textContent === name);
  var ctxButtons = () => qa("#ctx button").map((b) => b.textContent ?? "");
  var ctxClick = (label) => {
    qa("#ctx button").find((b) => b.textContent === label)?.click();
  };
  var state = () => window.__todo.state;
  function ptr(type, target, x, y, extra = {}) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, ...extra }));
  }
  function key(k, o = {}, target = document) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
  }
  function mouse(type, target, x = 60, y = 120) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }
  var mid = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  var top = (el) => el.getBoundingClientRect().top + 2;
  var addRowTop = () => top(q("#list .add-row"));
  async function dragRow(fromIdx, toY, { dx = 0, dwell = 0 } = {}) {
    const row = rows()[fromIdx];
    const r = row.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    ptr("pointerdown", row.querySelector(".text"), x, y);
    ptr("pointermove", window, x, y + 8);
    await sleep(5);
    for (let i = 1; i <= 6; i++) {
      ptr("pointermove", window, x + dx * i / 6, y + (toY - y) * i / 6);
      await sleep(5);
    }
    if (dwell) {
      await sleep(dwell);
      ptr("pointermove", window, x + dx, toY + 0.5);
      await sleep(10);
    }
    ptr("pointerup", window, x + dx, toY);
    await sleep(20);
  }
  async function editRow(idx, text, k = "Enter") {
    qa("#list .task .text")[idx].click();
    await sleep(10);
    const inp = q("#list .edit");
    inp.value = text;
    key(k, {}, inp);
    await sleep(10);
  }
  async function addTodo(text) {
    const add = q("#list .add");
    add.value = text;
    key("Enter", {}, add);
    await sleep(10);
  }
  async function waitFor(cond, ms = 3e3) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await sleep(20);
    }
    return cond();
  }
  var scenarios = [
    { name: "renders", async run({ check }) {
      check("tabs alphabetical", qa(".tab").map((t) => t.textContent).join() === "Home,Todo,Work" && q(".tab.active")?.textContent === "Todo");
      check("hidden elements hidden", getComputedStyle(q("#modal")).display === "none" && getComputedStyle(q("#empty")).display === "none" && getComputedStyle(q("#ctx")).display === "none");
      check("7 tasks rendered", rows().length === 7);
      check("nested indent", rows()[6].style.marginLeft === "18px");
      check("count", q("#count").textContent === "6 left");
      check("grab cursor on rows", getComputedStyle(rows()[0]).cursor === "grab");
    } },
    { name: "toggle", async run({ F, check }) {
      qa("#list .task .check")[0].click();
      await sleep(10);
      check("toggle writes [x]", F.Todo.includes("- [x] Drag me around"));
      check("count updated", q("#count").textContent === "5 left");
      qa("#list .task .check")[0].click();
      await sleep(10);
      check("toggle back", F.Todo.includes("- [ ] Drag me around"));
    } },
    { name: "inline edit", async run({ F, check }) {
      qa("#list .task .text")[1].click();
      await sleep(10);
      const inp = q("#list .edit");
      check("edit input shown with text", !!inp && inp.value === "Click a checkbox");
      inp.value = "Click a checkbox!";
      key("Enter", {}, inp);
      await sleep(10);
      check("edit saved", F.Todo.includes("- [ ] Click a checkbox!"));
      const inp2 = q("#list .edit");
      check("enter starts a new empty item", !!inp2 && inp2.value === "");
      inp2.value = "Brand new";
      key("Enter", {}, inp2);
      await sleep(10);
      check("new item saved after previous", /Click a checkbox!\n- \[ \] Brand new\n/.test(F.Todo));
      key("Escape", {}, q("#list .edit"));
      await sleep(10);
      check("escape drops the empty new item", !q("#list .edit") && rows().length === 8);
      await editRow(0, "", "Enter");
      check("emptying an existing item keeps it as an empty task", F.Todo.includes("- [ ]\n- [ ] Click a checkbox!"));
      check("enter still starts the next item", q("#list .edit")?.value === "" && rows().length === 9);
      key("Escape", {}, q("#list .edit"));
      await sleep(10);
      check("escape drops it again", !q("#list .edit") && rows().length === 8);
    } },
    { name: "add box", async run({ F, check }) {
      await addTodo("From add box");
      check("appends at end of section", F.Todo.endsWith("  - [ ] Nested child\n- [ ] From add box\n"));
      check("add input refocused", document.activeElement === q("#list .add"));
    } },
    { name: "typed dividers and headings", async run({ F, check }) {
      await addTodo("-----");
      check("dashes add a divider", F.Todo.endsWith("- [ ] Nested child\n-----\n") && qa("#list .rule").length === 1 && !F.Todo.includes("- [ ] ---"));
      await editRow(0, "***");
      check("editing to *** makes a divider", F.Todo.includes("# Todo\n\n***\n") && !q("#list .edit") && qa("#list .rule").length === 2);
      mouse("contextmenu", qa("#list .rule")[0]);
      await sleep(10);
      check("divider menu", ctxButtons().join() === "Delete divider");
      ctxClick("Delete divider");
      await sleep(10);
      check("divider deleted", !F.Todo.includes("***") && qa("#list .rule").length === 1);
      await addTodo("## Tonight");
      check("hash text adds a heading", F.Todo.endsWith("-----\n## Tonight\n") && qa("#list .heading.h2").some((h) => h.textContent === "Tonight"));
      await editRow(0, "### Later today");
      check("editing to ### makes a heading", F.Todo.includes("# Todo\n\n### Later today\n") && !q("#list .edit"));
      await addTodo("#notaheading");
      check("no space after # stays a todo", F.Todo.endsWith("## Tonight\n- [ ] #notaheading\n"));
    } },
    { name: "drag reorder within a section", async run({ F, check }) {
      const before = texts();
      await dragRow(0, top(qa("#list .heading")[1]));
      check("ghost removed", !q(".ghost") && !document.body.classList.contains("is-dragging"));
      const after = texts();
      check("drag reorders", after[0] === before[1] && after[4] === before[0]);
      check("serialised inside the section", /- \[x\] Install the app\n- \[ \] Drag me around\n\n## Later/.test(F.Todo));
    } },
    { name: "delete asks first", async run({ F, check }) {
      qa("#list .task .del")[0].click();
      await sleep(10);
      check("modal shown", getComputedStyle(q("#modal")).display !== "none");
      q("#modal-cancel").click();
      await sleep(10);
      check("cancel keeps item", rows().length === 7);
      qa("#list .task .del")[0].click();
      await sleep(10);
      q("#modal-ok").click();
      await sleep(10);
      check("delete removes item", rows().length === 6 && !F.Todo.includes("Drag me around"));
      rows()[4].click();
      key("Backspace");
      await sleep(10);
      check("deleting a parent mentions nested count", /"Nested parent" and 1 nested item\?/.test(q("#modal-msg").textContent ?? ""));
      q("#modal-ok").click();
      await sleep(10);
      check("subtree deleted", rows().length === 4 && !F.Todo.includes("Nested"));
    } },
    { name: "markdown editor with vim", async run({ F, check }) {
      key("e", { metaKey: true });
      check("editor loaded", await waitFor(() => !!window.__todo?.editor && !q("#md-host").hidden));
      const ed = window.__todo.editor;
      check("codemirror, not textarea", !ed.isTextarea && !!q(".md-host .cm-editor") && q("#list").hidden);
      check("editor shows file", ed.getValue() === F.Todo);
      check("vim status panel", /NORMAL/.test(q(".cm-vim-panel")?.textContent ?? ""));
      const content = q(".cm-content");
      const vkey = (k) => key(k, { code: "Key" + k.toUpperCase() }, content);
      vkey("d");
      vkey("d");
      await sleep(300);
      check("vim dd deletes first line", !F.Todo.startsWith("# Todo") && ed.getValue() === F.Todo);
      vkey("u");
      await sleep(300);
      check("vim u undoes", F.Todo.startsWith("# Todo"));
      vkey("i");
      await sleep(10);
      check("vim insert mode", ed.mode?.() === "insert" && /INSERT/.test(q(".cm-vim-panel").textContent ?? ""));
      key("Escape", {}, content);
      await sleep(10);
      check("escape back to normal", ed.mode?.() === "normal");
      const view = ed.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# Todo\n\n- [ ] only one\n" } });
      await sleep(300);
      check("markdown saved", F.Todo === "# Todo\n\n- [ ] only one\n");
      key("e", { metaKey: true });
      await sleep(10);
      check("back to list, re-rendered", !q("#list").hidden && texts().join() === "only one");
    } },
    { name: "external change", async run({ mock: mock2, check }) {
      mock2.files.Todo = "# Todo\n\n- [ ] external\n- [x] change\n";
      mock2.emit("todo:snapshot", mock2.snapshot());
      await sleep(10);
      check("external snapshot applied", texts().join() === "external,change");
      delete mock2.files.Work;
      mock2.emit("todo:snapshot", mock2.snapshot());
      await sleep(10);
      check("removed file drops its tab", qa(".tab").map((t) => t.textContent).join() === "Home,Todo");
    } },
    { name: "tabs: switch, create, rename, menu", async run({ F, check }) {
      tab("Work").click();
      await sleep(10);
      check("switch tab", q(".tab.active")?.textContent === "Work" && texts()[0] === "Ship the todo app");
      q("#new-tab").click();
      await sleep(10);
      const ti = q(".tab-input");
      ti.value = "Personal";
      key("Enter", {}, ti);
      await sleep(20);
      check("new list created + active", q(".tab.active")?.textContent === "Personal" && F.Personal === "# Personal\n\n");
      mouse("dblclick", q(".tab.active"));
      await sleep(10);
      const ri = q(".tab-input");
      check("rename input prefilled", !!ri && ri.value === "Personal");
      ri.value = "Projects";
      key("Enter", {}, ri);
      await sleep(20);
      check("renamed file + tab", !!F.Projects && !F.Personal && q(".tab.active")?.textContent === "Projects");
      mouse("dblclick", q(".tab.active"));
      await sleep(10);
      key("Escape", {}, q(".tab-input"));
      await sleep(10);
      check("rename escape restores tab", !q(".tab-input") && q(".tab.active")?.textContent === "Projects");
      mouse("contextmenu", q(".tab.active"));
      await sleep(10);
      check("tab menu", ctxButtons().join("|") === "Rename\u2026|Color\u2026|Delete\u2026");
      ctxClick("Rename\u2026");
      await sleep(10);
      check("menu rename opens input", q("#ctx").hidden && q(".tab-input")?.value === "Projects");
      key("Escape", {}, q(".tab-input"));
      await sleep(10);
      mouse("contextmenu", q(".tab.active"));
      await sleep(10);
      ctxClick("Delete\u2026");
      await sleep(10);
      check("menu delete asks", !q("#modal").hidden && /Projects/.test(q("#modal-msg").textContent ?? ""));
      q("#modal-cancel").click();
      await sleep(10);
      check("delete cancelled keeps list", !!F.Projects && q("#modal").hidden);
      mouse("contextmenu", q(".tab.active"));
      await sleep(10);
      key("Escape");
      await sleep(10);
      check("escape closes menu", q("#ctx").hidden);
      mouse("contextmenu", q(".tab.active"));
      await sleep(10);
      ctxClick("Delete\u2026");
      await sleep(10);
      q("#modal-ok").click();
      await sleep(20);
      check("delete removes list", !F.Projects && q(".tab.active")?.textContent === "Home");
    } },
    { name: "tab reorder by drag", async run({ mock: mock2, check }) {
      const tabs = qa(".tab");
      const work = tabs[2], wr = work.getBoundingClientRect(), hr = tabs[0].getBoundingClientRect();
      const y = wr.top + wr.height / 2;
      ptr("pointerdown", work, wr.left + wr.width / 2, y);
      ptr("pointermove", window, wr.left + wr.width / 2 - 10, y);
      await sleep(5);
      ptr("pointermove", window, hr.left + 2, y);
      await sleep(5);
      check("tab follows pointer", qa(".tab")[0] === work && work.classList.contains("dragging"));
      ptr("pointerup", window, hr.left + 2, y);
      await sleep(20);
      check("tab order persisted", mock2.order.join() === "Work,Home,Todo" && qa(".tab").map((t) => t.textContent).join() === "Work,Home,Todo");
      check("active tab unchanged by reorder", q(".tab.active")?.textContent === "Todo");
    } },
    { name: "tab color", async run({ mock: mock2, check }) {
      mouse("contextmenu", tab("Work"));
      await sleep(10);
      ctxClick("Color\u2026");
      await sleep(10);
      check("color submenu", ctxButtons().length === 11 && qa("#ctx .swatch").length === 10 && q("#ctx button.checked")?.textContent === "None");
      ctxClick("Blue");
      await sleep(20);
      const colored = tab("Work");
      check("tab colored + persisted", mock2.colors.Work === "#3e63dd" && colored.dataset.color === "#3e63dd" && colored.style.getPropertyValue("--tab-color") === "#3e63dd");
      mouse("contextmenu", colored);
      await sleep(10);
      ctxClick("Color\u2026");
      await sleep(10);
      check("current color checked", q("#ctx button.checked")?.textContent === "Blue");
      ctxClick("None");
      await sleep(20);
      check("color cleared", !mock2.colors.Work && !tab("Work").dataset.color);
    } },
    { name: "progress badges", active: "Work", async run({ mock: mock2, check }) {
      const badgeOf = (name) => tab(name)?.querySelector(".badge")?.textContent ?? "";
      const btn = () => q("#badge-btn .sample")?.textContent ?? "";
      const ringOffset = () => parseFloat(qa("#badge-btn .ring circle")[1]?.getAttribute("stroke-dashoffset") ?? "-1");
      check("badges off by default", btn() === "off" && !q(".tab .badge") && !!q("#badge-btn .ring"));
      {
        const b = q("#badge-btn");
        const cs = getComputedStyle(b);
        check("button lays out ring and text side by side", /flex/.test(cs.display) && b.offsetWidth > 30 && b.offsetWidth < 70 && b.offsetHeight <= 26);
      }
      q("#badge-btn").click();
      await sleep(10);
      check("ratio badge, button previews the active tab", mock2.config.tabs.badge === "ratio" && btn() === "1/6" && badgeOf("Work") === "1/6" && badgeOf("Home") === "");
      check("ring shows 1/6 done", Math.abs(ringOffset() - 2 * Math.PI * 5.5 * (5 / 6)) < 0.05);
      q("#badge-btn").click();
      await sleep(10);
      check("percent badge", btn() === "17%" && badgeOf("Work") === "17%");
      q("#badge-btn").click();
      await sleep(10);
      check("remaining badge", btn() === "(5)" && badgeOf("Work") === "(5)");
      qa("#list .task .check")[0].click();
      await sleep(10);
      check("badge + button update on toggle", badgeOf("Work") === "(4)" && btn() === "(4)" && Math.abs(ringOffset() - 2 * Math.PI * 5.5 * (4 / 6)) < 0.05);
      tab("Home").click();
      await sleep(10);
      check("empty list shows a placeholder preview", btn() === "(2)" && q("#badge-btn").classList.contains("placeholder"));
      q("#badge-btn").click();
      await sleep(10);
      check("badges cycle back to off", btn() === "off" && !q(".tab .badge") && /Click for completed\/total/.test(q("#badge-btn").title));
    } },
    { name: "nesting: subtree drag, tab indent, no adoption", active: "Work", async run({ F, check }) {
      check("rule rendered", qa("#list .rule").length === 1);
      check("nested rows indented", rows()[3].style.marginLeft === "18px");
      await dragRow(2, top(rows()[0]));
      check("subtree moved together", texts().slice(0, 5).join("|") === "Parent|Child A|Child B|Ship the todo app|Write the core crate");
      check("subtree serialised", F.Work.startsWith("# Work\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [ ] Ship the todo app\n"));
      qa("#list .task .text")[3].click();
      await sleep(10);
      const inp = q("#list .edit");
      key("Tab", {}, inp);
      await sleep(10);
      check("tab indents one level", F.Work.includes("  - [ ] Child B\n  - [ ] Ship the todo app\n"));
      key("Tab", {}, inp);
      await sleep(10);
      check("tab again nests under Child B", F.Work.includes("  - [ ] Child B\n    - [ ] Ship the todo app\n"));
      key("Tab", {}, inp);
      await sleep(10);
      check("cannot nest deeper than one below previous", F.Work.includes("    - [ ] Ship the todo app\n"));
      key("Tab", { shiftKey: true }, inp);
      key("Tab", { shiftKey: true }, inp);
      await sleep(10);
      check("shift-tab outdents to root", F.Work.includes("  - [ ] Child B\n- [ ] Ship the todo app\n"));
      key("Escape", {}, inp);
      await sleep(10);
      await dragRow(3, top(rows()[1]), { dx: -60 });
      check("no adoption: joins as sibling of the children", F.Work.startsWith("# Work\n\n- [ ] Parent\n  - [ ] Ship the todo app\n  - [ ] Child A\n  - [ ] Child B\n- [x] Write"));
      await dragRow(1, top(rows()[4]), { dx: -60 });
      check("drag back out to root after the subtree", F.Work.startsWith("# Work\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [ ] Ship the todo app\n- [x] Write"));
      await dragRow(4, addRowTop(), { dx: -40 });
      check("drag past the rule", F.Work.endsWith("---\n\n- [ ] Below the rule\n- [x] Write the core crate\n"));
    } },
    { name: "nesting gestures: slight right and hover drop-inside", active: "Work", async run({ F, check }) {
      await dragRow(1, rows()[4].getBoundingClientRect().bottom + 2, { dx: 14 });
      check("slight right drag nests under the item above", F.Work.includes("  - [ ] Child B\n  - [x] Write the core crate\n\n---"));
      await dragRow(5, mid(rows()[1]), { dwell: 450 });
      check("drop-inside highlight cleared", !q(".drop-inside"));
      check("hover-drop nests as last child", F.Work.includes("  - [x] Write the core crate\n  - [ ] Below the rule\n\n---"));
      await dragRow(5, addRowTop(), { dx: -60 });
      check("drag out to root at the end", F.Work.endsWith("---\n\n- [ ] Below the rule\n"));
    } },
    { name: "clipboard: copy, cut, paste, cross-tab, external", active: "Work", async run({ F, mock: mock2, check }) {
      rows()[2].click();
      await sleep(5);
      check("click selects row", rows()[2].classList.contains("selected") && state().selected === 4);
      key("c", { metaKey: true });
      check("copy captures subtree", state().clip?.length === 3 && state().clipText === "- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n");
      rows()[0].click();
      await sleep(5);
      key("v", { metaKey: true });
      await sleep(250);
      check("paste after selected sibling", F.Work.includes("- [ ] Ship the todo app\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [x] Write"));
      check("pasted root selected", q("#list .task.selected .text")?.textContent === "Parent" && state().selected === 3);
      key("x", { metaKey: true });
      await sleep(10);
      check("cut removes subtree", F.Work === mock2.snapshot().files.find((f) => f.name === "Work").raw && rows().length === 6 && !F.Work.includes("Ship the todo app\n- [ ] Parent"));
      tab("Home").click();
      await sleep(10);
      key("v", { metaKey: true });
      await sleep(250);
      check("paste into other tab at end", F.Home === "# Home\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n");
      mouse("contextmenu", rows()[0]);
      await sleep(10);
      check("todo menu items", ctxButtons().join("|") === "Copy|Cut|Paste|Copy to\u2026|Move to\u2026|Delete\u2026");
      ctxClick("Move to\u2026");
      await sleep(10);
      check("move submenu lists other tabs", ctxButtons().join("|") === "\u2039 Back|Todo|Work");
      ctxClick("Work");
      await sleep(30);
      check("moved out of source", F.Home === "# Home\n\n" && rows().length === 0);
      check("moved into target end", F.Work.endsWith("- [ ] Below the rule\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n"));
      const dt = new DataTransfer();
      dt.setData("text/plain", "notes\n  - [ ] pasted\n    - [x] child\n");
      document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      await sleep(30);
      check("external paste parses tasks", F.Home === "# Home\n\n- [ ] pasted\n  - [x] child\n");
      key("ArrowDown");
      key("ArrowDown");
      check("arrow selects next", q("#list .task.selected .text")?.textContent === "child");
      key(" ");
      await sleep(10);
      check("space toggles", F.Home.includes("  - [ ] child"));
      key("ArrowUp");
      key("Backspace");
      await sleep(10);
      check("delete asks incl. nested count", !q("#modal").hidden && /"pasted" and 1 nested item\?/.test(q("#modal-msg").textContent ?? ""));
      q("#modal-ok").click();
      await sleep(10);
      check("subtree deleted", F.Home === "# Home\n\n");
      key("Escape");
      check("escape clears selection", state().selected === null);
    } },
    { name: "inactive fade", async run({ mock: mock2, check }) {
      const opacity = () => getComputedStyle(document.documentElement).getPropertyValue("--opacity").trim();
      check("slider disabled while off", opacity() === "0.92" && q("#s-fade-opacity").disabled);
      mock2.emit("todo:focus", false);
      await sleep(5);
      check("no fade while the setting is off", opacity() === "0.92");
      const fade = q("#s-fade");
      fade.checked = true;
      fade.dispatchEvent(new Event("change"));
      await sleep(10);
      check("enabled + persisted", mock2.config.window.inactive_opacity_enabled && !q("#s-fade-opacity").disabled);
      check("fades when unfocused", opacity() === "0.5");
      document.documentElement.dispatchEvent(new MouseEvent("mouseenter"));
      await sleep(5);
      check("hover restores", opacity() === "0.92");
      document.documentElement.dispatchEvent(new MouseEvent("mouseleave"));
      await sleep(5);
      check("leaving fades again", opacity() === "0.5");
      mock2.emit("todo:focus", true);
      await sleep(5);
      check("focus restores", opacity() === "0.92");
      document.documentElement.dispatchEvent(new MouseEvent("mouseenter"));
      await sleep(5);
      mock2.emit("todo:focus", false);
      await sleep(5);
      check("losing focus fades even with a stale hover flag", opacity() === "0.5" && !state().hovered);
      state().hovered = true;
      document.documentElement.style.setProperty("--opacity", "0.92");
      await sleep(1100);
      check("periodic reconcile catches a stale hover", opacity() === "0.5");
      mock2.emit("todo:focus", true);
      await sleep(5);
      const slider = q("#s-fade-opacity");
      slider.value = "0.3";
      slider.dispatchEvent(new Event("input"));
      await sleep(260);
      mock2.emit("todo:focus", false);
      await sleep(5);
      check("custom faded opacity persisted and applied", mock2.config.window.inactive_opacity === 0.3 && opacity() === "0.3");
      fade.checked = false;
      fade.dispatchEvent(new Event("change"));
      await sleep(10);
      check("turning it off restores immediately", opacity() === "0.92" && !mock2.config.window.inactive_opacity_enabled);
    } },
    { name: "mirror to the other side of the screen", async run({ mock: mock2, check }) {
      const btn = q("#mirror-btn");
      const filled = () => btn.querySelector("g rect")?.getAttribute("x") ?? "";
      check("starts on the left, icon shades the right half", btn.dataset.target === "right" && filled() === "12" && /right side/.test(btn.title));
      btn.click();
      await sleep(10);
      check("click asks the backend to mirror", mock2.calls.includes("mirror_window") && mock2.side === "right");
      check("icon now shades the left half", btn.dataset.target === "left" && filled() === "4" && /left side/.test(btn.title));
      btn.click();
      await sleep(10);
      check("click again jumps back", mock2.side === "left" && btn.dataset.target === "right");
      key("ArrowRight", { metaKey: true, shiftKey: true });
      await sleep(10);
      check("cmd+shift+arrow mirrors too", mock2.side === "right");
      mock2.emit("todo:moved", "left");
      await sleep(5);
      check("dragging the window elsewhere updates the icon", btn.dataset.target === "right");
    } },
    { name: "nothing stays opaque when the window is translucent", active: "Work", async run({ mock: mock2, check }) {
      const alphaOf = (c) => {
        if (c === "transparent" || c === "rgba(0, 0, 0, 0)") return 0;
        const slash = /\/\s*([\d.]+%?)\s*\)/.exec(c);
        if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (!m) return 1;
        const parts = m[1].split(/[\s,]+/).filter(Boolean);
        return parts.length >= 4 ? parseFloat(parts[3]) : 1;
      };
      const audit = (label) => {
        const opaque = [];
        for (const e of qa("#app *")) {
          if (e.closest(".check, .swatch, .toast, .ring, .md-host, svg")) continue;
          const a = alphaOf(getComputedStyle(e).backgroundColor);
          if (a >= 1) opaque.push(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${[...e.classList].join(".")}`);
        }
        check(`${label}: no opaque backgrounds (${opaque.slice(0, 4).join(" ") || "ok"})`, opaque.length === 0);
        check(`${label}: app itself is translucent`, alphaOf(getComputedStyle(q("#app")).backgroundColor) < 1);
      };
      mock2.colors.Work = "#3e63dd";
      mock2.emit("todo:snapshot", mock2.snapshot());
      await sleep(10);
      rows()[0].click();
      await sleep(5);
      audit("list view (dark theme)");
      mouse("contextmenu", rows()[0]);
      await sleep(10);
      q("#settings-btn").click();
      await sleep(10);
      audit("menus open");
      key("Escape");
      key("Escape");
      await sleep(5);
      qa("#list .task .del")[0].click();
      await sleep(10);
      audit("confirm dialog");
      q("#modal-cancel").click();
      await sleep(5);
      const sel = q("#s-appearance");
      sel.value = "light";
      sel.dispatchEvent(new Event("change"));
      await sleep(10);
      audit("light theme");
      key("e", { metaKey: true });
      await waitFor(() => !!window.__todo?.editor);
      await sleep(50);
      audit("markdown view");
    } },
    { name: "settings", async run({ mock: mock2, check }) {
      q("#settings-btn").click();
      await sleep(10);
      check("settings open", !q("#settings").hidden);
      const sel = q("#s-appearance");
      sel.value = "light";
      sel.dispatchEvent(new Event("change"));
      await sleep(10);
      check("light theme applied", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#ffffff" && mock2.config.appearance === "light");
      const tabsSel = q("#s-tabs");
      tabsSel.value = "wrap";
      tabsSel.dispatchEvent(new Event("change"));
      await sleep(10);
      check("tab overflow wrap applied", mock2.config.tabs.overflow === "wrap" && q("#tabs").classList.contains("wrap") && getComputedStyle(q("#tabs")).flexWrap === "wrap");
      q("#pin-btn").click();
      await sleep(10);
      check("pin toggles always-on-top", mock2.config.window.always_on_top && q("#pin-btn").classList.contains("active"));
      key("Escape");
      check("escape closes settings", q("#settings").hidden);
    } }
  ];
  async function runAll(mock2) {
    const out = [];
    let pass = 0, fail = 0;
    for (const sc of scenarios) {
      mock2.reset();
      localStorage.setItem("active", sc.active ?? "Todo");
      window.__todo.reset(mock2.cfgPayload(), mock2.snapshot(), sc.active ?? "Todo");
      await sleep(10);
      const check = (name, cond) => {
        out.push(`${cond ? "PASS" : "FAIL"} ${sc.name}: ${name}`);
        if (cond) pass++;
        else fail++;
      };
      try {
        await sc.run({ mock: mock2, F: mock2.files, check });
      } catch (e) {
        out.push(`FAIL ${sc.name}: ERROR ${String(e)}
${e.stack ?? ""}`);
        fail++;
      }
    }
    out.push(`# ${pass} pass, ${fail} fail`);
    return out;
  }
  async function demoInside() {
    const row = rows()[5], r = row.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    ptr("pointerdown", row.querySelector(".text"), x, y);
    const midY = mid(rows()[0]);
    for (let i = 1; i <= 6; i++) {
      ptr("pointermove", window, x, y + (midY - y) * i / 6);
      await sleep(5);
    }
    await sleep(400);
    ptr("pointermove", window, x, midY + 0.5);
  }

  // src/harness/main.ts
  var mock = new MockBackend();
  var qs = new URLSearchParams(location.search);
  localStorage.setItem("view", qs.has("md") ? "markdown" : "rendered");
  localStorage.setItem("active", qs.get("tab") ?? "Todo");
  var scheme = qs.get("scheme");
  if (scheme) mock.config.dark_scheme = scheme;
  if (qs.has("wrap")) {
    mock.config.tabs.overflow = "wrap";
    for (const n of ["Groceries", "Reading list", "Someday", "Errands"]) mock.files[n] = `# ${n}

- [ ] one
`;
  }
  if (qs.has("colors")) {
    mock.colors.Work = "#3e63dd";
    mock.colors.Todo = "#30a46c";
  }
  var badge = qs.get("badge");
  if (badge === "ratio" || badge === "percent" || badge === "remaining") mock.config.tabs.badge = badge;
  window.__TAURI__ = mock.global();
  var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__harness = {
    mock,
    async afterAppLoad() {
      for (let i = 0; i < 200 && !window.__todo?.state.cfg; i++) await sleep2(10);
      if (qs.has("autotest")) {
        const lines = await runAll(mock);
        const pre = document.createElement("pre");
        pre.id = "results";
        pre.textContent = lines.join("\n");
        document.body.append(pre);
      } else if (qs.get("demo") === "inside") {
        await demoInside();
      }
    }
  };
})();
