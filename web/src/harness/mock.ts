/** An in-memory stand-in for the Tauri backend so ui/ runs in a normal browser. */
import type { Block, Config, ConfigPayload, Palette, SettingsPatch, Snapshot } from '../app/types.ts';
import type { Commands, TauriGlobal } from '../app/tauri.ts';

const SCHEMES: Record<string, [string, string, string, string, string, string, string, string, boolean]> = {
  midnight_blue: ['#0b1220', '#141d31', '#dbe4f3', '#7f8fae', '#5b9dff', '#04101f', '#22304c', '#ff6b6b', true],
  white: ['#ffffff', '#f4f4f5', '#18181b', '#71717a', '#2563eb', '#ffffff', '#e4e4e7', '#dc2626', false],
  forest_mist: ['#0f1a14', '#182419', '#d9e5dc', '#7f9a88', '#6fcf97', '#06120b', '#243428', '#f08080', true],
  rose_pine_dawn: ['#faf4ed', '#fffaf3', '#575279', '#9893a5', '#d7827e', '#faf4ed', '#efe6dd', '#b4637a', false],
  molokai_dark: ['#1b1d1e', '#272a2b', '#f8f8f2', '#7e8e91', '#f92672', '#1b1d1e', '#3a3d3e', '#fd971f', true],
  molokai_light: ['#fafafa', '#f0efe9', '#272822', '#8b8b7f', '#d81b60', '#ffffff', '#e4e3dc', '#e65100', false],
  forest_light: ['#f3f7f2', '#e6eee4', '#24402c', '#6f8a75', '#2f8f5b', '#ffffff', '#d5e2d3', '#c0392b', false],
};

function palette(id: string): Palette {
  const c = SCHEMES[id] ?? SCHEMES.midnight_blue;
  return { scheme: id, is_dark: c[8], bg: c[0], surface: c[1], fg: c[2], muted: c[3], accent: c[4], accent_fg: c[5], border: c[6], danger: c[7] };
}

export const FIXTURE_FILES: Record<string, string> = {
  Todo: '# Todo\n\n- [ ] Drag me around\n- [ ] Click a checkbox\n- [ ] Click text to edit, press Enter for a new item\n- [ ] Switch to Markdown view (⌘/Ctrl+E) and edit the raw file\n- [x] Install the app\n\n## Later\n\nSome note text here.\n- [ ] Nested parent\n  - [ ] Nested child\n',
  Work: '# Work\n\n- [ ] Ship the todo app\n- [x] Write the core crate\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n\n---\n\n- [ ] Below the rule\n',
  Home: '# Home\n\n',
};

function defaultConfig(): Config {
  return {
    todo_dir: '~/todos', dark_scheme: 'midnight_blue', light_scheme: 'white', appearance: 'dark', font_size: 14,
    font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
    window: { opacity: 0.92, always_on_top: false, width: 380, height: 540, corner_radius: 12, start_hidden: false },
    tray: { close_to_tray: true, hide_dock_icon: true, skip_taskbar: true, visible_on_all_workspaces: true },
    shortcuts: { toggle_window: 'CmdOrCtrl+Shift+Space' },
    editor: { vim: true },
    tabs: { overflow: 'scroll', badge: 'none' },
  };
}

export function parse(raw: string): Block[] {
  const lines = raw.split('\n');
  if (raw.endsWith('\n')) lines.pop();
  if (raw === '') return [];
  return lines.map((l): Block => {
    if (!l.trim()) return { kind: 'blank' };
    let m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) return { kind: 'heading', level: m[1].length, text: m[2].trim() };
    m = /^(\s*)[-*+]\s+\[( |x|X)\](?:\s+(.*)|$)/.exec(l);
    if (m) return { kind: 'task', indent: m[1], done: m[2] !== ' ', text: (m[3] ?? '').trim() };
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return { kind: 'rule', text: l };
    return { kind: 'text', text: l };
  });
}

