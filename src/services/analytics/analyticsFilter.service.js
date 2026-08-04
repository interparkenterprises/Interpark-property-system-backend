const TIMEZONE = 'Africa/Nairobi';
const NAIROBI_OFFSET = '+03:00';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GRAINS = new Set(['day', 'week', 'month']);

export class AnalyticsFilterError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'AnalyticsFilterError';
    this.statusCode = 400;
    this.field = field;
  }
}

const assertDate = (value, field) => {
  if (!DATE_PATTERN.test(value || '')) {
    throw new AnalyticsFilterError(`${field} must use YYYY-MM-DD format`, field);
  }

  const date = new Date(`${value}T00:00:00${NAIROBI_OFFSET}`);
  if (Number.isNaN(date.getTime())) {
    throw new AnalyticsFilterError(`${field} is not a valid date`, field);
  }

  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(date.getTime() + (3 * 60 * 60 * 1000));
  if (
    shifted.getUTCFullYear() !== year ||
    shifted.getUTCMonth() + 1 !== month ||
    shifted.getUTCDate() !== day
  ) {
    throw new AnalyticsFilterError(`${field} is not a valid calendar date`, field);
  }
  return date;
};

const addLocalDays = (value, days) => {
  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return [
    utc.getUTCFullYear(),
    String(utc.getUTCMonth() + 1).padStart(2, '0'),
    String(utc.getUTCDate()).padStart(2, '0')
  ].join('-');
};

const todayInNairobi = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const firstDayOfMonth = date => `${date.slice(0, 8)}01`;

const validateId = (value, field) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new AnalyticsFilterError(`${field} must be a valid UUID`, field);
  }
  return value;
};

export const normalizeAnalyticsFilters = (query = {}, now = new Date()) => {
  const today = todayInNairobi(now);
  const hasFrom = query.dateFrom !== undefined;
  const hasTo = query.dateTo !== undefined;

  if (hasFrom !== hasTo) {
    throw new AnalyticsFilterError('dateFrom and dateTo must be supplied together', hasFrom ? 'dateTo' : 'dateFrom');
  }

  const dateFrom = hasFrom ? query.dateFrom : firstDayOfMonth(today);
  const dateTo = hasTo ? query.dateTo : today;
  const start = assertDate(dateFrom, 'dateFrom');
  assertDate(dateTo, 'dateTo');
  const endExclusive = assertDate(addLocalDays(dateTo, 1), 'dateTo');

  if (start >= endExclusive) {
    throw new AnalyticsFilterError('dateFrom must be on or before dateTo', 'dateFrom');
  }

  const asOf = query.asOf || dateTo;
  assertDate(asOf, 'asOf');
  const asOfExclusive = assertDate(addLocalDays(asOf, 1), 'asOf');

  const grain = query.grain || 'month';
  if (!ALLOWED_GRAINS.has(grain)) {
    throw new AnalyticsFilterError('grain must be one of day, week, or month', 'grain');
  }

  return {
    dateFrom,
    dateTo,
    asOf,
    grain,
    propertyId: validateId(query.propertyId, 'propertyId'),
    landlordId: validateId(query.landlordId, 'landlordId'),
    start,
    endExclusive,
    asOfExclusive,
    timezone: TIMEZONE
  };
};

export const publicFilters = filters => ({
  dateFrom: filters.dateFrom,
  dateTo: filters.dateTo,
  asOf: filters.asOf,
  grain: filters.grain,
  ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
  ...(filters.landlordId ? { landlordId: filters.landlordId } : {})
});

export { TIMEZONE };
