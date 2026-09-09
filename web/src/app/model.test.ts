import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendIndex, badgeText, blockFromTyped, blocksToMarkdown, clampDropLevel, collapseBlanks, countText, headingFromText,
  effectiveOpacity, hexToRgb, insertBlocks, isRuleText, levelOf, nextBadgeMode, nextTaskIndex, parseTaskLines, pasteTarget,
  deferredFlags, isDeferred, isEmptyTask, prevTaskLevel, pruneEmptyTasks, removeSubtree, setLevel, shiftLevels, splitTags, subtreeBlocks, subtreeEnd, taskCounts,
} from './model.ts';
import type { Block } from './types.ts';

const t = (text: string, level = 0, done = false): Block => ({ kind: 'task', done, text, indent: '  '.repeat(level) });
const h = (text: string, level = 1): Block => ({ kind: 'heading', level, text });
const blank: Block = { kind: 'blank' };
const rule: Block = { kind: 'rule', text: '---' };

const tree = (): Block[] => [h('T'), blank, t('A'), t('A1', 1), t('A1a', 2), t('A2', 1), t('B'), blank, h('Later', 2), blank, t('C')];

test('levelOf reads two-space and tab indents', () => {
  assert.equal(levelOf(t('x', 2)), 2);
  assert.equal(levelOf({ kind: 'task', done: false, text: '', indent: '\t' }), 1);
  assert.equal(levelOf(h('x')), 0);
});

test('subtreeEnd covers the run of deeper tasks', () => {
  const b = tree();
  assert.equal(subtreeEnd(b, 2), 6); // A + A1 + A1a + A2
  assert.equal(subtreeEnd(b, 3), 5); // A1 + A1a
  assert.equal(subtreeEnd(b, 6), 7); // B alone (blank stops it)
  assert.equal(subtreeEnd(b, 10), 11);
});

test('prevTaskLevel stops at headings and rules', () => {
  const b = tree();
  assert.equal(prevTaskLevel(b, 2), -1);
  assert.equal(prevTaskLevel(b, 5), 2);
  assert.equal(prevTaskLevel(b, 10), -1);
  assert.equal(prevTaskLevel([t('a'), rule, t('b')], 2), -1);
});

test('setLevel moves a subtree and clamps at zero', () => {
  const b = tree();
  assert.equal(setLevel(b, 2, 1), true);
  assert.deepEqual([2, 3, 4, 5].map((i) => levelOf(b[i])), [1, 2, 3, 2]);
  assert.equal(setLevel(b, 2, 1), false);
  setLevel(b, 3, 0);
  assert.deepEqual([3, 4].map((i) => levelOf(b[i])), [0, 1]);
  assert.equal(levelOf(b[5]), 2, 'A2 was not part of A1 subtree');
});

test('shiftLevels only touches the given blocks', () => {
  const group = [t('x', 1), t('y', 2)];
  shiftLevels(group, -1);
  assert.deepEqual(group.map(levelOf), [0, 1]);
  shiftLevels(group, -5);
  assert.deepEqual(group.map(levelOf), [0, 0]);
});

test('clampDropLevel never adopts the item below', () => {
  // between A(0) and its child B(1): only level 1 is allowed
  assert.equal(clampDropLevel(0, 0, 1), 1);
  assert.equal(clampDropLevel(5, 0, 1), 1);
  // after the last child (1), before a root item (0): 0..2
  assert.equal(clampDropLevel(-3, 1, 0), 0);
  assert.equal(clampDropLevel(2, 1, 0), 2);
  assert.equal(clampDropLevel(3, 1, 0), 2);
  // section start: max 0
  assert.equal(clampDropLevel(4, -1, 0), 0);
});

test('appendIndex keeps heading spacing but skips trailing blanks', () => {
  assert.equal(appendIndex([h('A'), blank]), 2);
  assert.equal(appendIndex([h('A'), blank, t('x'), blank, blank]), 3);
  assert.equal(appendIndex([rule, blank]), 2);
  assert.equal(appendIndex([]), 0);
  assert.equal(appendIndex([t('x')]), 1);
});

