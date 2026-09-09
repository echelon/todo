import { effectiveOpacity, hexToRgb } from './model.ts';
import { el, S } from './state.ts';
import type { Palette } from './types.ts';

export const darkMQ = matchMedia('(prefers-color-scheme: dark)');
darkMQ.addEventListener('change', () => applyTheme());

export function currentPalette(): Palette | null {
  if (!S.cfg) return null;
  const a = S.cfg.config.appearance;
  const dark = a === 'dark' || (a === 'follow_os' && darkMQ.matches);
  return dark ? S.cfg.dark : S.cfg.light;
}

export function applyTheme(): void {
  const p = currentPalette();
  if (!p || !S.cfg) return;
  const c = S.cfg.config, r = document.documentElement.style;
  for (const k of ['bg', 'surface', 'fg', 'muted', 'accent', 'border', 'danger'] as const) r.setProperty('--' + k, p[k]);
  r.setProperty('--accent-fg', p.accent_fg);
  r.setProperty('--bg-rgb', hexToRgb(p.bg));
  r.setProperty('--surface-rgb', hexToRgb(p.surface));
  r.setProperty('--fg-rgb', hexToRgb(p.fg));
  applyOpacity();
  r.setProperty('--radius', c.window.corner_radius + 'px');
  r.setProperty('--font-size', c.font_size + 'px');
  r.setProperty('--font', c.font_family);
  document.documentElement.style.colorScheme = p.is_dark ? 'dark' : 'light';
  el.pin.classList.toggle('active', c.window.always_on_top);
}

/** Background opacity, honouring the optional fade while unfocused and not hovered. */
export function applyOpacity(): void {
  if (!S.cfg) return;
  const o = effectiveOpacity(S.cfg.config.window, S.focused, S.hovered);
  document.documentElement.style.setProperty('--opacity', String(o));
}

/** Is the pointer really over the app right now? (The browser's own :hover tracking,
 *  which unlike our enter/leave bookkeeping cannot go stale after a native window drag.) */
export function pointerOver(): boolean {
  try { return document.documentElement.matches(':hover'); } catch { return false; }
}

export function setFocused(focused: boolean): void {
  S.focused = focused;
  // Losing focus is exactly when a stale "hovered" would wrongly keep us opaque: re-derive it.
  S.hovered = pointerOver();
  applyOpacity();
}

export function setHovered(hovered: boolean): void {
  if (S.hovered === hovered) return;
  S.hovered = hovered;
  applyOpacity();
}

/** Re-check hover against reality; cheap, so it runs on several signals and on a slow timer. */
export function reconcileHover(): void {
  setHovered(pointerOver());
}

// Pointer over the app counts as active; the webview's own focus events back up Tauri's.
document.documentElement.addEventListener('mouseenter', () => setHovered(true));
document.documentElement.addEventListener('mouseleave', () => setHovered(false));
document.addEventListener('pointermove', () => setHovered(true), { passive: true });
window.addEventListener('focus', () => setFocused(true));
window.addEventListener('blur', () => setFocused(false));
document.addEventListener('visibilitychange', reconcileHover);
// Safety net: enter/leave events can be missed while another window covers us or after a
// native drag; while the fade is enabled and we're unfocused, poll the real hover state.
setInterval(() => {
  if (S.cfg?.config.window.inactive_opacity_enabled && !S.focused) reconcileHover();
}, 1000);
