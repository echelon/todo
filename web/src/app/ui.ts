/** Toasts, the confirm dialog and the context menu. */
import { $, div, el, S } from './state.ts';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: unknown): void {
  el.toast.textContent = String(msg);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 4000);
}

export function confirmDialog(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    el.modalMsg.textContent = msg;
    el.modal.hidden = false;
    const done = (v: boolean): void => {
      el.modal.hidden = true;
      el.modalOk.onclick = el.modalCancel.onclick = null;
      S.modalResolve = null;
      resolve(v);
    };
    el.modalOk.onclick = () => done(true);
    el.modalCancel.onclick = () => done(false);
    S.modalResolve = done;
    el.modalOk.focus();
  });
}

export type MenuItem =
  | { sep: true }
  | {
      label: string;
      onClick?: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** Present (even as null) → draws a swatch. */
      color?: string | null;
      items?: MenuItem[];
    };

export function showMenu(x: number, y: number, items: (MenuItem | null | false)[]): void {
  el.ctx.textContent = '';
  for (const it of items) {
    if (!it) continue;
    if ('sep' in it) { el.ctx.append(div('sep')); continue; }
    const b = document.createElement('button');
    if ('color' in it) {
      const sw = document.createElement('span');
      sw.className = 'swatch' + (it.color ? '' : ' none');
      if (it.color) sw.style.background = it.color;
      b.append(sw);
    }
    b.append(document.createTextNode(it.label));
    if (it.checked) b.classList.add('checked');
    if (it.danger) b.classList.add('danger');
    b.disabled = !!it.disabled;
    b.onclick = () => {
      if (it.items) showMenu(x, y, [{ label: '‹ Back', onClick: () => showMenu(x, y, items) }, { sep: true }, ...it.items]);
      else { closeCtx(); it.onClick?.(); }
    };
    el.ctx.append(b);
  }
  el.ctx.hidden = false;
  const app = $('#app').getBoundingClientRect();
  const w = el.ctx.offsetWidth, h = el.ctx.offsetHeight;
  el.ctx.style.left = Math.max(4, Math.min(x - app.left, app.width - w - 4)) + 'px';
  el.ctx.style.top = Math.max(4, Math.min(y - app.top, app.height - h - 4)) + 'px';
}

export function closeCtx(): void {
  el.ctx.hidden = true;
}

document.addEventListener('mousedown', (e) => {
  if (!el.ctx.hidden && !(e.target instanceof Element && e.target.closest('#ctx'))) closeCtx();
});
