// Renewal-first business rules shared by the real and demo adapters.
// A payment is collected in advance, then a membership's next renewal advances.
// All date comparisons use YYYY-MM-DD (calendar dates, not UTC timestamps).
export function todayKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
export function addCalendarMonths(dateKey, months) {
  const start = parseDay(dateKey);
  if (!start || !Number.isInteger(months) || months < 1 || months > 36) throw new Error('Use a valid renewal date and plan duration.');
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
export function planMonths(duration) {
  const match = /^([1-9]|[12][0-9]|3[0-6]) months?$/i.exec(String(duration ?? '').trim());
  if (!match) throw new Error('Select a supported 1–36 month membership plan.');
  return Number(match[1]);
}
export function nextRenewalDate({ currentRenewalDate, paidOn, duration }) {
  if (!parseDay(paidOn)) throw new Error('Choose a valid payment date.');
  if (currentRenewalDate && !parseDay(currentRenewalDate)) throw new Error('The member has an invalid renewal date.');
  // Pay early: add time to existing expiry, not payment day. Renew late: start today.
  const start = currentRenewalDate && currentRenewalDate > paidOn ? currentRenewalDate : paidOn;
  return { start, next: addCalendarMonths(start, planMonths(duration)) };
}
export function daysBetween(a, b) {
  const from = parseDay(a), to = parseDay(b);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}
export function renewalStatus(member, today = todayKey()) {
  if (member?.status_c === 'Inactive') return 'inactive';
  if (!parseDay(member?.due_date_c)) return 'not-set';
  const remaining = daysBetween(today, member.due_date_c);
  if (remaining < 0) return 'expired';
  if (remaining === 0) return 'today';
  if (remaining <= 7) return 'soon';
  return 'active';
}
export function renewalStats(members, today = todayKey()) {
  const statuses = members.map(m => renewalStatus(m, today));
  return {
    active: statuses.filter(s => s === 'active' || s === 'soon' || s === 'today').length,
    soon: statuses.filter(s => s === 'soon' || s === 'today').length,
    today: statuses.filter(s => s === 'today').length,
    expired: statuses.filter(s => s === 'expired').length,
    noDate: statuses.filter(s => s === 'not-set').length,
  };
}
export function reminderUrl(member, plan, today = todayKey()) {
  const raw = String(member?.phone_c ?? '').replace(/\D/g, '');
  const phone = raw.length === 10 ? '91' + raw : raw;
  if (phone.length < 10 || phone.length > 15) return null;
  const renewalDate = parseDay(member?.due_date_c) ? member.due_date_c : null;
  if (!renewalDate) return null;
  const state = renewalStatus(member, today);
  const due = Number(plan?.price_c ?? 0);
  const fee = due > 0 ? ' The renewal fee is ₹' + due.toLocaleString('en-IN') + '.' : '';
  const sentence = state === 'expired' ? 'Your gym membership expired on ' : 'Your gym membership renews on ';
  const message = 'Hi ' + String(member.Name ?? 'there').trim() + '! 💪 This is a friendly reminder from your gym. ' +
    sentence + renewalDate + '.' + fee + ' Please contact us to renew. Thank you!';
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
}
