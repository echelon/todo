/** Mutable UI state and typed handles to the static DOM. */
import type { BadgeMode, Block, ConfigPayload, Side, Snapshot, TodoFile, View } from './types.ts';
import { BADGE_MODES } from './model.ts';

export interface EditingState {
  row: HTMLElement;
  input: HTMLInputElement;
  i: number;
  isNew: boolean;
  kind: Block['kind'];
  orig: string;
}

export const S = {
  cfg: null as ConfigPayload | null,
  snap: null as Snapshot | null,
  active: null as string | null,
  view: 'rendered' as View,
  editing: null as EditingState | null,
  dragging: false,
  suppressClick: false,
  pendingSnap: null as Snapshot | null,
  mdTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  mdDirty: false,
  opacityTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  fadeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  /** Index of the selected task row (rendered view). */
  selected: null as number | null,
  /** Internal clipboard: blocks plus the markdown we put on the system clipboard. */
  clip: null as Block[] | null,
  clipText: '',
  modalResolve: null as ((v: boolean) => void) | null,
  /** Window focus (from Tauri's Focused event) and pointer-over state, for the inactive fade. */
  focused: true,
  hovered: false,
  /** Which half of the monitor the window is on (null until the backend tells us). */
  side: null as Side | null,
};

export const file = (): TodoFile | undefined => S.snap?.files.find((f) => f.name === S.active);

export function $<T extends Element = HTMLElement>(sel: string): T {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error('missing element ' + sel);
  return e;
}

export const el = {
  tabs: $('#tabs'),
  newTab: $('#new-tab'),
  list: $('#list'),
  md: $<HTMLTextAreaElement>('#md'),
  mdHost: $('#md-host'),
  empty: $('#empty'),
  count: $('#count'),
  viewSeg: $('#view-seg'),
  badgeBtn: $('#badge-btn'),
  pin: $('#pin-btn'),
  mirror: $('#mirror-btn'),
  hide: $('#hide-btn'),
  settingsBtn: $('#settings-btn'),
  settings: $('#settings'),
  ctx: $('#ctx'),
  modal: $('#modal'),
  modalMsg: $('#modal-msg'),
  modalOk: $<HTMLButtonElement>('#modal-ok'),
  modalCancel: $<HTMLButtonElement>('#modal-cancel'),
  toast: $('#toast'),
  sAppearance: $<HTMLSelectElement>('#s-appearance'),
  sLight: $<HTMLSelectElement>('#s-light'),
  sDark: $<HTMLSelectElement>('#s-dark'),
  sOpacity: $<HTMLInputElement>('#s-opacity'),
  sFont: $<HTMLInputElement>('#s-font'),
  sFade: $<HTMLInputElement>('#s-fade'),
  sFadeOpacity: $<HTMLInputElement>('#s-fade-opacity'),
  sTop: $<HTMLInputElement>('#s-top'),
  sClose: $<HTMLInputElement>('#s-close'),
  sSpaces: $<HTMLInputElement>('#s-spaces'),
  sVim: $<HTMLInputElement>('#s-vim'),
  sTabs: $<HTMLSelectElement>('#s-tabs'),
  sHint: $('#s-hint'),
};

export function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

export const rowAt = (i: number): HTMLElement | null => el.list.querySelector<HTMLElement>(`.block[data-i="${i}"]`);
export const blockIndex = (row: Element): number => Number((row as HTMLElement).dataset.i);
export const vimOn = (): boolean => !!S.cfg?.config.editor?.vim;
export const badgeMode = (): BadgeMode => {
  const m = S.cfg?.config.tabs?.badge;
  return m && BADGE_MODES.includes(m) ? m : 'none';
};

/** Swallow the click that follows a pointer drag. */
export function suppressClicks(): void {
  S.suppressClick = true;
  setTimeout(() => (S.suppressClick = false), 0);
}

export const targetEl = (e: Event): Element => (e.target instanceof Element ? e.target : document.body);
