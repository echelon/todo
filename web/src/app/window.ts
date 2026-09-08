/** The bottom-bar "jump to the other side of the screen" button. */
import { el, S } from './state.ts';
import { invoke } from './tauri.ts';
import type { Side } from './types.ts';
import { toast } from './ui.ts';

/** A window outline with the half we'd jump to filled in. */
function mirrorIcon(target: Side): string {
  const half = target === 'left' ? '<rect x="4" y="5" width="8" height="14" rx="1.5"/>' : '<rect x="12" y="5" width="8" height="14" rx="1.5"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2.5"/>
    <g fill="currentColor" stroke="none">${half}</g>
  </svg>`;
}

export function setSide(side: Side | null): void {
  S.side = side;
  const target: Side = side === 'right' ? 'left' : 'right';
  el.mirror.innerHTML = mirrorIcon(target);
  el.mirror.dataset.target = target;
  el.mirror.title = `Jump to the ${target} side of the screen (same distance from the edge)`;
}

export async function mirrorWindow(): Promise<void> {
  try { setSide(await invoke('mirror_window')); } catch (e) { toast(e); }
}

export async function initSide(): Promise<void> {
  try { setSide(await invoke('get_window_side')); } catch { setSide(null); }
}

el.mirror.addEventListener('click', () => void mirrorWindow());
