/** Harness entry: installs the mock backend before ui/app.js runs, then drives it. */
import { MockBackend } from './mock.ts';
import { demoInside, runAll } from './scenarios.ts';

declare global {
  interface Window {
    __harness: { mock: MockBackend; afterAppLoad(): Promise<void> };
  }
}

const mock = new MockBackend();
const qs = new URLSearchParams(location.search);

// Query tweaks for screenshots: ?md ?tab=Work ?scheme=x ?wrap ?colors ?badge=ratio
localStorage.setItem('view', qs.has('md') ? 'markdown' : 'rendered');
localStorage.setItem('active', qs.get('tab') ?? 'Todo');
const scheme = qs.get('scheme');
if (scheme) mock.config.dark_scheme = scheme;
if (qs.has('wrap')) { mock.config.tabs.overflow = 'wrap'; for (const n of ['Groceries', 'Reading list', 'Someday', 'Errands']) mock.files[n] = `# ${n}\n\n- [ ] one\n`; }
if (qs.has('colors')) { mock.colors.Work = '#3e63dd'; mock.colors.Todo = '#30a46c'; }
const badge = qs.get('badge');
if (badge === 'ratio' || badge === 'percent' || badge === 'remaining') mock.config.tabs.badge = badge;

window.__TAURI__ = mock.global();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

window.__harness = {
  mock,
  async afterAppLoad() {
    for (let i = 0; i < 200 && !window.__todo?.state.cfg; i++) await sleep(10);
    if (qs.has('autotest')) {
      const lines = await runAll(mock);
      const pre = document.createElement('pre');
      pre.id = 'results';
      pre.textContent = lines.join('\n');
      document.body.append(pre);
    } else if (qs.get('demo') === 'inside') {
      await demoInside();
    }
  },
};
