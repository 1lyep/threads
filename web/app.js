import { urgencyLevel } from '/lib/urgency.js';
import * as api from './api.js';

// ---------- 常量 ----------
const COLS = [
  { key: 'tomorrow', name: '明天' },
  { key: 'raw', name: '原始需求' },
  { key: 'ready', name: '整理后待执行' },
  { key: 'doing', name: '执行中' },
  { key: 'review', name: '检查中' },
  { key: 'done', name: '完成' },
];
const COL_NAME = Object.fromEntries(COLS.map((c) => [c.key, c.name]));
const ICONS = [
  'circle', 'world', 'book', 'home', 'briefcase', 'code', 'pencil', 'palette',
  'chart-bar', 'heart', 'shopping-cart', 'school', 'music', 'camera', 'plane', 'car',
  'coffee', 'device-laptop', 'users', 'flask', 'tools', 'rocket', 'leaf', 'star',
];
const AUTHOR = { me: '我', claude: 'Claude', codex: 'Codex' };
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

// ---------- 状态 ----------
let S = null;            // 服务器状态
let view = 'board';
let drag = null;         // 正在拖动
let busy = 0;            // 正在播放的完成动画数
let pending = false;     // 动画/拖动期间推迟的重绘
let panelId = null;      // 打开的详情面板对应的卡片
let iconPick = null;     // 线头页正在选图标的线头
const animDone = new Map(); // 卡片 id → { level, fromRect, started }

// ---------- 小工具 ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}
const icon = (name, cls = '') => h('i', { class: `ti ti-${name} ${cls}`.trim(), 'aria-hidden': 'true' });

function checkSvg(cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `ck ${cls}`);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  p.setAttribute('pathLength', '1');
  p.style.strokeDasharray = '1';
  s.append(p);
  return s;
}

const estClass = (m) => (m <= 30 ? 0 : m <= 60 ? 1 : m <= 120 ? 2 : 3);
function fmtEst(m) {
  if (m < 60) return `${m}m`;
  const hrs = Math.round((m / 60) * 10) / 10;
  return `${hrs}h`;
}
function parseEst(s) {
  s = s.trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|分|分钟|h|小时)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  const min = Math.round(unit === 'h' || unit === '小时' ? n * 60 : n);
  return min >= 1 && min <= 1440 ? min : undefined;
}
const pad = (n) => String(n).padStart(2, '0');
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function toInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDay = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function autoGrow(t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), err ? 3600 : 2000);
}

// ---------- 数据读取 ----------
const cardById = (id) => S.cards.find((c) => c.id === id);
const threadById = (id) => S.threads.find((t) => t.id === id);
const threadsSorted = () => [...S.threads].sort((a, b) => a.order - b.order);
const activeCards = () => S.cards.filter((c) => !c.archivedAt);
const boardCard = (id) => $(`#board .k[data-id="${id}"]`);

function groupSiblings(column, threadId, exceptId) {
  return activeCards()
    .filter((c) => c.column === column && c.threadId === threadId && c.id !== exceptId)
    .sort((a, b) => a.order - b.order);
}
function orderAt(sibs, index) {
  if (!sibs.length) return 1000;
  if (index >= sibs.length) return sibs[sibs.length - 1].order + 1000;
  if (index <= 0) return sibs[0].order - 1000;
  return (sibs[index - 1].order + sibs[index].order) / 2;
}

// ---------- 与服务器同步 ----------
async function send(op, args) {
  try {
    const ns = await api.op(op, args);
    if (!S || ns.rev >= S.rev) { S = ns; render(); }
    return ns;
  } catch (e) {
    toast(e.message, true);
    await reload();
    return null;
  }
}

async function reload() {
  try { applyRemote(await api.getState(), true); } catch (e) { toast(e.message, true); }
}

function applyRemote(ns, force = false) {
  if (S && !force && ns.rev <= S.rev) return;
  const old = S;
  S = ns;
  if (old) {
    const prev = new Map(old.cards.map((c) => [c.id, c]));
    const now = new Date();
    for (const c of ns.cards) {
      const p = prev.get(c.id);
      if (p && p.column !== 'done' && c.column === 'done' && !c.archivedAt && !animDone.has(c.id)) {
        const el = boardCard(c.id);
        animDone.set(c.id, { level: urgencyLevel(p, now) ?? 0, fromRect: el ? el.getBoundingClientRect() : null });
      }
    }
  }
  render();
}

