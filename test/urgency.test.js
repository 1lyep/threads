import test from 'node:test';
import assert from 'node:assert/strict';
import { urgencyLevel } from '../lib/urgency.js';

const now = new Date('2026-11-06T10:00:00+08:00');
for (const [slackMs, expected] of [[480 * 60000 + 1, 0], [480 * 60000, 1], [240 * 60000, 2], [120 * 60000, 3], [30 * 60000, 4]]) {
  test(`重要度边界：余量 ${slackMs}ms → ${expected}`, () => {
    const card = { column: 'doing', estimateMin: 90, due: new Date(now.getTime() + slackMs + 90 * 60000).toISOString() };
    assert.equal(urgencyLevel(card, now), expected);
  });
}
for (const [column, expected] of [['raw', 0], ['tomorrow', 0], ['done', null]]) {
  test(`重要度特殊列：${column}`, () => {
    assert.equal(urgencyLevel({ column, due: '2020-01-01T00:00:00Z', estimateMin: 1440 }, now), expected);
  });
}
