/** Independent browser scenarios. Each starts from the fixture in `MockBackend.reset()`. */
import type { MockBackend } from './mock.ts';

type Check = (name: string, cond: boolean) => void;
interface Ctx { mock: MockBackend; F: Record<string, string>; check: Check }
interface Scenario { name: string; active?: string; run(ctx: Ctx): Promise<void> }

const q = <T extends Element = HTMLElement>(s: string): T | null => document.querySelector<T>(s);
const qa = <T extends Element = HTMLElement>(s: string): T[] => [...document.querySelectorAll<T>(s)];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const texts = (): string[] => qa('#list .task .text').map((t) => (t.textContent ?? '').trim());
const rows = (): HTMLElement[] => qa('#list .task');
const tab = (name: string): HTMLElement | undefined => qa('.tab').find((t) => t.firstChild?.textContent === name);
const ctxButtons = (): string[] => qa<HTMLButtonElement>('#ctx button').map((b) => b.textContent ?? '');
const ctxClick = (label: string): void => { qa<HTMLButtonElement>('#ctx button').find((b) => b.textContent === label)?.click(); };
const state = () => window.__todo!.state;

function ptr(type: string, target: EventTarget, x: number, y: number, extra: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, ...extra }));
}
function key(k: string, o: KeyboardEventInit = {}, target: EventTarget = document): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
}
function mouse(type: string, target: EventTarget, x = 60, y = 120): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}
const mid = (el: Element): number => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
const top = (el: Element): number => el.getBoundingClientRect().top + 2;
const addRowTop = (): number => top(q('#list .add-row')!);

async function dragRow(fromIdx: number, toY: number, { dx = 0, dwell = 0 } = {}): Promise<void> {
  const row = rows()[fromIdx]; const r = row.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  ptr('pointerdown', row.querySelector('.text')!, x, y);
  ptr('pointermove', window, x, y + 8); await sleep(5);
  for (let i = 1; i <= 6; i++) { ptr('pointermove', window, x + dx * i / 6, y + (toY - y) * i / 6); await sleep(5); }
  if (dwell) { await sleep(dwell); ptr('pointermove', window, x + dx, toY + 0.5); await sleep(10); }
  ptr('pointerup', window, x + dx, toY);
  await sleep(20);
}
async function editRow(idx: number, text: string, k = 'Enter'): Promise<void> {
  qa('#list .task .text')[idx].click(); await sleep(10);
  const inp = q<HTMLInputElement>('#list .edit')!; inp.value = text;
  key(k, {}, inp); await sleep(10);
}
async function addTodo(text: string): Promise<void> {
  const add = q<HTMLInputElement>('#list .add')!; add.value = text;
  key('Enter', {}, add); await sleep(10);
}
async function waitFor(cond: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(20); }
  return cond();
}