// ---------- 渲染 ----------
function render() {
  renderQuickAdd();
  renderCount();
  if (view === 'board') renderBoard();
  else renderThreads();
  if (panelId != null) refreshPanel();
}

function renderCount() {
  if (!S) return;
  const now = new Date();
  const n = S.cards.filter((c) => c.doneAt && c.column === 'done' && sameDay(new Date(c.doneAt), now) && !animDone.has(c.id)).length;
  $('#cnt').textContent = n;
}
function bumpCount() {
  renderCount();
  $('#cnt').animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.3,1.6,.5,1)' });
}

function renderQuickAdd() {
  const sel = $('#qa-thread');
  const ts = threadsSorted();
  const keep = sel.value || localStorage.getItem('qa-thread') || '';
  sel.replaceChildren(...ts.map((t) => h('option', { value: t.id }, t.name)));
  if (ts.some((t) => String(t.id) === keep)) sel.value = keep;
  $('#qa-title').placeholder = ts.length ? '记一件事，回车加入原始需求' : '先到「线头」页建一个线头';
}

// 看板
const colEls = {};
function buildBoard() {
  const b = $('#board');
  for (const c of COLS) {
    const el = h('section', { class: 'col', dataset: { col: c.key } },
      h('header', { class: 'ch' },
        h('span', { class: 'cn' }, c.name),
        h('span', { class: 'cc' }),
        c.key === 'done' ? h('button', { type: 'button', class: 'arc', onclick: archiveAll }, '归档') : null),
      h('div', { class: 'cb' }));
    colEls[c.key] = el;
    b.append(el);
  }
}

function rects() {
  const m = new Map();
  for (const k of $$('#board .k')) m.set(+k.dataset.id, k.getBoundingClientRect());
  return m;
}
function flip(before, duration = 300) {
  for (const k of $$('#board .k')) {
    const id = +k.dataset.id;
    if (animDone.has(id) && !animDone.get(id).started) continue;
    const o = before.get(id);
    if (!o) continue;
    const n = k.getBoundingClientRect();
    const dx = o.left - n.left; const dy = o.top - n.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    k.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration, easing: EASE_OUT });
  }
}

function groupEl(t, kids) {
  return h('div', { class: 'gp', dataset: { thread: t.id } },
    h('div', { class: 'gh' }, icon(t.icon || 'circle'), h('span', null, t.name)),
    kids);
}

function cardEl(c, now) {
  const a = animDone.get(c.id);
  const isDone = c.column === 'done' && !a;
  const lvl = a ? a.level : (urgencyLevel(c, now) ?? 0);
  const el = h('div', { class: `k ${isDone ? 'dn' : `L${lvl}`}`, dataset: { id: c.id } },
    h('div', { class: 'kt' }, c.title),
    !isDone && c.estimateMin ? h('div', { class: 'ew' }, h('span', { class: `est e${estClass(c.estimateMin)}` }, fmtEst(c.estimateMin))) : null,
    isDone ? checkSvg('sm') : null);
  if (panelId === c.id) el.style.visibility = 'hidden';
  el.addEventListener('pointerdown', onPointerDown);
  return el;
}

function renderBoard() {
  if (!S) return;
  if (busy || drag) { pending = true; return; }
  pending = false;
  const before = rects();
  const now = new Date();
  const cards = activeCards();
  const ts = threadsSorted();
  for (const c of COLS) {
    const col = colEls[c.key];
    const body = $('.cb', col);
    const mine = cards.filter((x) => x.column === c.key);
    $('.cc', col).textContent = mine.length || '';
    const kids = [];
    for (const t of ts) {
      const g = mine.filter((x) => x.threadId === t.id).sort((a, b) => a.order - b.order);
      if (g.length) kids.push(groupEl(t, g.map((x) => cardEl(x, now))));
    }
    if (!kids.length && c.key === 'raw' && !S.cards.length) {
      kids.push(h('div', { class: 'blank', style: 'margin:24px 8px' }, S.threads.length ? '在上方输入框记下第一件事' : '先到「线头」页建一个线头'));
    }
    const top = body.scrollTop;
    body.replaceChildren(...kids);
    body.scrollTop = top;
    if (c.key === 'tomorrow') { col.classList.toggle('shut', !mine.length); col.classList.remove('hint'); }
  }
  flip(before);
  runDoneAnims();
}

