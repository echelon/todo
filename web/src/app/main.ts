/** Boot: load config + snapshot, subscribe to backend events, expose the test hook. */
import './clipboard.ts';
import './drag.ts';
import './keyboard.ts';
import { getEditor, setView, type MdEditor } from './editor.ts';
import { fillSchemes, syncSettingsUI } from './settings.ts';
import { applySnapshot } from './snapshot.ts';
import { el, S } from './state.ts';
import { invoke, listen, reportError } from './tauri.ts';
import { applyTheme, setFocused } from './theme.ts';
import type { ConfigPayload, Side, Snapshot } from './types.ts';
import { closeCtx, toast } from './ui.ts';
import { initSide, setSide } from './window.ts';

window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`unhandled: ${String(e.reason)}`));

export interface TestHook {
  readonly editor: MdEditor | null;
  state: typeof S;
  /** Harness: start over from a fresh config + snapshot (view rendered, nothing selected/edited). */
  reset(cfg: ConfigPayload, snap: Snapshot, active: string | null): void;
}

declare global {
  interface Window {
    __todo?: TestHook;
  }
}

function reset(cfg: ConfigPayload, snap: Snapshot, active: string | null): void {
  closeCtx();
  S.modalResolve?.(false);
  el.settings.hidden = true;
  el.settingsBtn.classList.remove('active');
  S.editing = null; S.selected = null; S.clip = null; S.clipText = '';
  S.pendingSnap = null; S.mdDirty = false; S.dragging = false; S.suppressClick = false;
  S.focused = true; S.hovered = false;
  clearTimeout(S.mdTimer);
  S.cfg = cfg;
  applyTheme();
  fillSchemes();
  syncSettingsUI();
  S.snap = null;
  S.active = active;
  applySnapshot(snap);
  setView('rendered', true);
}

window.__todo = { get editor() { return getEditor(); }, state: S, reset };

async function init(): Promise<void> {
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
    await listen<Snapshot>('todo:snapshot', (p) => applySnapshot(p));
    await listen<ConfigPayload>('todo:config', (p) => { S.cfg = p; applyTheme(); syncSettingsUI(); });
    await listen<string>('todo:error', (p) => toast(p));
    await listen<boolean>('todo:focus', (focused) => setFocused(focused));
    await listen<Side>('todo:moved', (side) => setSide(side));
    await initSide();
  } catch (e) {
    toast(e);
  }
  // Note: rAF never fires while the window is hidden, so call directly.
  void invoke('window_ready');
}
void init();
