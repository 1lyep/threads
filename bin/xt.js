#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readState } from '../lib/store.js';
import { runOp } from '../lib/ops.js';
import { parseTime, parseEstimate, parseColumn, columns, columnNames } from '../lib/parse.js';
import { urgencyLevel } from '../lib/urgency.js';

const help = `线头 xt：网页与命令行共用本地数据，所有命令均可加 --json。

xt list [--thread 线头] [--column 列] [--all] [--json]
  默认显示未归档、未完成卡片；--all 包含完成及归档。
xt show <id> [--json]
xt add "<标题>" --thread 线头 [--column 列] [--due 时间] [--est 用时] [--desc 描述] [--when 结束条件]
xt edit <id> [--title …] [--desc …] [--when …] [--due 时间 | --no-due] [--est 用时 | --no-est] [--thread 线头]
xt move <id> <列>
xt done <id>
xt log <id> "<内容>" [--author 名字]
xt log-edit <id> <记录id> "<新内容>"
xt rm <id>
xt archive
xt thread list
xt thread add <名字> [--icon 图标]
xt thread rename <线头> <新名字>
xt thread rm <线头>
xt open
  打开网页看板；本地服务器没在运行就先在后台启动。
xt serve                  在前台运行本地服务
xt install-skill codex|claude  安装到当前用户并绑定这份看板
xt help

线头可用 id 或名字。列可用 tomorrow/明天、raw/原始需求、ready/整理后待执行/待执行、
doing/执行中、review/检查中、done/完成。
时间可用 15:00（始终是今天，即使已过时）、11-07 15:00（今年）、2026-11-07 15:00、
2026-11-07（23:30）或带时区的完整 ISO。用时可用 30m、1h、1.5h、90（分钟）。
作者依次取 --author、XT_AUTHOR、me。删除线头要求没有任何卡片（含归档）。

示例：xt thread add 官网 --icon world
      xt add "修登录页报错" --thread 官网 --column 执行中 --due 15:00 --est 1.5h
      xt log 1 "已定位问题" --author codex
      xt edit 1 --no-due --when "Safari 能登录"
      xt move 1 明天
      xt list --all --json`;

const schemas = {
  list: ['thread', 'column', 'all'], show: [],
  add: ['thread', 'column', 'due', 'est', 'desc', 'when'],
  edit: ['title', 'desc', 'when', 'due', 'no-due', 'est', 'no-est', 'thread'],
  move: [], done: [], log: ['author'], 'log-edit': [], rm: [], archive: [],
  'thread list': [], 'thread add': ['icon'], 'thread rename': [], 'thread rm': [], open: [], serve: [], 'install-skill': [], help: [],
};

function id(value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('编号须为正整数');
  return Number(value);
}

function cardById(state, value) {
  const number = id(value);
  const card = state.cards.find(card => card.id === number);
  if (!card) throw new Error(`卡片不存在：#${number}`);
  return card;
}

function threadByRef(state, value) {
  const thread = state.threads.find(thread => String(thread.id) === value || thread.name === value);
  if (!thread) throw new Error(`线头不存在：${value ?? '未指定，请用 --thread'}`);
  return thread;
}

function estText(minutes) {
  return minutes % 60 === 0 || minutes % 30 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function dueText(due, now) {
  const date = new Date(due);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return date.toDateString() === now.toDateString() ? clock : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${clock}`;
}

function cardFields(card, state, now) {
  const fields = [`#${card.id}`, state.threads.find(t => t.id === card.threadId)?.name ?? '', card.title];
  if (card.estimateMin !== null) fields.push(estText(card.estimateMin));
  if (card.due) fields.push(`截止 ${dueText(card.due, now)}`);
  const urgency = urgencyLevel(card, now);
  if (urgency !== null) fields.push(`亮度 ${urgency}`);
  if (card.archivedAt) fields.push('已归档');
  return fields;
}

// 终端中的中文通常占两格，供默认列表按字段对齐。
function width(text) { return [...text].reduce((sum, c) => sum + (c.codePointAt(0) > 255 ? 2 : 1), 0); }
function aligned(rows) {
  const widths = [];
  for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, width(cell)); });
  return rows.map(row => row.map((cell, i) => i === row.length - 1 ? cell : cell + ' '.repeat(widths[i] - width(cell) + 2)).join('')).join('\n');
}