// ---------- 完成动画 ----------
function runDoneAnims() {
  for (const [id, a] of animDone) {
    if (a.started) continue;
    const el = boardCard(id);
    if (!el) { animDone.delete(id); continue; }
    a.started = true;
    busy++;
    playDone(el, a)
      .catch(() => {})
      .finally(() => {
        animDone.delete(id);
        busy--;
        bumpCount();
        if (!busy && pending) renderBoard();
      });
  }
}

async function playDone(k, a) {
  // 1 滑入
  if (a.fromRect) {
    const r = k.getBoundingClientRect();
    const dx = a.fromRect.left - r.left; const dy = a.fromRect.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      await k.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 340, easing: EASE_OUT }).finished;
    }
  }
  const w = k.offsetWidth; const h0 = k.offsetHeight;
  const ew = $('.ew', k); const tt = $('.kt', k);
  // 2 打勾
  const ck = checkSvg('big');
  ck.style.left = `${w / 2 - 15}px`;
  ck.style.top = `${h0 / 2 - 15}px`;
  k.append(ck);
  tt.style.transition = 'opacity .25s, color .35s, padding-right .3s';
  tt.style.opacity = '.3';
  k.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.045)' }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  await ck.firstChild.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 300, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).finished;
  // 3 铺绿
  const fill = h('div', { class: 'fill' });
  k.prepend(fill);
  fill.animate([{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(80% at 50% 50%)' }], { duration: 440, easing: 'cubic-bezier(.3,0,.15,1)', fill: 'forwards' });
  k.style.transition = 'border-color .35s';
  k.style.borderColor = 'var(--done-border)';
  await sleep(120);
  tt.style.opacity = '1';
  tt.style.color = 'var(--done-text)';
  tt.style.paddingRight = '16px';
  if (ew) {
    const eh = ew.offsetHeight;
    ew.animate([{ height: `${eh}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  }
  // 4 归位
  await ck.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${w / 2 - 13}px,${13 - h0 / 2}px) scale(.47)` }], { duration: 360, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished;
  k.className = 'k dn';
  k.removeAttribute('style');
  tt.removeAttribute('style');
  if (ew) ew.remove();
  fill.remove();
  ck.remove();
  k.append(checkSvg('sm'));
}

// ---------- 拖动 ----------
function onPointerDown(e) {
  if (e.button !== 0 || drag) return;
  const el = e.currentTarget;
  const id = +el.dataset.id;
  if (animDone.has(id)) return;
  const sx = e.clientX; const sy = e.clientY;
  let started = false;
  const move = (ev) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      startDrag(el, id, ev);
    }
    dragMove(ev);
  };
  const end = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('keydown', esc);
    if (started) endDrag(ev.type === 'pointercancel');
    else if (ev.type === 'pointerup') openPanel(id);
  };
  const esc = (ev) => { if (ev.key === 'Escape' && started) end({ type: 'pointercancel' }); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('keydown', esc);
}

function startDrag(el, id, ev) {
  const card = cardById(id);
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('ghost');
  Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
  document.body.append(ghost);
  ghost.animate([{ transform: 'none' }, { transform: 'scale(1.04) rotate(1.5deg)' }], { duration: 160, easing: EASE_OUT, fill: 'forwards' });
  el.classList.add('ph');
  const grp = el.parentElement;
  drag = {
    id, card, el, ghost,
    offX: ev.clientX - r.left, offY: ev.clientY - r.top,
    col: card.column, origCol: card.column,
    origIndex: $$('.k', grp).indexOf(el),
  };
  document.body.classList.add('dragging');
  const t = colEls.tomorrow;
  if (t.classList.contains('shut')) t.classList.add('hint');
}

function dragMove(ev) {
  const g = drag.ghost;
  g.style.left = `${ev.clientX - drag.offX}px`;
  g.style.top = `${ev.clientY - drag.offY}px`;
  let key = null;
  for (const c of COLS) {
    const r = colEls[c.key].getBoundingClientRect();
    if (ev.clientX >= r.left - 4 && ev.clientX <= r.right + 4) { key = c.key; break; }
  }
  if (key) placeAt(key, ev.clientY);
}

function placeAt(key, y) {
  const body = $('.cb', colEls[key]);
  const tid = drag.card.threadId;
  let grp = $(`.gp[data-thread="${tid}"]`, body);
  const before = rects();
  if (!grp) {
    const t = threadById(tid);
    grp = groupEl(t, []);
    const next = $$('.gp', body).find((x) => (threadById(+x.dataset.thread)?.order ?? 0) > t.order);
    body.insertBefore(grp, next || null);
    $('.blank', body)?.remove();
  }
  const ks = $$('.k', grp).filter((k) => k !== drag.el);
  let ref = null;
  for (const k of ks) {
    const r = k.getBoundingClientRect();
    if (y < r.top + r.height / 2) { ref = k; break; }
  }
  const same = drag.el.parentElement === grp && (ref ? drag.el.nextElementSibling === ref : !drag.el.nextElementSibling);
  if (same) return;
  grp.insertBefore(drag.el, ref);
  for (const gp of $$('#board .gp')) if (!$('.k', gp)) gp.remove();
  const t = colEls.tomorrow;
  const has = !!$('.k', t);
  t.classList.toggle('shut', !has);
  t.classList.toggle('hint', !has);
  drag.col = key;
  flip(before, 160);
}

async function endDrag(cancel) {
  const d = drag;
  if (cancel) {
    d.ghost.remove();
    document.body.classList.remove('dragging');
    drag = null;
    renderBoard();
    return;
  }
  const r = d.el.getBoundingClientRect();
  await d.ghost.animate(
    [{ left: d.ghost.style.left, top: d.ghost.style.top }, { left: `${r.left}px`, top: `${r.top}px` }],
    { duration: 180, easing: EASE_OUT, fill: 'forwards' },
  ).finished;
  d.ghost.remove();
  d.el.classList.remove('ph');
  document.body.classList.remove('dragging');
  drag = null;
  const column = d.col;
  const index = $$('.k', d.el.parentElement).indexOf(d.el);
  if (column === d.origCol && index === d.origIndex) { renderBoard(); return; }
  const c = cardById(d.id);
  const prevLevel = urgencyLevel(c, new Date()) ?? 0;
  localMove(c, column, index);
  if (column === 'done' && d.origCol !== 'done') animDone.set(c.id, { level: prevLevel, fromRect: null });
  renderBoard();
  renderCount();
  send('card.move', { id: c.id, column, index });
}

// 本地先改，服务器结果回来后以服务器为准
function localMove(c, column, index) {
  const sibs = groupSiblings(column, c.threadId, c.id);
  c.order = orderAt(sibs, index ?? sibs.length);
  if (column === 'tomorrow') c.due = null;
  if (column === 'done' && c.column !== 'done') c.doneAt = isoLocal(new Date());
  if (column !== 'done') c.doneAt = null;
  c.column = column;
}

async function archiveAll() {
  const done = activeCards().filter((c) => c.column === 'done');
  if (!done.length) { toast('完成列是空的'); return; }
  const els = $$('.k', colEls.done);
  busy++;
  await Promise.all(els.map((k, i) => k.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(.96)' }],
    { duration: 260, delay: i * 30, easing: 'ease-in', fill: 'forwards' },
  ).finished));
  busy--;
  const ns = await send('archive.run', {});
  if (ns) toast(`已归档 ${done.length} 件，在「线头」页可以看到`);
  else renderBoard();
}

// ---------- 详情面板 ----------
function openPanel(id) {
  const c = cardById(id);
  if (!c) return;
  panelId = id;
  const P = $('#panel');
  P.replaceChildren(panelContent(c));
  $('#layer').hidden = false;
  $$('textarea.ed', P).forEach(autoGrow);
  const el = boardCard(id) || $(`.arch-it[data-id="${id}"]`);
  const pr = P.getBoundingClientRect();
  const panelBg = getComputedStyle(P).backgroundColor;
  if (el) {
    const cr = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    if (el.classList.contains('k')) el.style.visibility = 'hidden';
    P.animate([
      { transform: `translate(${cr.left - pr.left}px,${cr.top - pr.top}px) scale(${cr.width / pr.width},${cr.height / pr.height})`, borderRadius: '40px', backgroundColor: bg },
      { transform: 'none', borderRadius: '14px', backgroundColor: panelBg },
    ], { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1)' });
  }
  $('.pc', P).animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
  $('#dim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });
}

async function closePanel() {
  if (panelId == null) return;
  const P = $('#panel');
  if (P.contains(document.activeElement)) document.activeElement.blur();
  const id = panelId;
  const el = boardCard(id);
  const pr = P.getBoundingClientRect();
  $('.pc', P)?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
  $('#dim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' });
  if (el) {
    el.style.visibility = '';
    const cr = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    el.style.visibility = 'hidden';
    await P.animate([
      { transform: 'none', borderRadius: '14px' },
      { transform: `translate(${cr.left - pr.left}px,${cr.top - pr.top}px) scale(${cr.width / pr.width},${cr.height / pr.height})`, borderRadius: '40px', backgroundColor: bg },
    ], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)' }).finished;
    el.style.visibility = '';
  } else {
    await P.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, easing: 'ease-in' }).finished;
  }
  $('#layer').hidden = true;
  panelId = null;
  P.replaceChildren();
  boardCard(id)?.style.removeProperty('visibility');
}

function refreshPanel() {
  const P = $('#panel');
  const c = cardById(panelId);
  if (!c) { closePanel(); return; }
  if (P.contains(document.activeElement) && document.activeElement !== document.body) return;
  const pc = $('.pc', P);
  const top = pc ? pc.scrollTop : 0;
  P.replaceChildren(panelContent(c));
  $$('textarea.ed', P).forEach(autoGrow);
  $('.pc', P).scrollTop = top;
}

function panelContent(c) {
  const isTomorrow = c.column === 'tomorrow';
  const save = (field, value) => {
    if (JSON.stringify(c[field] ?? null) === JSON.stringify(value ?? null)) return;
    c[field] = value;
    send('card.update', { id: c.id, [field]: value });
  };
  const ta = (cls, field, ph, required) => {
    const t = h('textarea', { class: `ed ${cls}`, rows: 1, placeholder: ph, value: c[field] || '' });
    t.addEventListener('input', () => autoGrow(t));
    t.addEventListener('blur', () => {
      const v = cls === 'title' ? t.value.replace(/\s*\n\s*/g, ' ').trim() : t.value.trim();
      if (required && !v) { t.value = c[field]; autoGrow(t); toast('标题不能为空', true); return; }
      save(field, v);
    });
    if (cls === 'title') t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } });
    return t;
  };

  const threadSel = h('select', { 'aria-label': '线头' }, threadsSorted().map((t) => h('option', { value: t.id }, t.name)));
  threadSel.value = c.threadId;
  threadSel.addEventListener('change', () => save('threadId', +threadSel.value));

  const due = h('input', { type: 'datetime-local', value: toInputValue(c.due) });
  due.addEventListener('change', () => save('due', due.value ? isoLocal(new Date(due.value)) : null));
  const est = h('input', { class: 'est-in', placeholder: '如 30m', value: c.estimateMin ? fmtEst(c.estimateMin) : '' });
  est.addEventListener('blur', () => {
    const v = parseEst(est.value);
    if (v === undefined) { toast('预计用时写成 30m、1.5h 或分钟数（1–1440 分钟）', true); est.value = c.estimateMin ? fmtEst(c.estimateMin) : ''; return; }
    save('estimateMin', v);
    est.value = v ? fmtEst(v) : '';
  });
  est.addEventListener('keydown', (e) => { if (e.key === 'Enter') est.blur(); });

  const logs = h('div', { class: 'logs' },
    c.progress.length ? c.progress.map((p) => logRow(c, p)) : h('div', { class: 'empty-log' }, '还没有记录'));
  const logIn = h('input', { placeholder: '记一条进度，回车保存', maxlength: 5000 });
  logIn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const v = logIn.value.trim();
    if (!v) return;
    logIn.value = '';
    const ns = await send('progress.add', { cardId: c.id, text: v, author: 'me' });
    if (ns) {
      const nc = ns.cards.find((x) => x.id === c.id);
      const P = $('#panel');
      const box = $('.logs', P);
      box.replaceChildren(...nc.progress.map((p) => logRow(nc, p)));
      box.lastElementChild?.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
      logIn.focus();
    }
  });

  let armed = false;
  const del = h('button', { type: 'button', class: 'btn danger' }, icon('trash'), '删除');
  del.addEventListener('click', async () => {
    if (!armed) { armed = true; del.classList.add('armed'); del.lastChild.textContent = '再点一次删除'; setTimeout(() => { armed = false; del.classList.remove('armed'); del.lastChild.textContent = '删除'; }, 3000); return; }
    const id = c.id;
    $('#layer').hidden = true; panelId = null;
    await send('card.delete', { id });
    toast('已删除');
  });

  const goDone = c.column !== 'done' && !c.archivedAt
    ? h('button', { type: 'button', class: 'btn go', onclick: () => finishFromPanel(c.id) }, icon('check'), '完成')
    : null;

  return h('div', { class: 'pc' },
    h('button', { type: 'button', class: 'p-x', 'aria-label': '关闭', onclick: closePanel }, icon('x')),
    h('div', { class: 'p-top' }, threadSel, h('span', null, '·'), h('span', null, c.archivedAt ? `已归档 · ${fmtDay(c.archivedAt)}` : COL_NAME[c.column])),
    h('div', null, ta('title', 'title', '要做的事', true), ta('desc', 'description', '补充描述…')),
    h('div', { class: 'when' }, h('div', { class: 'lbl' }, icon('flag'), '结束条件'), ta('', 'doneWhen', '怎样算做完')),
    h('div', { class: 'meta' },
      h('label', null, '截止', due,
        c.due ? h('button', { type: 'button', class: 'clr', 'aria-label': '清除截止时间', onclick: () => { due.value = ''; save('due', null); refreshPanel(); } }, icon('x')) : null),
      !c.due ? h('span', { class: 'hint' }, isTomorrow ? '在明天列，安排时再填' : '不填按今天 23:30') : null,
      h('label', null, '预计', est)),
    h('div', null, h('div', { class: 'lbl' }, icon('timeline'), '进度'), logs, h('div', { class: 'log-add' }, logIn)),
    h('div', { class: 'p-foot' }, del, goDone));
}

