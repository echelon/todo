/** Shared types for the UI. Mirrors the serde structs in `todo-core`. */

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'task'; done: boolean; text: string; indent: string }
  | { kind: 'text'; text: string }
  | { kind: 'rule'; text: string }
  | { kind: 'blank' };

export type Task = Extract<Block, { kind: 'task' }>;

export interface TodoFile {
  name: string;
  raw: string;
  blocks: Block[];
  color?: string;
}

export interface Snapshot {
  dir: string;
  files: TodoFile[];
}

export type Appearance = 'light' | 'dark' | 'follow_os';
export type TabOverflow = 'scroll' | 'wrap';
export type BadgeMode = 'none' | 'ratio' | 'percent' | 'remaining';
export type View = 'rendered' | 'markdown';

export interface Palette {
  scheme: string;
  is_dark: boolean;
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent_fg: string;
  border: string;
  danger: string;
}

export interface Config {
  todo_dir: string;
  dark_scheme: string | null;
  light_scheme: string | null;
  appearance: Appearance;
  font_size: number;
  font_family: string;
  window: {
    opacity: number;
    inactive_opacity_enabled: boolean;
    inactive_opacity: number;
    always_on_top: boolean;
    width: number;
    height: number;
    corner_radius: number;
    start_hidden: boolean;
  };
  tray: {
    close_to_tray: boolean;
    hide_dock_icon: boolean;
    skip_taskbar: boolean;
    visible_on_all_workspaces: boolean;
  };
  shortcuts: { toggle_window: string };
  editor: { vim: boolean };
  tabs: { overflow: TabOverflow; badge: BadgeMode };
}

export interface SchemeInfo {
  id: string;
  label: string;
  is_dark: boolean;
}

export interface ConfigPayload {
  config: Config;
  light: Palette;
  dark: Palette;
  schemes: SchemeInfo[];
  config_path: string;
  platform: string;
}

export interface SettingsPatch {
  appearance?: Appearance;
  light_scheme?: string;
  dark_scheme?: string;
  opacity?: number;
  inactive_opacity_enabled?: boolean;
  inactive_opacity?: number;
  always_on_top?: boolean;
  font_size?: number;
  close_to_tray?: boolean;
  visible_on_all_workspaces?: boolean;
  vim?: boolean;
  tab_overflow?: TabOverflow;
  tab_badge?: BadgeMode;
}

export interface CreateResult {
  name: string;
  snapshot: Snapshot;
}

/** Which half of the monitor the window sits on. */
export type Side = 'left' | 'right';