test('isRuleText / headingFromText / blockFromTyped', () => {
  for (const s of ['---', '-----', '* * *', '___', ' --- ']) assert.equal(isRuleText(s), true, s);
  for (const s of ['--', '--- x', 'a---', '']) assert.equal(isRuleText(s), false, s);
  assert.deepEqual(headingFromText('## Tonight '), { kind: 'heading', level: 2, text: 'Tonight' });
  assert.equal(headingFromText('#nope'), null);
  assert.equal(headingFromText('####### seven'), null);
  assert.deepEqual(blockFromTyped('---'), { kind: 'rule', text: '---' });
  assert.deepEqual(blockFromTyped('# T'), { kind: 'heading', level: 1, text: 'T' });
  assert.deepEqual(blockFromTyped('buy milk', '  '), { kind: 'task', done: false, text: 'buy milk', indent: '  ' });
});

test('blocksToMarkdown matches the Rust serializer', () => {
  const md = blocksToMarkdown([h('T'), blank, t('a'), t('b', 1, true), { kind: 'text', text: 'note' }, rule, { kind: 'rule', text: '' }, t('')]);
  assert.equal(md, '# T\n\n- [ ] a\n  - [x] b\nnote\n---\n---\n- [ ]\n');
  assert.equal(blocksToMarkdown([]), '');
});

test('parseTaskLines takes task lines only and re-bases indentation', () => {
  const out = parseTaskLines('notes\r\n    - [ ] a\n      - [x] b\n  * [X] c\n- nope\n');
  assert.deepEqual(out, [t('a', 1), t('b', 2, true), t('c', 0, true)]); // shallowest line (c) becomes level 0
  assert.deepEqual(parseTaskLines(''), []);
  assert.deepEqual(parseTaskLines(null), []);
  assert.deepEqual(parseTaskLines('- [ ]'), [t('')]);
});

test('subtreeBlocks deep-copies and re-bases; removeSubtree removes the run', () => {
  const b = tree();
  const sub = subtreeBlocks(b, 3);
  assert.deepEqual(sub, [t('A1'), t('A1a', 1)]);
  assert.equal(levelOf(b[3]), 1, 'source untouched');
  assert.equal(removeSubtree(b, 2), 4);
  assert.deepEqual(b.map((x) => (x.kind === 'task' ? x.text : x.kind)), ['heading', 'blank', 'B', 'blank', 'heading', 'blank', 'C']);
});

test('pasteTarget and insertBlocks', () => {
  const b = tree();
  assert.deepEqual(pasteTarget(b, 3), { at: 5, level: 1 }); // after A1's subtree, as A1's sibling
  assert.deepEqual(pasteTarget(b, null), { at: 11, level: 0 });
  assert.deepEqual(pasteTarget(b, 0), { at: 11, level: 0 }, 'heading selected counts as nothing');
  const clone = insertBlocks(b, 5, [t('N'), t('N1', 1)], 1);
  assert.deepEqual(clone, [t('N', 1), t('N1', 2)]);
  assert.equal((b[5] as { text: string }).text, 'N');
  assert.equal((b[7] as { text: string }).text, 'A2');
});

test('badges and counts', () => {
  const b = [t('a', 0, true), t('b'), t('c'), h('x')];
  assert.deepEqual(taskCounts(b), { total: 3, done: 1 });
  assert.equal(badgeText(b, 'none'), '');
  assert.equal(badgeText(b, 'ratio'), '1/3');
  assert.equal(badgeText(b, 'percent'), '33%');
  assert.equal(badgeText(b, 'remaining'), '(2)');
  assert.equal(badgeText([h('x')], 'ratio'), '');
  assert.equal(countText(b), '2 left');
  assert.equal(countText([t('a', 0, true)]), 'all done ✓');
  assert.equal(countText([]), '');
  assert.equal(nextBadgeMode('none'), 'ratio');
  assert.equal(nextBadgeMode('remaining'), 'none');
});

test('nextTaskIndex navigation', () => {
  const b = tree();
  assert.equal(nextTaskIndex(b, null, 1), 2);
  assert.equal(nextTaskIndex(b, null, -1), 10);
  assert.equal(nextTaskIndex(b, 2, 1), 3);
  assert.equal(nextTaskIndex(b, 6, 1), 10);
  assert.equal(nextTaskIndex(b, 10, 1), 10);
  assert.equal(nextTaskIndex(b, 2, -1), 2);
  assert.equal(nextTaskIndex([h('x')], null, 1), null);
});