function logRow(c, p) {
  const tx = h('div', { class: 'tx' }, p.text);
  const row = h('div', { class: 'lg' },
    h('span', { class: 'tm' }, fmtTime(p.at)),
    h('div', { class: 'lb' }, h('span', { class: `who ${p.author === 'me' ? 'me' : ''}` }, AUTHOR[p.author] || p.author), tx),
    h('button', { type: 'button', class: 'del', 'aria-label': '删除这条记录', onclick: () => send('progress.delete', { cardId: c.id, progressId: p.id }) }, icon('x')));
  tx.addEventListener('click', () => {
    const t = h('textarea', { rows: 1, value: p.text });
    tx.replaceWith(t);
    autoGrow(t);
    t.focus();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const v = t.value.trim();
      t.replaceWith(tx);
      if (ok && v && v !== p.text) { tx.textContent = v; p.text = v; send('progress.update', { cardId: c.id, progressId: p.id, text: v }); }
    };
    t.addEventListener('input', () => autoGrow(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    });
    t.addEventListener('blur', () => finish(true));
  });
  return row;
}

async function finishFromPanel(id) {
  await closePanel();
  const c = cardById(id);
  if (!c || c.column === 'done') return;
  const el = boardCard(id);
  const level = urgencyLevel(c, new Date()) ?? 0;
  animDone.set(id, { level, fromRect: el ? el.getBoundingClientRect() : null });
  localMove(c, 'done');
  renderBoard();
  send('card.move', { id, column: 'done' });
}

