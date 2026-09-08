import { hexToRgb } from './model.ts';
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
  r.setProperty('--opacity', String(c.window.opacity));
  r.setProperty('--radius', c.window.corner_radius + 'px');
  r.setProperty('--font-size', c.font_size + 'px');
  r.setProperty('--font', c.font_family);
  document.documentElement.style.colorScheme = p.is_dark ? 'dark' : 'light';
  el.pin.classList.toggle('active', c.window.always_on_top);
}