/** Mirrors `Document::from_blocks` + `to_markdown` in todo-core, including the task→rule/heading conversion. */
export function ser(blocks: Block[]): string {
  return blocks
    .map((b): Block => {
      if (b.kind !== 'task') return b;
      if (/^([-*_])(\s*\1){2,}$/.test(b.text.trim())) return { kind: 'rule', text: b.text.trim() };
      const h = /^(#{1,6})[ \t]+(\S.*)$/.exec(b.text.trim());
      return h ? { kind: 'heading', level: h[1].length, text: h[2].trim() } : b;
    })
    .map((b) =>
      b.kind === 'heading' ? '#'.repeat(b.level) + ' ' + b.text
      : b.kind === 'task' ? b.indent + (b.done ? '- [x]' : '- [ ]') + (b.text ? ' ' + b.text : '')
      : b.kind === 'text' || b.kind === 'rule' ? b.text : '')
    .map((l) => l + '\n')
    .join('');
}

export class MockBackend {
  files: Record<string, string> = {};
  config: Config = defaultConfig();
  order: string[] = [];
  colors: Record<string, string> = {};
  calls: string[] = [];
  private listeners: Record<string, ((ev: { payload: unknown }) => void)[]> = {};

  constructor() { this.reset(); }

  /** Back to the fixture: three files, default config, no order/colors. */
  reset(): void {
    this.files = { ...FIXTURE_FILES };
    this.config = defaultConfig();
    this.order = [];
    this.colors = {};
    this.calls = [];
  }

  private rank(n: string): number { const i = this.order.indexOf(n); return i < 0 ? 1e9 : i; }

  snapshot(): Snapshot {
    const names = Object.keys(this.files).sort((a, b) => (this.rank(a) - this.rank(b)) || a.toLowerCase().localeCompare(b.toLowerCase()));
    return { dir: '/mock/todos', files: names.map((name) => ({ name, raw: this.files[name], blocks: parse(this.files[name]), ...(this.colors[name] ? { color: this.colors[name] } : {}) })) };
  }

  cfgPayload(): ConfigPayload {
    return {
      config: this.config, light: palette(this.config.light_scheme ?? 'white'), dark: palette(this.config.dark_scheme ?? 'midnight_blue'),
      config_path: '/mock/.todo_config.toml', platform: 'mock',
      schemes: Object.keys(SCHEMES).map((id) => ({ id, label: id, is_dark: SCHEMES[id][8] })),
    };
  }

  /** Simulate an external edit: the backend would emit a snapshot event. */
  emit(name: string, payload: unknown): void {
    for (const f of this.listeners[name] ?? []) f({ payload });
  }

  private handle<K extends keyof Commands>(cmd: K, args: Commands[K][0]): Commands[K][1] {
    this.calls.push(cmd);
    const a = args as never;
    switch (cmd) {
      case 'get_config': return this.cfgPayload() as Commands[K][1];
      case 'get_snapshot': return this.snapshot() as Commands[K][1];
      case 'save_blocks': { const { name, blocks } = a as { name: string; blocks: Block[] }; this.files[name] = ser(blocks); return this.files[name] as Commands[K][1]; }
      case 'save_raw': { const { name, raw } = a as { name: string; raw: string }; this.files[name] = raw; return parse(raw) as Commands[K][1]; }
      case 'create_file': {
        const name = (a as { name: string }).name.replace(/\.md$/, '');
        if (this.files[name]) throw 'file already exists: ' + name;
        this.files[name] = `# ${name}\n\n`;
        return { name, snapshot: this.snapshot() } as Commands[K][1];
      }
      case 'rename_file': {
        const { from } = a as { from: string; to: string };
        const to = (a as { to: string }).to.replace(/\.md$/, '');
        if (!this.files[from]) throw 'no such file: ' + from;
        if (this.files[to] && to !== from) throw 'file already exists: ' + to;
        this.files[to] = this.files[from]; delete this.files[from];
        this.order = this.order.map((n) => (n === from ? to : n));
        if (this.colors[from]) { this.colors[to] = this.colors[from]; delete this.colors[from]; }
        return { name: to, snapshot: this.snapshot() } as Commands[K][1];
      }
      case 'delete_file': { const { name } = a as { name: string }; delete this.files[name]; this.order = this.order.filter((n) => n !== name); delete this.colors[name]; return this.snapshot() as Commands[K][1]; }
      case 'set_tab_order': { this.order = (a as { names: string[] }).names.filter((n) => this.files[n]); return this.snapshot() as Commands[K][1]; }
      case 'set_tab_color': { const { name, color } = a as { name: string; color: string | null }; if (color) this.colors[name] = color; else delete this.colors[name]; return this.snapshot() as Commands[K][1]; }
      case 'update_settings': {
        const patch = (a as { patch: SettingsPatch }).patch;
        for (const [k, v] of Object.entries(patch) as [keyof SettingsPatch, never][]) {
          if (k === 'opacity' || k === 'always_on_top') (this.config.window as unknown as Record<string, unknown>)[k] = v;
          else if (k === 'close_to_tray' || k === 'visible_on_all_workspaces') (this.config.tray as unknown as Record<string, unknown>)[k] = v;
          else if (k === 'vim') this.config.editor.vim = v;
          else if (k === 'tab_overflow') this.config.tabs.overflow = v;
          else if (k === 'tab_badge') this.config.tabs.badge = v;
          else (this.config as unknown as Record<string, unknown>)[k] = v;
        }
        return this.cfgPayload() as Commands[K][1];
      }
      case 'log': console.log('[ui]', (a as { msg: string }).msg); return undefined as Commands[K][1];
      case 'window_ready': case 'hide_window': case 'open_config': case 'open_todo_dir': case 'quit':
        console.log('[' + cmd + ']'); return undefined as Commands[K][1];
      default: throw 'unknown command ' + String(cmd);
    }
  }

  /** The `window.__TAURI__` object the app expects. */
  global(): TauriGlobal {
    return {
      core: { invoke: async (cmd, args) => this.handle(cmd as keyof Commands, args as never) },
      event: { listen: async (n, f) => { (this.listeners[n] ??= []).push(f); return () => {}; } },
      window: { getCurrentWindow: () => ({ startDragging: async () => { console.log('[startDragging]'); } }) },
    };
  }
}