// ---------- 线头页 ----------
function renderThreads() {
  const root = $('#threads');
  const ts = threadsSorted();
  const addIn = h('input', { placeholder: '新线头名字，回车创建', maxlength: 20 });
  addIn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const name = addIn.value.trim();
    if (!name) return;
    const ns = await send('thread.add', { name, icon: ICONS[(S.threads.length + 1) % ICONS.length] });
    if (ns) { toast(`已创建「${name}」`); $('#threads .th-add input')?.focus(); }
  });

  const cards = S.cards;
  const grid = h('div', { class: 'th-grid' }, ts.map((t, i) => {
    const mine = cards.filter((c) => c.threadId === t.id);
    const active = mine.filter((c) => !c.archivedAt && c.column !== 'done').length;
    const archived = mine.filter((c) => c.archivedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
    const name = h('input', { class: 'th-name', value: t.name, maxlength: 20, 'aria-label': '线头名字' });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    name.addEventListener('blur', () => {
      const v = name.value.trim();
      if (!v) { name.value = t.name; return; }
      if (v !== t.name) send('thread.update', { id: t.id, name: v });
    });
    const days = [];
    let lastDay = '';
    for (const c of archived) {
      const d = fmtDay(c.doneAt || c.archivedAt);
      if (d !== lastDay) { days.push(h('div', { class: 'arch-day' }, d)); lastDay = d; }
      days.push(h('div', { class: 'arch-it', dataset: { id: c.id }, onclick: () => openPanel(c.id) }, icon('circle-check'), h('span', null, c.title)));
    }
    return h('section', { class: 'th' },
      h('div', { class: 'th-h' },
        h('button', { type: 'button', class: 'th-ic', 'aria-label': '换图标', onclick: () => { iconPick = iconPick === t.id ? null : t.id; renderThreads(); } }, icon(t.icon || 'circle')),
        name,
        h('div', { class: 'th-tools' },
          i > 0 ? h('button', { type: 'button', 'aria-label': '上移', onclick: () => send('thread.move', { id: t.id, index: i - 1 }) }, icon('arrow-up')) : null,
          i < ts.length - 1 ? h('button', { type: 'button', 'aria-label': '下移', onclick: () => send('thread.move', { id: t.id, index: i + 1 }) }, icon('arrow-down')) : null,
          h('button', { type: 'button', 'aria-label': '删除线头', onclick: () => {
            if (mine.length) { toast(`「${t.name}」还有 ${mine.length} 张卡片（含已归档），不能删除`, true); return; }
            send('thread.delete', { id: t.id });
          } }, icon('trash')))),
      iconPick === t.id ? h('div', { class: 'icons' }, ICONS.map((n) => h('button', {
        type: 'button', class: n === t.icon ? 'on' : '', 'aria-label': n,
        onclick: () => { iconPick = null; send('thread.update', { id: t.id, icon: n }); },
      }, icon(n)))) : null,
      h('div', { class: 'th-stat' }, `进行中 ${active} 件 · 已归档 ${archived.length} 件`),
      archived.length ? h('div', { class: 'arch' }, days) : h('div', { class: 'arch-none' }, '归档后的事情会出现在这里'));
  }));

  root.replaceChildren(h('div', { class: 'th-wrap' },
    h('div', { class: 'th-add' }, addIn),
    ts.length ? grid : h('div', { class: 'blank', style: 'margin-top:60px' }, h('b', null, '建第一个线头'), h('br'), '一个项目或一类事情就是一个线头')));
}

