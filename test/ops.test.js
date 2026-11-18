import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from '../lib/ops.js';
import { emptyState } from '../lib/store.js';
import { localISO } from '../lib/parse.js';

const now = new Date('2026-11-06T12:00:00+08:00');
function fixture() {
  let state = applyOp(emptyState(), 'thread.add', { name: '官网' }, now);
  return applyOp(state, 'card.add', { title: '修登录', threadId: 1, column: 'doing', due: '2026-11-06T15:00:00+08:00', estimateMin: 90 }, now);
}

test('card.move：进 tomorrow 清 due，保留预计用时，且不修改输入', () => {
  const state = fixture();
  const snapshot = structuredClone(state);
  const next = applyOp(state, 'card.move', { id: 1, column: 'tomorrow' }, now);
  assert.equal(next.cards[0].due, null);
  assert.equal(next.cards[0].estimateMin, 90);
  assert.deepEqual(state, snapshot);
});

test('card.move：进 done 设 doneAt，出 done 清 doneAt', () => {
  const done = applyOp(fixture(), 'card.move', { id: 1, column: 'done' }, now);
  assert.equal(done.cards[0].doneAt, localISO(now));
  const next = applyOp(done, 'card.move', { id: 1, column: 'review' }, now);
  assert.equal(next.cards[0].doneAt, null);
});

test('card.move：空组 1000，末尾 +1000，中间取均值，首位放在首卡之前', () => {
  let state = fixture();
  state = applyOp(state, 'card.add', { title: '第二张', threadId: 1, column: 'ready' }, now);
  state = applyOp(state, 'card.add', { title: '第三张', threadId: 1, column: 'ready' }, now);
  state = applyOp(state, 'card.add', { title: '第四张', threadId: 1, column: 'ready' }, now);
  const move = args => applyOp(state, 'card.move', { id: 1, column: 'ready', ...args }, now).cards[0].order;
  assert.equal(applyOp(state, 'card.move', { id: 1, column: 'review' }, now).cards[0].order, 1000);
  assert.equal(move({}), 4000);
  assert.equal(move({ index: 3 }), 4000);
  assert.equal(move({ index: 1 }), 1500);
  assert.equal(move({ index: 0 }), 0);
  const sameGroup = applyOp(state, 'card.move', { id: 2, column: 'ready', index: 1 }, now);
  assert.equal(sameGroup.cards.find(c => c.id === 2).order, 2500);
});

test('archive.run：只归档未归档的完成卡片，已有归档时间不变', () => {
  let state = fixture();
  state = applyOp(state, 'card.add', { title: '已完成', threadId: 1, column: 'done' }, now);
  state = applyOp(state, 'card.add', { title: '早已归档', threadId: 1, column: 'done' }, now);
  const earlier = localISO(new Date(now.getTime() - 3600000));
  state.cards[2].archivedAt = earlier;
  const next = applyOp(state, 'archive.run', {}, now);
  assert.equal(next.cards[0].archivedAt, null);
  assert.equal(next.cards[1].archivedAt, localISO(now));
  assert.equal(next.cards[2].archivedAt, earlier);
});

test('thread.delete：有普通卡片或已归档卡片均拒绝', () => {
  const state = fixture();
  assert.throws(() => applyOp(state, 'thread.delete', { id: 1 }, now), /还有卡片/);
  state.cards[0].archivedAt = localISO(now);
  state.cards[0].column = 'done';
  assert.throws(() => applyOp(state, 'thread.delete', { id: 1 }, now), /还有卡片/);
});
