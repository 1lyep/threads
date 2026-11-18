export const columns = ['tomorrow', 'raw', 'ready', 'doing', 'review', 'done'];
export const columnNames = ['明天', '原始需求', '整理后待执行', '执行中', '检查中', '完成'];

export function parseColumn(value) {
  const index = columns.indexOf(value);
  if (index !== -1) return columns[index];
  if (value === '待执行') return 'ready';
  const chineseIndex = columnNames.indexOf(value);
  if (chineseIndex !== -1) return columns[chineseIndex];
  throw new Error('列名无效');
}

export function localISO(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('时间无效');
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const offset = -date.getTimezoneOffset();
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function parseTime(value, now = new Date()) {
  if (typeof value !== 'string') throw new Error('时间格式无效');
  let parts;
  let year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
  let hour = 23, minute = 30;
  if ((parts = /^(\d{2}):(\d{2})$/.exec(value))) {
    [, hour, minute] = parts;
  } else if ((parts = /^(?:(\d{4})-)?(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value))) {
    year = parts[1] ?? year;
    [, , month, day, hour, minute] = parts;
  } else if ((parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value))) {
    [, year, month, day] = parts;
  } else if (isZonedISO(value)) {
    return localISO(value);
  } else {
    throw new Error('时间格式无效，请用 15:00、11-07 15:00、2026-11-07 15:00、2026-11-07 或带时区 ISO');
  }
  [year, month, day, hour, minute] = [year, month, day, hour, minute].map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error('日期或时间无效');
  }
  return localISO(date);
}

export function isZonedISO(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec = '0', zone] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= days && Number(h) < 24 && Number(min) < 60 && Number(sec) < 60 && (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) < 60)) && Number.isFinite(Date.parse(value));
}

export function parseEstimate(value) {
  const match = /^(\d+(?:\.\d+)?)(m|h)?$/.exec(value);
  const minutes = match ? Number(match[1]) * (match[2] === 'h' ? 60 : 1) : NaN;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('预计用时须为 1–1440 分钟的整数，可用 30m、1h、1.5h 或 90');
  }
  return minutes;
}
