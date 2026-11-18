// 与本地服务器通信。

export async function getState() {
  const r = await fetch('/api/state', { cache: 'no-store' });
  if (!r.ok) throw new Error('读取数据失败');
  return r.json();
}

export async function op(op, args = {}) {
  let r;
  try {
    r = await fetch('/api/ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, args }),
    });
  } catch {
    throw new Error('连不上本地服务器');
  }
  let j;
  try { j = await r.json(); } catch { throw new Error('服务器返回了无法识别的内容'); }
  if (!j.ok) throw new Error(j.error || '操作失败');
  return j.state;
}

export function subscribe(onChange) {
  const es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    try { onChange(JSON.parse(e.data)); } catch { /* 忽略格式不对的事件 */ }
  });
  return es;
}