function printCard(card, state, now) {
  console.log(cardFields(card, state, now).join('  '));
  console.log(`所在列：${columnNames[columns.indexOf(card.column)]}`);
  if (card.description) console.log(`描述：${card.description}`);
  if (card.doneWhen) console.log(`结束条件：${card.doneWhen}`);
  for (const progress of card.progress) console.log(`进度 #${progress.id}  ${progress.at}  ${progress.author}  ${progress.text}`);
}

async function serverUp(url) {
  try { return (await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

async function openBoard() {
  const url = `http://127.0.0.1:${Number(process.env.PORT ?? 4321)}`;
  if (!(await serverUp(url))) {
    const server = fileURLToPath(new URL('../server.js', import.meta.url));
    spawn(process.execPath, [server], { detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref();
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await new Promise(r => setTimeout(r, 100));
      up = await serverUp(url);
    }
    if (!up) throw new Error(`服务器没能启动，可以运行 xt serve 查看原因`);
  }
  if (process.env.XT_NO_BROWSER !== '1') {
    const opener = { win32: 'rundll32.exe', darwin: 'open', linux: 'xdg-open' }[process.platform];
    if (opener) {
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const child = spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => console.error('请在浏览器打开下方地址。'));
      child.unref();
    }
  }
  console.log(url);
}

async function main() {
  const argv = process.argv.slice(2);
  let command = argv.shift() ?? 'help';
  if (command === 'thread') command += ` ${argv.shift() ?? ''}`;
  if (!Object.hasOwn(schemas, command)) throw new Error('未知命令，请运行 xt help');
  const options = { json: { type: 'boolean' } };
  for (const key of schemas[command]) options[key] = { type: ['all', 'no-due', 'no-est'].includes(key) ? 'boolean' : 'string' };
  let parsed;
  try { parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true }); }
  catch { throw new Error('选项无效或缺少参数，请运行 xt help'); }
  const { values: flags, positionals: params } = parsed;
  const count = { list: 0, show: 1, add: 1, edit: 1, move: 2, done: 1, log: 2, 'log-edit': 3, rm: 1, archive: 0, 'thread list': 0, 'thread add': 1, 'thread rename': 2, 'thread rm': 1, open: 0, serve: 0, 'install-skill': 1, help: 0 }[command];
  if (params.length !== count) throw new Error('命令参数数量不正确，请运行 xt help');
  if (command === 'help') { console.log(help); return; }
  if (command === 'open') { await openBoard(); return; }
  if (command === 'serve') { await import('../server.js'); return; }
  if (command === 'install-skill') {
    const { installSkill } = await import('../scripts/install-skill.js');
    await installSkill(params[0]);
    return;
  }
  const state = await readState();
  const now = new Date();
  if (command === 'list') {
    const threadId = flags.thread === undefined ? null : threadByRef(state, flags.thread).id;
    const column = flags.column === undefined ? null : parseColumn(flags.column);
    const threadOrder = new Map(state.threads.map(t => [t.id, t.order]));
    const cards = state.cards.filter(card => (flags.all || (!card.archivedAt && card.column !== 'done')) && (threadId === null || card.threadId === threadId) && (column === null || card.column === column)).sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column) || threadOrder.get(a.threadId) - threadOrder.get(b.threadId) || a.order - b.order || a.id - b.id);
    if (flags.json) console.log(JSON.stringify(cards.map(card => ({ ...card, urgency: urgencyLevel(card, now) })), null, 2));
    else if (!cards.length) console.log('暂无卡片');
    else for (const column of columns) {
      const group = cards.filter(card => card.column === column);
      if (group.length) console.log(`${columnNames[columns.indexOf(column)]}\n${aligned(group.map(card => cardFields(card, state, now)))}`);
    }
    return;
  }
  if (command === 'show') {
    const card = cardById(state, params[0]);
    if (flags.json) console.log(JSON.stringify(card, null, 2)); else printCard(card, state, now);
    return;
  }
  if (command === 'thread list') {
    const threads = [...state.threads].sort((a, b) => a.order - b.order);
    if (flags.json) console.log(JSON.stringify(threads, null, 2));
    else console.log(threads.length ? aligned(threads.map(t => [`#${t.id}`, t.name, t.icon])) : '暂无线头');
    return;
  }
  let op, args = {}, target = 'card', targetId;
  if (command === 'add' || command === 'edit') {
    op = command === 'add' ? 'card.add' : 'card.update';
    if (command === 'add') { args.title = params[0]; args.threadId = threadByRef(state, flags.thread).id; }
    else { args.id = id(params[0]); targetId = args.id; }
    for (const [flag, field] of [['title', 'title'], ['desc', 'description'], ['when', 'doneWhen']]) if (flags[flag] !== undefined) args[field] = flags[flag];
    if (flags.thread !== undefined) args.threadId = threadByRef(state, flags.thread).id;
    if (flags.column !== undefined) args.column = parseColumn(flags.column);
    if (flags.due !== undefined && flags['no-due']) throw new Error('--due 与 --no-due 不能同时使用');
    if (flags.est !== undefined && flags['no-est']) throw new Error('--est 与 --no-est 不能同时使用');
    if (flags.due !== undefined) args.due = parseTime(flags.due, now);
    if (flags.est !== undefined) args.estimateMin = parseEstimate(flags.est);
    if (flags['no-due']) args.due = null;
    if (flags['no-est']) args.estimateMin = null;
  } else if (command === 'move' || command === 'done') {
    op = 'card.move'; args = { id: id(params[0]), column: command === 'done' ? 'done' : parseColumn(params[1]) }; targetId = args.id;
  } else if (command === 'log' || command === 'log-edit') {
    op = command === 'log' ? 'progress.add' : 'progress.update';
    args = { cardId: id(params[0]), text: params.at(-1) }; targetId = args.cardId;
    if (command === 'log') args.author = flags.author ?? process.env.XT_AUTHOR ?? 'me';
    else args.progressId = id(params[1]);
  } else if (command === 'rm') {
    op = 'card.delete'; args = { id: id(params[0]) }; targetId = args.id;
  } else if (command === 'archive') {
    op = 'archive.run'; target = 'archive';
  } else {
    target = 'thread';
    if (command === 'thread add') { op = 'thread.add'; args = { name: params[0] }; if (flags.icon !== undefined) args.icon = flags.icon; }
    else {
      targetId = threadByRef(state, params[0]).id;
      args = { id: targetId };
      if (command === 'thread rename') { op = 'thread.update'; args.name = params[1]; }
      else op = 'thread.delete';
    }
  }
  const removed = op === 'card.delete' ? cardById(state, params[0]) : op === 'thread.delete' ? threadByRef(state, params[0]) : null;
  const next = await runOp(op, args);
  let result;
  if (target === 'archive') result = next.cards.filter(card => card.archivedAt && !state.cards.find(old => old.id === card.id)?.archivedAt);
  else if (removed) result = removed;
  else if (target === 'thread') result = next.threads.find(t => t.id === (targetId ?? next.nextThreadId - 1));
  else result = next.cards.find(c => c.id === (targetId ?? next.nextCardId - 1));
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (target === 'archive') console.log(`已归档 ${result.length} 张卡片`);
  else if (removed) console.log(`已删除${target === 'thread' ? '线头' : '卡片'} #${removed.id}  ${removed.name ?? removed.title}`);
  else if (target === 'thread') console.log(`#${result.id}  ${result.name}  ${result.icon}`);
  else printCard(result, next, now);
}

main().catch(error => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
