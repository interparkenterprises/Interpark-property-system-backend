/**
 * Central freeze-resolution logic.
 *
 * A tenant is frozen on `date` iff at least one TenantFreezePeriod
 * satisfies: startDate <= date AND (endDate IS NULL OR endDate >= date).
 *
 * `isFrozen` on Tenant is a fast-filter denormalization, but the
 * freezePeriods array (or a DB query) is authoritative. Never trust
 * the boolean alone when the answer matters.
 */

/**
 * @param {object} tenant  Tenant row; should include freezePeriods[]
 *                         (or pass periods separately to the second arg).
 * @param {Date}   date    Date to test (defaults to now).
 * @returns {boolean}
 */
export const isTenantFrozenOn = (tenant, date = new Date()) => {
  if (!tenant) return false;

  const d = new Date(date);
  const periods = tenant.freezePeriods || [];
  if (periods.length === 0) {
    // Fast path: boolean alone is enough for a "definitely not frozen"
    return false;
  }

  return periods.some((p) => {
    const start = new Date(p.startDate);
    const end = p.endDate ? new Date(p.endDate) : null;
    if (d < start) return false;
    if (end && d > end) return false;
    return true;
  });
};

/**
 * Which freeze period (if any) contains this date?
 * @returns {object|null} the matching TenantFreezePeriod, or null.
 */
export const getFreezePeriodFor = (tenant, date = new Date()) => {
  if (!tenant?.freezePeriods?.length) return null;
  const d = new Date(date);
  return (
    tenant.freezePeriods.find((p) => {
      const start = new Date(p.startDate);
      const end = p.endDate ? new Date(p.endDate) : null;
      if (d < start) return false;
      if (end && d > end) return false;
      return true;
    }) || null
  );
};

/**
 * Is the tenant CURRENTLY frozen right now?
 */
export const isTenantFrozenNow = (tenant) => isTenantFrozenOn(tenant, new Date());

/**
 * List every month-start (UTC) inside a freeze period between
 * `from` (inclusive) and `to` (exclusive). Used by arrears reporting
 * to know which months were "paused" and therefore not billable.
 *
 * @param {object} freezePeriod  TenantFreezePeriod row
 * @param {Date}   from
 * @param {Date}   to
 * @returns {Date[]}
 */
export const frozenMonthStartsBetween = (freezePeriod, from, to) => {
  const out = [];
  if (!freezePeriod) return out;

  const start = new Date(freezePeriod.startDate);
  const end = freezePeriod.endDate ? new Date(freezePeriod.endDate) : new Date();

  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(to);
  const fromDate = new Date(from);

  while (cursor < stop) {
    const monthEnd = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      0, 23, 59, 59, 999
    ));
    // Overlaps freeze window AND within requested range
    const overlapsFreeze = cursor <= end && monthEnd >= start;
    const overlapsRange  = monthEnd >= fromDate && cursor < stop;
    if (overlapsFreeze && overlapsRange) out.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return out;
};