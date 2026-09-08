/** Typed bridge to the Tauri backend (or the harness mock that stands in for it). */
import type { Block, ConfigPayload, CreateResult, SettingsPatch, Side, Snapshot } from './types.ts';

/** command → [args, result] */
export interface Commands {
  get_config: [void, ConfigPayload];
  get_snapshot: [void, Snapshot];
  save_blocks: [{ name: string; blocks: Block[] }, string];
  save_raw: [{ name: string; raw: string }, Block[]];
  create_file: [{ name: string }, CreateResult];
  rename_file: [{ from: string; to: string }, CreateResult];
  delete_file: [{ name: string }, Snapshot];
  set_tab_order: [{ names: string[] }, Snapshot];
  set_tab_color: [{ name: string; color: string | null }, Snapshot];
  update_settings: [{ patch: SettingsPatch }, ConfigPayload];
  window_ready: [void, void];
  hide_window: [void, void];
  get_window_side: [void, Side | null];
  mirror_window: [void, Side];
  open_config: [void, void];
  open_todo_dir: [void, void];
  quit: [void, void];
  log: [{ msg: string }, void];
}

export interface TauriGlobal {
  core: { invoke(cmd: string, args?: unknown): Promise<unknown> };
  event: { listen(name: string, cb: (ev: { payload: unknown }) => void): Promise<() => void> };
  window: { getCurrentWindow(): { startDragging(): Promise<void> } };
}

declare global {
  interface Window {
    __TAURI__: TauriGlobal;
  }
}

const T = window.__TAURI__;

type ArgsOf<K extends keyof Commands> = Commands[K][0] extends void ? [] : [Commands[K][0]];

export function invoke<K extends keyof Commands>(cmd: K, ...args: ArgsOf<K>): Promise<Commands[K][1]> {
  return T.core.invoke(cmd, args[0]) as Promise<Commands[K][1]>;
}

export function listen<P>(name: string, cb: (payload: P) => void): Promise<() => void> {
  return T.event.listen(name, (ev) => cb(ev.payload as P));
}

export const appWindow = T.window.getCurrentWindow();

/** Directory app.js was loaded from; used to lazy-load vendor/editor.js. */
export const BASE = new URL('.', (document.currentScript as HTMLScriptElement | null)?.src || location.href);

export function reportError(msg: string): void {
  invoke('log', { msg }).catch(() => {});
}