export const scenarios: Scenario[] = [
  { name: 'renders', async run({ check }) {
    check('tabs alphabetical', qa('.tab').map((t) => t.textContent).join() === 'Home,Todo,Work' && q('.tab.active')?.textContent === 'Todo');
    check('hidden elements hidden', getComputedStyle(q('#modal')!).display === 'none' && getComputedStyle(q('#empty')!).display === 'none' && getComputedStyle(q('#ctx')!).display === 'none');
    check('7 tasks rendered', rows().length === 7);
    check('nested indent', rows()[6].style.marginLeft === '18px');
    check('count', q('#count')!.textContent === '6 left');
    check('grab cursor on rows', getComputedStyle(rows()[0]).cursor === 'grab');
  } },

  { name: 'toggle', async run({ F, check }) {
    qa('#list .task .check')[0].click(); await sleep(10);
    check('toggle writes [x]', F.Todo.includes('- [x] Drag me around'));
    check('count updated', q('#count')!.textContent === '5 left');
    qa('#list .task .check')[0].click(); await sleep(10);
    check('toggle back', F.Todo.includes('- [ ] Drag me around'));
  } },

  { name: 'inline edit', async run({ F, check }) {
    qa('#list .task .text')[1].click(); await sleep(10);
    const inp = q<HTMLInputElement>('#list .edit');
    check('edit input shown with text', !!inp && inp.value === 'Click a checkbox');
    inp!.value = 'Click a checkbox!'; key('Enter', {}, inp!); await sleep(10);
    check('edit saved', F.Todo.includes('- [ ] Click a checkbox!'));
    const inp2 = q<HTMLInputElement>('#list .edit');
    check('enter starts a new empty item', !!inp2 && inp2.value === '');
    inp2!.value = 'Brand new'; key('Enter', {}, inp2!); await sleep(10);
    check('new item saved after previous', /Click a checkbox!\n- \[ \] Brand new\n/.test(F.Todo));
    key('Escape', {}, q('#list .edit')!); await sleep(10);
    check('escape drops the empty new item', !q('#list .edit') && rows().length === 8);
    await editRow(0, '', 'Enter');
    check('emptying an existing item keeps it as an empty task', F.Todo.includes('- [ ]\n- [ ] Click a checkbox!'));
    check('enter still starts the next item', q<HTMLInputElement>('#list .edit')?.value === '' && rows().length === 9);
    key('Escape', {}, q('#list .edit')!); await sleep(10);
    check('escape drops it again', !q('#list .edit') && rows().length === 8);
  } },

  { name: 'add box', async run({ F, check }) {
    await addTodo('From add box');
    check('appends at end of section', F.Todo.endsWith('  - [ ] Nested child\n- [ ] From add box\n'));
    check('add input refocused', document.activeElement === q('#list .add'));
  } },

  { name: 'typed dividers and headings', async run({ F, check }) {
    await addTodo('-----');
    check('dashes add a divider', F.Todo.endsWith('- [ ] Nested child\n-----\n') && qa('#list .rule').length === 1 && !F.Todo.includes('- [ ] ---'));
    await editRow(0, '***');
    check('editing to *** makes a divider', F.Todo.includes('# Todo\n\n***\n') && !q('#list .edit') && qa('#list .rule').length === 2);
    mouse('contextmenu', qa('#list .rule')[0]); await sleep(10);
    check('divider menu', ctxButtons().join() === 'Delete divider');
    ctxClick('Delete divider'); await sleep(10);
    check('divider deleted', !F.Todo.includes('***') && qa('#list .rule').length === 1);
    await addTodo('## Tonight');
    check('hash text adds a heading', F.Todo.endsWith('-----\n## Tonight\n') && qa('#list .heading.h2').some((h) => h.textContent === 'Tonight'));
    await editRow(0, '### Later today');
    check('editing to ### makes a heading', F.Todo.includes('# Todo\n\n### Later today\n') && !q('#list .edit'));
    await addTodo('#notaheading');
    check('no space after # stays a todo', F.Todo.endsWith('## Tonight\n- [ ] #notaheading\n'));
  } },

  { name: 'drag reorder within a section', async run({ F, check }) {
    const before = texts();
    await dragRow(0, top(qa('#list .heading')[1]));
    check('ghost removed', !q('.ghost') && !document.body.classList.contains('is-dragging'));
    const after = texts();
    check('drag reorders', after[0] === before[1] && after[4] === before[0]);
    check('serialised inside the section', /- \[x\] Install the app\n- \[ \] Drag me around\n\n## Later/.test(F.Todo));
  } },

  { name: 'delete asks first', async run({ F, check }) {
    qa('#list .task .del')[0].click(); await sleep(10);
    check('modal shown', getComputedStyle(q('#modal')!).display !== 'none');
    q('#modal-cancel')!.click(); await sleep(10);
    check('cancel keeps item', rows().length === 7);
    qa('#list .task .del')[0].click(); await sleep(10);
    q('#modal-ok')!.click(); await sleep(10);
    check('delete removes item', rows().length === 6 && !F.Todo.includes('Drag me around'));
    rows()[4].click(); key('Backspace'); await sleep(10);
    check('deleting a parent mentions nested count', /"Nested parent" and 1 nested item\?/.test(q('#modal-msg')!.textContent ?? ''));
    q('#modal-ok')!.click(); await sleep(10);
    check('subtree deleted', rows().length === 4 && !F.Todo.includes('Nested'));
  } },

  { name: 'markdown editor with vim', async run({ F, check }) {
    key('e', { metaKey: true });
    check('editor loaded', await waitFor(() => !!window.__todo?.editor && !q('#md-host')!.hidden));
    const ed = window.__todo!.editor!;
    check('codemirror, not textarea', !ed.isTextarea && !!q('.md-host .cm-editor') && q('#list')!.hidden);
    check('editor shows file', ed.getValue() === F.Todo);
    check('vim status panel', /NORMAL/.test(q('.cm-vim-panel')?.textContent ?? ''));
    const content = q('.cm-content')!;
    const vkey = (k: string): void => key(k, { code: 'Key' + k.toUpperCase() }, content);
    vkey('d'); vkey('d'); await sleep(300);
    check('vim dd deletes first line', !F.Todo.startsWith('# Todo') && ed.getValue() === F.Todo);
    vkey('u'); await sleep(300);
    check('vim u undoes', F.Todo.startsWith('# Todo'));
    vkey('i'); await sleep(10);
    check('vim insert mode', ed.mode?.() === 'insert' && /INSERT/.test(q('.cm-vim-panel')!.textContent ?? ''));
    key('Escape', {}, content); await sleep(10);
    check('escape back to normal', ed.mode?.() === 'normal');
    const view = ed.view as { state: { doc: { length: number } }; dispatch(tr: unknown): void };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Todo\n\n- [ ] only one\n' } }); await sleep(300);
    check('markdown saved', F.Todo === '# Todo\n\n- [ ] only one\n');
    key('e', { metaKey: true }); await sleep(10);
    check('back to list, re-rendered', !q('#list')!.hidden && texts().join() === 'only one');
  } },

  { name: 'external change', async run({ mock, check }) {
    mock.files.Todo = '# Todo\n\n- [ ] external\n- [x] change\n';
    mock.emit('todo:snapshot', mock.snapshot()); await sleep(10);
    check('external snapshot applied', texts().join() === 'external,change');
    delete mock.files.Work;
    mock.emit('todo:snapshot', mock.snapshot()); await sleep(10);
    check('removed file drops its tab', qa('.tab').map((t) => t.textContent).join() === 'Home,Todo');
  } },

  { name: 'tabs: switch, create, rename, menu', async run({ F, check }) {
    tab('Work')!.click(); await sleep(10);
    check('switch tab', q('.tab.active')?.textContent === 'Work' && texts()[0] === 'Ship the todo app');
    q('#new-tab')!.click(); await sleep(10);
    const ti = q<HTMLInputElement>('.tab-input')!; ti.value = 'Personal'; key('Enter', {}, ti); await sleep(20);
    check('new list created + active', q('.tab.active')?.textContent === 'Personal' && F.Personal === '# Personal\n\n');
    mouse('dblclick', q('.tab.active')!); await sleep(10);
    const ri = q<HTMLInputElement>('.tab-input');
    check('rename input prefilled', !!ri && ri.value === 'Personal');
    ri!.value = 'Projects'; key('Enter', {}, ri!); await sleep(20);
    check('renamed file + tab', !!F.Projects && !F.Personal && q('.tab.active')?.textContent === 'Projects');
    mouse('dblclick', q('.tab.active')!); await sleep(10);
    key('Escape', {}, q('.tab-input')!); await sleep(10);
    check('rename escape restores tab', !q('.tab-input') && q('.tab.active')?.textContent === 'Projects');
    mouse('contextmenu', q('.tab.active')!); await sleep(10);
    check('tab menu', ctxButtons().join('|') === 'Rename…|Color…|Delete…');
    ctxClick('Rename…'); await sleep(10);
    check('menu rename opens input', q('#ctx')!.hidden && q<HTMLInputElement>('.tab-input')?.value === 'Projects');
    key('Escape', {}, q('.tab-input')!); await sleep(10);
    mouse('contextmenu', q('.tab.active')!); await sleep(10);
    ctxClick('Delete…'); await sleep(10);
    check('menu delete asks', !q('#modal')!.hidden && /Projects/.test(q('#modal-msg')!.textContent ?? ''));
    q('#modal-cancel')!.click(); await sleep(10);
    check('delete cancelled keeps list', !!F.Projects && q('#modal')!.hidden);
    mouse('contextmenu', q('.tab.active')!); await sleep(10);
    key('Escape'); await sleep(10);
    check('escape closes menu', q('#ctx')!.hidden);
    mouse('contextmenu', q('.tab.active')!); await sleep(10);
    ctxClick('Delete…'); await sleep(10); q('#modal-ok')!.click(); await sleep(20);
    check('delete removes list', !F.Projects && q('.tab.active')?.textContent === 'Home');
  } },

  { name: 'tab reorder by drag', async run({ mock, check }) {
    const tabs = qa('.tab');
    const work = tabs[2], wr = work.getBoundingClientRect(), hr = tabs[0].getBoundingClientRect();
    const y = wr.top + wr.height / 2;
    ptr('pointerdown', work, wr.left + wr.width / 2, y);
    ptr('pointermove', window, wr.left + wr.width / 2 - 10, y); await sleep(5);
    ptr('pointermove', window, hr.left + 2, y); await sleep(5);
    check('tab follows pointer', qa('.tab')[0] === work && work.classList.contains('dragging'));
    ptr('pointerup', window, hr.left + 2, y); await sleep(20);
    check('tab order persisted', mock.order.join() === 'Work,Home,Todo' && qa('.tab').map((t) => t.textContent).join() === 'Work,Home,Todo');
    check('active tab unchanged by reorder', q('.tab.active')?.textContent === 'Todo');
  } },

  { name: 'tab color', async run({ mock, check }) {
    mouse('contextmenu', tab('Work')!); await sleep(10);
    ctxClick('Color…'); await sleep(10);
    check('color submenu', ctxButtons().length === 11 && qa('#ctx .swatch').length === 10 && q('#ctx button.checked')?.textContent === 'None');
    ctxClick('Blue'); await sleep(20);
    const colored = tab('Work')!;
    check('tab colored + persisted', mock.colors.Work === '#3e63dd' && colored.dataset.color === '#3e63dd' && colored.style.getPropertyValue('--tab-color') === '#3e63dd');
    mouse('contextmenu', colored); await sleep(10);
    ctxClick('Color…'); await sleep(10);
    check('current color checked', q('#ctx button.checked')?.textContent === 'Blue');
    ctxClick('None'); await sleep(20);
    check('color cleared', !mock.colors.Work && !tab('Work')!.dataset.color);
  } },

  { name: 'progress badges', active: 'Work', async run({ mock, check }) {
    const badgeOf = (name: string): string => tab(name)?.querySelector('.badge')?.textContent ?? '';
    const btn = (): string => q('#badge-btn .sample')?.textContent ?? '';
    const ringOffset = (): number => parseFloat(qa<SVGCircleElement>('#badge-btn .ring circle')[1]?.getAttribute('stroke-dashoffset') ?? '-1');
    check('badges off by default', btn() === 'off' && !q('.tab .badge') && !!q('#badge-btn .ring'));
    { const b = q('#badge-btn')!; const cs = getComputedStyle(b); check('button lays out ring and text side by side', /flex/.test(cs.display) && b.offsetWidth > 30 && b.offsetWidth < 70 && b.offsetHeight <= 26); }
    q('#badge-btn')!.click(); await sleep(10);
    check('ratio badge, button previews the active tab', mock.config.tabs.badge === 'ratio' && btn() === '1/6' && badgeOf('Work') === '1/6' && badgeOf('Home') === '');
    check('ring shows 1/6 done', Math.abs(ringOffset() - 2 * Math.PI * 5.5 * (5 / 6)) < 0.05);
    q('#badge-btn')!.click(); await sleep(10);
    check('percent badge', btn() === '17%' && badgeOf('Work') === '17%');
    q('#badge-btn')!.click(); await sleep(10);
    check('remaining badge', btn() === '(5)' && badgeOf('Work') === '(5)');
    qa('#list .task .check')[0].click(); await sleep(10);
    check('badge + button update on toggle', badgeOf('Work') === '(4)' && btn() === '(4)' && Math.abs(ringOffset() - 2 * Math.PI * 5.5 * (4 / 6)) < 0.05);
    tab('Home')!.click(); await sleep(10);
    check('empty list shows a placeholder preview', btn() === '(2)' && q('#badge-btn')!.classList.contains('placeholder'));
    q('#badge-btn')!.click(); await sleep(10);
    check('badges cycle back to off', btn() === 'off' && !q('.tab .badge') && /Click for completed\/total/.test(q('#badge-btn')!.title));
  } },

  { name: 'nesting: subtree drag, tab indent, no adoption', active: 'Work', async run({ F, check }) {
    check('rule rendered', qa('#list .rule').length === 1);
    check('nested rows indented', rows()[3].style.marginLeft === '18px');
    await dragRow(2, top(rows()[0]));
    check('subtree moved together', texts().slice(0, 5).join('|') === 'Parent|Child A|Child B|Ship the todo app|Write the core crate');
    check('subtree serialised', F.Work.startsWith('# Work\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [ ] Ship the todo app\n'));
    qa('#list .task .text')[3].click(); await sleep(10);
    const inp = q<HTMLInputElement>('#list .edit')!;
    key('Tab', {}, inp); await sleep(10);
    check('tab indents one level', F.Work.includes('  - [ ] Child B\n  - [ ] Ship the todo app\n'));
    key('Tab', {}, inp); await sleep(10);
    check('tab again nests under Child B', F.Work.includes('  - [ ] Child B\n    - [ ] Ship the todo app\n'));
    key('Tab', {}, inp); await sleep(10);
    check('cannot nest deeper than one below previous', F.Work.includes('    - [ ] Ship the todo app\n'));
    key('Tab', { shiftKey: true }, inp); key('Tab', { shiftKey: true }, inp); await sleep(10);
    check('shift-tab outdents to root', F.Work.includes('  - [ ] Child B\n- [ ] Ship the todo app\n'));
    key('Escape', {}, inp); await sleep(10);
    await dragRow(3, top(rows()[1]), { dx: -60 });
    check('no adoption: joins as sibling of the children', F.Work.startsWith('# Work\n\n- [ ] Parent\n  - [ ] Ship the todo app\n  - [ ] Child A\n  - [ ] Child B\n- [x] Write'));
    await dragRow(1, top(rows()[4]), { dx: -60 });
    check('drag back out to root after the subtree', F.Work.startsWith('# Work\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [ ] Ship the todo app\n- [x] Write'));
    await dragRow(4, addRowTop(), { dx: -40 });
    check('drag past the rule', F.Work.endsWith('---\n\n- [ ] Below the rule\n- [x] Write the core crate\n'));
  } },

  { name: 'nesting gestures: slight right and hover drop-inside', active: 'Work', async run({ F, check }) {
    await dragRow(1, rows()[4].getBoundingClientRect().bottom + 2, { dx: 14 });
    check('slight right drag nests under the item above', F.Work.includes('  - [ ] Child B\n  - [x] Write the core crate\n\n---'));
    await dragRow(5, mid(rows()[1]), { dwell: 450 });
    check('drop-inside highlight cleared', !q('.drop-inside'));
    check('hover-drop nests as last child', F.Work.includes('  - [x] Write the core crate\n  - [ ] Below the rule\n\n---'));
    await dragRow(5, addRowTop(), { dx: -60 });
    check('drag out to root at the end', F.Work.endsWith('---\n\n- [ ] Below the rule\n'));
  } },

  { name: 'clipboard: copy, cut, paste, cross-tab, external', active: 'Work', async run({ F, mock, check }) {
    rows()[2].click(); await sleep(5);
    check('click selects row', rows()[2].classList.contains('selected') && state().selected === 4);
    key('c', { metaKey: true });
    check('copy captures subtree', state().clip?.length === 3 && state().clipText === '- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n');
    rows()[0].click(); await sleep(5);
    key('v', { metaKey: true }); await sleep(250);
    check('paste after selected sibling', F.Work.includes('- [ ] Ship the todo app\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n- [x] Write'));
    check('pasted root selected', q('#list .task.selected .text')?.textContent === 'Parent' && state().selected === 3);
    key('x', { metaKey: true }); await sleep(10);
    check('cut removes subtree', F.Work === mock.snapshot().files.find((f) => f.name === 'Work')!.raw && rows().length === 6 && !F.Work.includes('Ship the todo app\n- [ ] Parent'));
    tab('Home')!.click(); await sleep(10);
    key('v', { metaKey: true }); await sleep(250);
    check('paste into other tab at end', F.Home === '# Home\n\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n');
    mouse('contextmenu', rows()[0]); await sleep(10);
    check('todo menu items', ctxButtons().join('|') === 'Copy|Cut|Paste|Copy to…|Move to…|Delete…');
    ctxClick('Move to…'); await sleep(10);
    check('move submenu lists other tabs', ctxButtons().join('|') === '‹ Back|Todo|Work');
    ctxClick('Work'); await sleep(30);
    check('moved out of source', F.Home === '# Home\n\n' && rows().length === 0);
    check('moved into target end', F.Work.endsWith('- [ ] Below the rule\n- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B\n'));
    const dt = new DataTransfer(); dt.setData('text/plain', 'notes\n  - [ ] pasted\n    - [x] child\n');
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); await sleep(30);
    check('external paste parses tasks', F.Home === '# Home\n\n- [ ] pasted\n  - [x] child\n');
    key('ArrowDown'); key('ArrowDown');
    check('arrow selects next', q('#list .task.selected .text')?.textContent === 'child');
    key(' '); await sleep(10);
    check('space toggles', F.Home.includes('  - [ ] child'));
    key('ArrowUp'); key('Backspace'); await sleep(10);
    check('delete asks incl. nested count', !q('#modal')!.hidden && /"pasted" and 1 nested item\?/.test(q('#modal-msg')!.textContent ?? ''));
    q('#modal-ok')!.click(); await sleep(10);
    check('subtree deleted', F.Home === '# Home\n\n');
    key('Escape');
    check('escape clears selection', state().selected === null);
  } },

  { name: 'inactive fade', async run({ mock, check }) {
    const opacity = (): string => getComputedStyle(document.documentElement).getPropertyValue('--opacity').trim();
    check('slider disabled while off', opacity() === '0.92' && q<HTMLInputElement>('#s-fade-opacity')!.disabled);
    mock.emit('todo:focus', false); await sleep(5);
    check('no fade while the setting is off', opacity() === '0.92');
    const fade = q<HTMLInputElement>('#s-fade')!; fade.checked = true; fade.dispatchEvent(new Event('change')); await sleep(10);
    check('enabled + persisted', mock.config.window.inactive_opacity_enabled && !q<HTMLInputElement>('#s-fade-opacity')!.disabled);
    check('fades when unfocused', opacity() === '0.5');
    document.documentElement.dispatchEvent(new MouseEvent('mouseenter')); await sleep(5);
    check('hover restores', opacity() === '0.92');
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave')); await sleep(5);
    check('leaving fades again', opacity() === '0.5');
    mock.emit('todo:focus', true); await sleep(5);
    check('focus restores', opacity() === '0.92');
    const slider = q<HTMLInputElement>('#s-fade-opacity')!; slider.value = '0.3'; slider.dispatchEvent(new Event('input')); await sleep(260);
    mock.emit('todo:focus', false); await sleep(5);
    check('custom faded opacity persisted and applied', mock.config.window.inactive_opacity === 0.3 && opacity() === '0.3');
    fade.checked = false; fade.dispatchEvent(new Event('change')); await sleep(10);
    check('turning it off restores immediately', opacity() === '0.92' && !mock.config.window.inactive_opacity_enabled);
  } },

  { name: 'mirror to the other side of the screen', async run({ mock, check }) {
    const btn = q('#mirror-btn')!;
    const filled = (): string => btn.querySelector('g rect')?.getAttribute('x') ?? '';
    check('starts on the left, icon shades the right half', btn.dataset.target === 'right' && filled() === '12' && /right side/.test(btn.title));
    btn.click(); await sleep(10);
    check('click asks the backend to mirror', mock.calls.includes('mirror_window') && mock.side === 'right');
    check('icon now shades the left half', btn.dataset.target === 'left' && filled() === '4' && /left side/.test(btn.title));
    btn.click(); await sleep(10);
    check('click again jumps back', mock.side === 'left' && btn.dataset.target === 'right');
    key('ArrowRight', { metaKey: true, shiftKey: true }); await sleep(10);
    check('cmd+shift+arrow mirrors too', mock.side === 'right');
    mock.emit('todo:moved', 'left'); await sleep(5);
    check('dragging the window elsewhere updates the icon', btn.dataset.target === 'right');
  } },

  { name: 'settings', async run({ mock, check }) {
    q('#settings-btn')!.click(); await sleep(10);
    check('settings open', !q('#settings')!.hidden);
    const sel = q<HTMLSelectElement>('#s-appearance')!;
    sel.value = 'light'; sel.dispatchEvent(new Event('change')); await sleep(10);
    check('light theme applied', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ffffff' && mock.config.appearance === 'light');
    const tabsSel = q<HTMLSelectElement>('#s-tabs')!;
    tabsSel.value = 'wrap'; tabsSel.dispatchEvent(new Event('change')); await sleep(10);
    check('tab overflow wrap applied', mock.config.tabs.overflow === 'wrap' && q('#tabs')!.classList.contains('wrap') && getComputedStyle(q('#tabs')!).flexWrap === 'wrap');
    q('#pin-btn')!.click(); await sleep(10);
    check('pin toggles always-on-top', mock.config.window.always_on_top && q('#pin-btn')!.classList.contains('active'));
    key('Escape');
    check('escape closes settings', q('#settings')!.hidden);
  } },
];

export async function runAll(mock: MockBackend): Promise<string[]> {
  const out: string[] = [];
  let pass = 0, fail = 0;
  for (const sc of scenarios) {
    mock.reset();
    localStorage.setItem('active', sc.active ?? 'Todo');
    window.__todo!.reset(mock.cfgPayload(), mock.snapshot(), sc.active ?? 'Todo');
    await sleep(10);
    const check: Check = (name, cond) => { out.push(`${cond ? 'PASS' : 'FAIL'} ${sc.name}: ${name}`); if (cond) pass++; else fail++; };
    try { await sc.run({ mock, F: mock.files, check }); }
    catch (e) { out.push(`FAIL ${sc.name}: ERROR ${String(e)}\n${(e as Error).stack ?? ''}`); fail++; }
  }
  out.push(`# ${pass} pass, ${fail} fail`);
  return out;
}

/** ?demo=inside: freeze mid-drag with the "drop inside" affordance showing. */
export async function demoInside(): Promise<void> {
  const row = rows()[5], r = row.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  ptr('pointerdown', row.querySelector('.text')!, x, y);
  const midY = mid(rows()[0]);
  for (let i = 1; i <= 6; i++) { ptr('pointermove', window, x, y + (midY - y) * i / 6); await sleep(5); }
  await sleep(400);
  ptr('pointermove', window, x, midY + 0.5);
}
