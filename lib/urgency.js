export function urgencyLevel(card, now = new Date()) {
  if (card.column === 'done') return null;
  if (card.column === 'raw' || card.column === 'tomorrow') return 0;
  const deadline = card.due ? new Date(card.due) : new Date(now);
  if (!card.due) deadline.setHours(23, 30, 0, 0);
  const slack = (deadline - now) / 60000 - (card.estimateMin ?? 0);
  if (slack > 480) return 0;
  if (slack > 240) return 1;
  if (slack > 120) return 2;
  if (slack > 30) return 3;
  return 4;
}
