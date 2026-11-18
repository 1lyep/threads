import { readState, writeState, withLock } from './store.js';
import { columns, localISO, isZonedISO } from './parse.js';

const fields = {
  'card.add': ['title', 'threadId', 'column', 'description', 'doneWhen', 'due', 'estimateMin'],
  'card.update': ['id', 'title', 'description', 'doneWhen', 'due', 'estimateMin', 'threadId'],
  'card.move': ['id', 'column', 'index'],
  'card.delete': ['id'],
  'progress.add': ['cardId', 'text', 'author'],
  'progress.update': ['cardId', 'progressId', 'text'],
  'progress.delete': ['cardId', 'progressId'],
  'archive.run': [],
  'thread.add': ['name', 'icon'],
  'thread.update': ['id', 'name', 'icon'],
  'thread.move': ['id', 'index'],
  'thread.delete': ['id'],
};

function string(value, label, min, max) {
  if (typeof value !== 'string' || [...value].length < min || [...value].length > max || (min && !value.trim())) {
    throw new Error(`${label}须为 ${min}–${max} 字的字符串`);
  }
}

function positiveId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('编号须为正整数');
}

function find(items, id, label) {
  positiveId(id);
  const item = items.find(item => item.id === id);
  if (!item) throw new Error(`${label}不存在：#${id}`);
  return item;
}

function validateIcon(icon) {
  if (typeof icon !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(icon)) throw new Error('图标须为 Tabler 图标名，如 world、book');
}

function validateColumn(column) {
  if (!columns.includes(column)) throw new Error('列名无效');
}

function position(index, length) {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new Error(`位置须为 0–${length} 的整数`);
  return index;
}

function cardOrder(state, card, index) {
  const group = state.cards.filter(other => other.id !== card.id && !other.archivedAt && other.column === card.column && other.threadId === card.threadId).sort((a, b) => a.order - b.order || a.id - b.id);
  const at = index === undefined ? group.length : position(index, group.length);
  if (group.length === 0) return 1000;
  if (at === group.length) return group.at(-1).order + 1000;
  if (at === 0) return group[0].order - 1000;
  return (group[at - 1].order + group[at].order) / 2;
}

function validateCardFields(state, args) {
  if ('title' in args) string(args.title, '标题', 1, 200);
  for (const key of ['description', 'doneWhen']) {
    if (key in args) string(args[key], key === 'description' ? '描述' : '结束条件', 0, 5000);
  }
  if ('threadId' in args) find(state.threads, args.threadId, '线头');
  if ('due' in args && args.due !== null && !isZonedISO(args.due)) throw new Error('截止时间须为带时区的 ISO 时间或 null');
  if ('estimateMin' in args && args.estimateMin !== null && (!Number.isInteger(args.estimateMin) || args.estimateMin < 1 || args.estimateMin > 1440)) throw new Error('预计用时须为 1–1440 的整数或 null');
}

export function applyOp(state, op, args = {}, now = new Date()) {
  if (!Object.hasOwn(fields, op)) throw new Error(`未知操作：${op}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('操作参数须为对象');
  for (const key of Object.keys(args)) {
    if (!fields[op].includes(key)) throw new Error(`操作 ${op} 不支持参数：${key}`);
  }
  const next = structuredClone(state);
  const at = localISO(now);
  if (op === 'thread.add' || op === 'thread.update') {
    const thread = op === 'thread.update' ? find(next.threads, args.id, '线头') : null;
    if (op === 'thread.add' || 'name' in args) {
      string(args.name, '线头名', 1, 20);
      if (next.threads.some(other => other.id !== thread?.id && other.name === args.name)) throw new Error('线头名已存在');
    }
    if ('icon' in args) validateIcon(args.icon);
    if (thread) {
      for (const key of ['name', 'icon']) if (key in args) thread[key] = args[key];
    } else {
      next.threads.push({ id: next.nextThreadId++, name: args.name, icon: args.icon ?? 'circle', order: next.threads.length ? Math.max(...next.threads.map(t => t.order)) + 1 : 0, createdAt: at });
    }
  } else if (op === 'thread.move') {
    const thread = find(next.threads, args.id, '线头');
    const ordered = next.threads.filter(t => t.id !== thread.id).sort((a, b) => a.order - b.order || a.id - b.id);
    ordered.splice(position(args.index, ordered.length), 0, thread);
    ordered.forEach((item, index) => { item.order = index; });
  } else if (op === 'thread.delete') {
    find(next.threads, args.id, '线头');
    if (next.cards.some(card => card.threadId === args.id)) throw new Error('线头还有卡片（含已归档），不能删除');
    next.threads = next.threads.filter(thread => thread.id !== args.id);
  } else if (op === 'card.add') {
    string(args.title, '标题', 1, 200);
    find(next.threads, args.threadId, '线头');
    validateCardFields(next, args);
    validateColumn(args.column === undefined ? 'raw' : args.column);
    const card = {
      id: next.nextCardId++, threadId: args.threadId, column: args.column ?? 'raw', order: 1000,
      title: args.title, description: args.description ?? '', doneWhen: args.doneWhen ?? '',
      due: args.due === undefined || args.due === null ? null : localISO(args.due), estimateMin: args.estimateMin ?? null,
      progress: [], createdAt: at, updatedAt: at, doneAt: (args.column === 'done' ? at : null), archivedAt: null,
    };
    card.order = cardOrder(next, card);
    next.cards.push(card);
  } else if (op.startsWith('card.')) {
    const card = find(next.cards, args.id, '卡片');
    if (op === 'card.delete') {
      next.cards = next.cards.filter(item => item.id !== card.id);
    } else if (op === 'card.update') {
      validateCardFields(next, args);
      const oldThread = card.threadId;
      for (const key of fields[op]) if (key !== 'id' && key in args) card[key] = args[key];
      if (card.due !== null) card.due = localISO(card.due);
      if (oldThread !== card.threadId) card.order = cardOrder(next, card);
      card.updatedAt = at;
    } else {
      validateColumn(args.column);
      const previousColumn = card.column;
      card.column = args.column;
      card.order = cardOrder(next, card, args.index);
      if (card.column === 'tomorrow') card.due = null;
      if (card.column === 'done' && previousColumn !== 'done') card.doneAt = at;
      if (previousColumn === 'done' && card.column !== 'done') card.doneAt = null;
      card.updatedAt = at;
    }
  } else if (op.startsWith('progress.')) {
    const card = find(next.cards, args.cardId, '卡片');
    if (op === 'progress.add') {
      string(args.text, '进度内容', 1, 5000);
      string(args.author, '作者', 1, 32);
      card.progress.push({ id: next.nextProgressId++, at, author: args.author, text: args.text });
    } else {
      const progress = find(card.progress, args.progressId, '进度记录');
      if (op === 'progress.update') {
        string(args.text, '进度内容', 1, 5000);
        progress.text = args.text;
      } else card.progress = card.progress.filter(item => item.id !== progress.id);
    }
    card.updatedAt = at;
  } else if (op === 'archive.run') {
    for (const card of next.cards) {
      if (card.column === 'done' && !card.archivedAt) {
        card.archivedAt = at;
        card.updatedAt = at;
      }
    }
  }
  return next;
}

export async function runOp(op, args = {}) {
  return withLock(async () => {
    const state = await readState();
    const next = applyOp(state, op, args, new Date());
    next.rev = state.rev + 1;
    await writeState(next);
    return next;
  });
}
