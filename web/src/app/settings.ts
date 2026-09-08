/** The settings popover and the bottom-bar toggles; every change is persisted via `update_settings`. */
import { getEditor } from './editor.ts';
import { nextBadgeMode } from './model.ts';
import { $, badgeMode, el, S } from './state.ts';
import { renderBadgeButton, renderTabs } from './tabs.ts';
import { invoke } from './tauri.ts';
import { applyTheme } from './theme.ts';
import type { Appearance, SettingsPatch, TabOverflow } from './types.ts';
import { toast } from './ui.ts';

export function fillSchemes(): void {
  if (!S.cfg) return;
  for (const sel of [el.sLight, el.sDark]) {
    sel.textContent = '';
    for (const s of S.cfg.schemes) {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.label + (s.is_dark ? ' ◐' : ' ○');
      sel.append(o);
    }
  }
}

export function syncSettingsUI(): void {
  if (!S.cfg) return;
  const c = S.cfg.config;
  el.sAppearance.value = c.appearance;
  el.sLight.value = c.light_scheme ?? 'white';
  el.sDark.value = c.dark_scheme ?? 'midnight_blue';
  el.sOpacity.value = String(c.window.opacity);
  el.sFont.value = String(c.font_size);
  el.sFade.checked = c.window.inactive_opacity_enabled;
  el.sFadeOpacity.value = String(c.window.inactive_opacity);
  el.sFadeOpacity.disabled = !c.window.inactive_opacity_enabled;
  el.sTop.checked = c.window.always_on_top;
  el.sClose.checked = c.tray.close_to_tray;
  el.sSpaces.checked = c.tray.visible_on_all_workspaces;
  el.sVim.checked = !!c.editor?.vim;
  getEditor()?.setVim(!!c.editor?.vim);
  const overflow: TabOverflow = c.tabs?.overflow === 'wrap' ? 'wrap' : 'scroll';
  el.sTabs.value = overflow;
  el.tabs.classList.toggle('wrap', overflow === 'wrap');
  if (S.snap) renderTabs();
  renderBadgeButton();
  const hk = c.shortcuts.toggle_window ? `Toggle: ${c.shortcuts.toggle_window} · ` : '';
  el.sHint.textContent = `${hk}Config: ${S.cfg.config_path}`;
}

export async function patch(p: SettingsPatch): Promise<void> {
  try {
    S.cfg = await invoke('update_settings', { patch: p });
    applyTheme();
    syncSettingsUI();
  } catch (e) { toast(e); }
}

el.sAppearance.addEventListener('change', () => void patch({ appearance: el.sAppearance.value as Appearance }));
el.sLight.addEventListener('change', () => void patch({ light_scheme: el.sLight.value }));
el.sDark.addEventListener('change', () => void patch({ dark_scheme: el.sDark.value }));
el.sFont.addEventListener('change', () => void patch({ font_size: +el.sFont.value }));
el.sTop.addEventListener('change', () => void patch({ always_on_top: el.sTop.checked }));
el.sFade.addEventListener('change', () => void patch({ inactive_opacity_enabled: el.sFade.checked }));
el.sFadeOpacity.addEventListener('input', () => {
  clearTimeout(S.fadeTimer);
  S.fadeTimer = setTimeout(() => void patch({ inactive_opacity: +el.sFadeOpacity.value }), 200);
});
el.sClose.addEventListener('change', () => void patch({ close_to_tray: el.sClose.checked }));
el.sSpaces.addEventListener('change', () => void patch({ visible_on_all_workspaces: el.sSpaces.checked }));
el.sVim.addEventListener('change', () => void patch({ vim: el.sVim.checked }));
el.sTabs.addEventListener('change', () => void patch({ tab_overflow: el.sTabs.value as TabOverflow }));
el.sOpacity.addEventListener('input', () => {
  document.documentElement.style.setProperty('--opacity', el.sOpacity.value);
  clearTimeout(S.opacityTimer);
  S.opacityTimer = setTimeout(() => void patch({ opacity: +el.sOpacity.value }), 200);
});
$('#s-open-config').addEventListener('click', () => invoke('open_config').catch(toast));
$('#s-open-dir').addEventListener('click', () => invoke('open_todo_dir').catch(toast));
$('#s-quit').addEventListener('click', () => void invoke('quit'));

export function toggleSettings(show: boolean = el.settings.hidden): void {
  el.settings.hidden = !show;
  el.settingsBtn.classList.toggle('active', show);
}
el.settingsBtn.addEventListener('click', () => toggleSettings());
document.addEventListener('mousedown', (e) => {
  if (!el.settings.hidden && !(e.target instanceof Element && e.target.closest('#settings, #settings-btn'))) toggleSettings(false);
});
el.pin.addEventListener('click', () => { if (S.cfg) void patch({ always_on_top: !S.cfg.config.window.always_on_top }); });
el.badgeBtn.addEventListener('click', () => void patch({ tab_badge: nextBadgeMode(badgeMode()) }));
el.hide.addEventListener('click', () => void invoke('hide_window'));