test('collapseBlanks and hexToRgb', () => {
  assert.deepEqual(collapseBlanks([blank, blank, t('a'), blank, blank, blank, t('b')]).length, 4);
  assert.equal(hexToRgb('#0b1220'), '11, 18, 32');
});

test('effectiveOpacity fades only when enabled, unfocused and unhovered', () => {
  const w = { opacity: 0.9, inactive_opacity_enabled: true, inactive_opacity: 0.4 };
  assert.equal(effectiveOpacity(w, false, false), 0.4);
  assert.equal(effectiveOpacity(w, true, false), 0.9);
  assert.equal(effectiveOpacity(w, false, true), 0.9);
  assert.equal(effectiveOpacity({ ...w, inactive_opacity_enabled: false }, false, false), 0.9);
});

test('splitTags finds bracketed tags and leaves the rest as text', () => {
  assert.deepEqual(splitTags('Buy milk [urgent] today'), [
    { kind: 'text', text: 'Buy milk ' }, { kind: 'tag', tag: 'urgent', deferred: false }, { kind: 'text', text: ' today' },
  ]);
  assert.deepEqual(splitTags('[Later] Call mom'), [{ kind: 'tag', tag: 'Later', deferred: true }, { kind: 'text', text: ' Call mom' }]);
  assert.deepEqual(splitTags('plain text'), [{ kind: 'text', text: 'plain text' }]);
  assert.deepEqual(splitTags(''), []);
  assert.deepEqual(splitTags('a [] b [ ] c'), [{ kind: 'text', text: 'a [] b [ ] c' }]);
  assert.deepEqual(splitTags('x [[nested]] y').filter((p) => p.kind === 'tag').map((p) => p.kind === 'tag' && p.tag), ['nested']);
  assert.deepEqual(splitTags('[next week][home]').map((p) => p.kind === 'tag' && p.tag), ['next week', 'home']);
});

test('isDeferred is case-insensitive and only true for parked tags', () => {
  assert.equal(isDeferred('Fix bug [tomorrow]'), true);
  assert.equal(isDeferred('Fix bug [LATER]'), true);
  assert.equal(isDeferred('Fix bug [someday]'), true);
  assert.equal(isDeferred('Fix bug [urgent]'), false);
  assert.equal(isDeferred('Fix bug later'), false);
  assert.equal(isDeferred('Fix bug'), false);
});

test('deferredFlags parks a deferred heading and its section until a same-or-higher heading', () => {
  const b: Block[] = [
    h('Now'), t('a'), t('b [later]'),
    h('Parked [tomorrow]'), t('c'), h('Sub', 2), t('d', 1), h('Deep', 3), t('e'),
    h('Back', 1), t('f'),
    h('Also [later]', 2), t('g'), h('Free', 2), t('h'), h('Top'), t('i'),
  ];
  assert.deepEqual(deferredFlags(b), [
    false, false, true,
    true, true, true, true, true, true,
    false, false,
    true, true, false, false, false, false,
  ]);
  assert.deepEqual(deferredFlags([h('x [LATER]', 3), { kind: 'text', text: 'note' }, rule, blank, t('y')]), [true, true, true, true, true]);
  assert.deepEqual(deferredFlags([h('x [urgent]'), t('y')]), [false, false]);
});

test('pruneEmptyTasks drops blank task lines and lifts their children', () => {
  assert.equal(isEmptyTask(t('')), true);
  assert.equal(isEmptyTask(t('   ')), true);
  assert.equal(isEmptyTask(t('x')), false);
  assert.equal(isEmptyTask(h('')), false);
  const b: Block[] = [h('T'), t(''), t('a'), t('  ', 0), t('kid', 1), t('grandkid', 2), t('b'), blank, t('', 1), t('c')];
  assert.deepEqual(pruneEmptyTasks(b), [1, 3, 8]);
  assert.deepEqual(b.map((x) => (x.kind === 'task' ? `${x.text}@${levelOf(x)}` : x.kind)), ['heading', 'a@0', 'kid@0', 'grandkid@1', 'b@0', 'blank', 'c@0']);
  assert.deepEqual(pruneEmptyTasks(b), []);
  const only: Block[] = [t(''), t('')];
  assert.deepEqual(pruneEmptyTasks(only), [0, 1]);
  assert.deepEqual(only, []);
});
