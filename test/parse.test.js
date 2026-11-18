import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, parseEstimate, localISO } from '../lib/parse.js';

const now = new Date(2026, 10, 6, 16, 0);
for (const [input, expected] of [
  ['15:00', new Date(2026, 10, 6, 15, 0)],
  ['11-07 15:00', new Date(2026, 10, 7, 15, 0)],
  ['2026-11-07 15:00', new Date(2026, 10, 7, 15, 0)],
  ['2026-11-07', new Date(2026, 10, 7, 23, 30)],
  ['2026-11-07T15:00:00.000+08:00', new Date('2026-11-07T15:00:00.000+08:00')],
  ['2026-11-07T07:00:00.000Z', new Date('2026-11-07T07:00:00.000Z')],
]) {
  test(`时间解析：${input}`, () => assert.equal(parseTime(input, now), localISO(expected)));
}
for (const [input, expected] of [['30m', 30], ['1h', 60], ['1.5h', 90], ['90', 90]]) {
  test(`用时解析：${input}`, () => assert.equal(parseEstimate(input), expected));
}
