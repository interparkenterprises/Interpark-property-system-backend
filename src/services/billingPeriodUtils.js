export const APP_TIMEZONE = 'Africa/Nairobi';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_ABBREVIATIONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

export function toDateKey(date) {
  if (date === null || date === undefined) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return DATE_KEY_FORMATTER.format(d);
}

export function todayKeyInAppTimezone(now = new Date()) {
  return toDateKey(now);
}

export function hasPeriodStarted(periodStartKey, referenceKey) {
  if (!periodStartKey || !referenceKey) return false;
  return referenceKey >= periodStartKey;   // ISO date keys sort lexicographically
}

export function addMonthsToKey(key, months) {
  const [y, m, d] = key.split('-').map(Number);
  const targetMonthIndex = (m - 1) + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return `${String(targetYear).padStart(4,'0')}-${String(normalizedMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function resolvePeriodWindow(periodStart, policyMonths) {
  const startKey = toDateKey(periodStart);
  if (!startKey) throw new Error(`resolvePeriodWindow: unparseable periodStart <${periodStart}>`);
  if (!Number.isInteger(policyMonths) || policyMonths < 1) throw new Error(`resolvePeriodWindow: invalid policyMonths <${policyMonths}>`);

  const endKeyExclusive = addMonthsToKey(startKey, policyMonths);
  const [ey, em, ed] = endKeyExclusive.split('-').map(Number);
  const inclusiveDate = new Date(Date.UTC(ey, em - 1, ed - 1));
  const endKeyInclusive = [
    String(inclusiveDate.getUTCFullYear()).padStart(4,'0'),
    String(inclusiveDate.getUTCMonth()+1).padStart(2,'0'),
    String(inclusiveDate.getUTCDate()).padStart(2,'0')
  ].join('-');

  return { startKey, endKeyExclusive, endKeyInclusive };
}

export function monthYearLabelFromKey(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Mirrors formatPaymentPeriodLabel() in paymentReport.controller.js */
export function buildPeriodLabel(startKey, endInclusiveKey, paymentPolicy) {
  const startLabel = monthYearLabelFromKey(startKey);
  if (paymentPolicy === 'MONTHLY') return startLabel;
  return `${startLabel} - ${monthYearLabelFromKey(endInclusiveKey)}`;
}

/** Mirrors buildPaymentPeriodLabel() in invoice.controller.js */
export function buildInvoiceStylePeriodLabel(startKey, endInclusiveKey, paymentPolicy) {
  if (paymentPolicy === 'MONTHLY') return monthYearLabelFromKey(startKey);
  const shortDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return `${MONTH_ABBREVIATIONS[m - 1]} ${d}, ${y}`;
  };
  return `${shortDate(startKey)} - ${shortDate(endInclusiveKey)}`;
}

export function periodLabelCandidates(startKey, endInclusiveKey, paymentPolicy, recordedLabel = null) {
  const labels = new Set();
  if (recordedLabel) labels.add(recordedLabel);
  labels.add(buildPeriodLabel(startKey, endInclusiveKey, paymentPolicy));
  labels.add(buildInvoiceStylePeriodLabel(startKey, endInclusiveKey, paymentPolicy));
  return Array.from(labels);
}

export function dateKeyToUtcNoon(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

export default {
  APP_TIMEZONE, toDateKey, todayKeyInAppTimezone, hasPeriodStarted, addMonthsToKey,
  resolvePeriodWindow, monthYearLabelFromKey, buildPeriodLabel,
  buildInvoiceStylePeriodLabel, periodLabelCandidates, dateKeyToUtcNoon
};