// ---------- 视图切换、快速添加 ----------
function setView(v) {
  view = v;
  for (const b of $$('.tabs button')) b.classList.toggle('on', b.dataset.view === v);
  $('#board').hidden = v !== 'board';
  $('#threads').hidden = v !== 'threads';
  render();
}

async function quickAdd(e) {
  e.preventDefault();
  const input = $('#qa-title');
  const title = input.value.trim();
  if (!title) return;
  const tid = +$('#qa-thread').value;
  if (!tid) { toast('先到「线头」页建一个线头', true); return; }
  localStorage.setItem('qa-thread', String(tid));
  input.value = '';
  const ns = await send('card.add', { title, threadId: tid, column: 'raw' });
  if (ns) {
    const id = Math.max(...ns.cards.map((c) => c.id));
    boardCard(id)?.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
  }
}

// ---------- 启动 ----------
async function init() {
  buildBoard();
  for (const b of $$('.tabs button')) b.addEventListener('click', () => setView(b.dataset.view));
  $('#qa').addEventListener('submit', quickAdd);
  $('#qa-thread').addEventListener('change', (e) => localStorage.setItem('qa-thread', e.target.value));
  $('#dim').addEventListener('click', closePanel);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelId != null && !drag) closePanel(); });
  try {
    S = await api.getState();
  } catch {
    $('#board').replaceChildren(h('div', { class: 'blank' }, h('b', null, '连不上本地服务器'), h('br'), '重新启动线头后刷新'));
    return;
  }
  render();
  api.subscribe(({ rev }) => { if (!S || rev > S.rev) reload(); });
  setInterval(() => { if (view === 'board') renderBoard(); }, 60_000);
}

init();
