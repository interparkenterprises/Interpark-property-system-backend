import { 
  calculateEscalatedRent, 
  calculatePaymentByPolicy, 
  calculateServiceCharge, 
  calculateVAT,
  calculateWithholdingTax,
  calculateWithholdingVat,
  getPolicyMonths,
  calculateTotalPaymentWithWithholding
} from './rentCalculation.js';

import { isTenantFrozenOn } from './tenantFreeze.js';

// =============================================
// WITHHOLDING TAX HELPER FUNCTIONS
// =============================================

/**
 * Calculate the total due per period including withholding tax deductions
 * This is the amount the tenant actually needs to pay
 * @param {Object} tenant - Tenant object
 * @param {number} monthlyRent - Current monthly rent
 * @param {string} paymentPolicy - Payment policy
 * @returns {Object} - Total due details with withholding tax
 */
export const calculateTotalDuePerPeriodWithWithholding = (tenant, monthlyRent, paymentPolicy) => {
  // Use the rentCalculation function that handles withholding tax
  const paymentWithWithholding = calculateTotalPaymentWithWithholding(tenant, monthlyRent, paymentPolicy);
  
  // The net payable is what the tenant actually needs to pay
  const netPayable = paymentWithWithholding.withholdingTax.netPayable;
  
  // Get the base amounts for reference
  const totalDueWithoutWithholding = paymentWithWithholding.total.paymentByPolicy;
  
  return {
    totalDueWithWithholding: netPayable,
    totalDueWithoutWithholding: totalDueWithoutWithholding,
    totalWithheld: paymentWithWithholding.withholdingTax.totalWithheld,
    withholdingBreakdown: paymentWithWithholding.withholdingTax,
    fullBreakdown: paymentWithWithholding
  };
};

/**
 * Set a date to the end of day (11:59:59.999 PM)
 */
const setToEndOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(23, 59, 59, 999);
  return newDate;
};

/**
 * Set a date to the start of day (12:00:00.000 AM)
 */
const setToStartOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

// =============================================
// UTC-normalized month start
// Returns midnight UTC on the 1st of the UTC calendar month that
// contains the input instant. This keeps period keys consistent
// across the whole scheduling pipeline, regardless of server TZ.
// =============================================
const getMonthStart = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
};

// =============================================
// helper to build a UTC month-start Date
// from a (year, month) pair with N months added.
// =============================================
const utcMonthStart = (year, month, monthsToAdd = 0) => {
  return new Date(Date.UTC(year, month + monthsToAdd, 1, 0, 0, 0, 0));
};

// =============================================
// Robust period parsing helper
// =============================================
/**
 * Parse an invoice/payment period string into a "YYYY-MM" key.
 * Handles:
 *   - ISO date strings ("2026-09-28T16:30:49.818Z")
 *   - Direct Date instances
 *   - "Month YYYY" ("May 2026")
 *   - "Month YYYY - Month YYYY" ("May 2026 - July 2026")
 *   - "Mon D, YYYY" / "Mon D, YYYY - Mon D, YYYY"
 *        ("Jul 7, 2026", "Jul 7, 2026 - Oct 6, 2026")
 *   - "D Mon YYYY" ("7 Jul 2026")
 * Returns null if none match.
 */
const parsePeriodToMonthKey = (paymentPeriod) => {
  if (!paymentPeriod) return null;

  // If already a Date, use its UTC year/month
  if (paymentPeriod instanceof Date && !isNaN(paymentPeriod.getTime())) {
    return getMonthStart(paymentPeriod).toISOString().slice(0, 7);
  }

  // Try ISO / directly-parseable date string first
  const iso = new Date(paymentPeriod);
  if (!isNaN(iso.getTime())) {
    return getMonthStart(iso).toISOString().slice(0, 7);
  }

  const str = String(paymentPeriod).trim();

  const monthNamesShort = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthNamesLong = [
    'january','february','march','april','may','june',
    'july','august','september','october','november','december'
  ];

  const monthIndexFromToken = (token) => {
    const lower = token.toLowerCase();
    let idx = monthNamesShort.indexOf(lower);
    if (idx === -1) idx = monthNamesLong.indexOf(lower);
    return idx;
  };

  // Pattern A: "Month YYYY" or "Month YYYY - Month YYYY" (no day)
  const noDayMatch = str.match(/^([A-Za-z]+)\s+(\d{4})/);
  if (noDayMatch) {
    const mIdx = monthIndexFromToken(noDayMatch[1]);
    if (mIdx >= 0) {
      const year = parseInt(noDayMatch[2], 10);
      return `${year}-${String(mIdx + 1).padStart(2, '0')}`;
    }
  }

  // Pattern B: "Mon D, YYYY" or "Mon D, YYYY - ..."
  const withDayMatch = str.match(/^([A-Za-z]+)\s+\d{1,2},\s+(\d{4})/);
  if (withDayMatch) {
    const mIdx = monthIndexFromToken(withDayMatch[1]);
    if (mIdx >= 0) {
      const year = parseInt(withDayMatch[2], 10);
      return `${year}-${String(mIdx + 1).padStart(2, '0')}`;
    }
  }

  // Pattern C: "D Mon YYYY" or "D Mon - D Mon YYYY"
  const dayFirstMatch = str.match(/^\d{1,2}\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayFirstMatch) {
    const mIdx = monthIndexFromToken(dayFirstMatch[1]);
    if (mIdx >= 0) {
      const year = parseInt(dayFirstMatch[2], 10);
      return `${year}-${String(mIdx + 1).padStart(2, '0')}`;
    }
  }

  return null;
};

/**
 * Add billing period while preserving the day of month
 */
const addBillingPeriod = (date, paymentPolicy = 'MONTHLY') => {
  const newDate = new Date(date);
  const monthsToAdd = getPolicyMonths(paymentPolicy);
  const originalDay = date.getDate();
  newDate.setMonth(newDate.getMonth() + monthsToAdd);
  if (newDate.getDate() !== originalDay) {
    newDate.setDate(0);
  }
  newDate.setHours(23, 59, 59, 999);
  return newDate;
};

/**
 * Calculate the grace period end date for any payment policy
 */
const calculateGracePeriodEnd = (dueDate, paymentPolicy, rentStartDate, periodIndex = 0) => {
  const policyMonths = getPolicyMonths(paymentPolicy);
  
  let periodStartDate;
  if (paymentPolicy === 'MONTHLY') {
    periodStartDate = new Date(dueDate);
    periodStartDate.setDate(1);
  } else {
    periodStartDate = new Date(rentStartDate);
    periodStartDate.setMonth(periodStartDate.getMonth() + (periodIndex * policyMonths));
    periodStartDate.setDate(1);
  }
  
  const graceEnd = new Date(
    periodStartDate.getFullYear(),
    periodStartDate.getMonth(),
    5,
    23, 59, 59, 999
  );
  
  if (graceEnd < dueDate) {
    graceEnd.setMonth(graceEnd.getMonth() + 1);
  }
  
  return graceEnd;
};

/**
 * Calculate the next payment due date based on payment history and policy
 * UPDATED: Now checks invoice status for accurate outstanding balance
 * and handles prepaid periods correctly (with month-range matching).
 * All period arithmetic is UTC-consistent to avoid TZ drift.
 */

export const calculateNextPaymentDue = (tenant, paymentReports = []) => {
  const { paymentPolicy, rentStart } = tenant;
  const today = new Date();
  const currentDateEndOfDay = setToEndOfDay(today);
  const policyMonths = getPolicyMonths(paymentPolicy);

  const rawRentStart = new Date(rentStart);
  const rentStartDate = utcMonthStart(
    rawRentStart.getUTCFullYear(),
    rawRentStart.getUTCMonth(),
    0
  );

  const rentInfo = calculateEscalatedRent(tenant);
  const monthlyRent = rentInfo.currentRent;

  const totalDueResult = calculateTotalDuePerPeriodWithWithholding(
    tenant, monthlyRent, paymentPolicy
  );
  const totalDuePerPeriod = totalDueResult.totalDueWithWithholding;
  const totalDueWithoutWithholding = totalDueResult.totalDueWithoutWithholding;
  const totalWithheld = totalDueResult.totalWithheld;

  // Freeze snapshot for this evaluation
  const currentlyFrozen = isTenantFrozenOn(tenant, today);

  if (rentStartDate > currentDateEndOfDay) {
    const nextDueDate = setToEndOfDay(rentStartDate);
    const gracePeriodEnd = calculateGracePeriodEnd(nextDueDate, paymentPolicy, rentStartDate, 0);
    return {
      nextDueDate,
      gracePeriodEnd,
      isOverdue: false,
      isInGracePeriod: false,
      paymentsBehind: 0,
      paymentsMade: paymentReports.length,
      expectedPayments: 0,
      lastPaymentDate:
        paymentReports.length > 0
          ? new Date(paymentReports[paymentReports.length - 1].datePaid)
          : null,
      timeRemaining: calculateTimeRemaining(nextDueDate, currentDateEndOfDay),
      totalDuePerPeriod,
      totalDueWithoutWithholding,
      totalWithheld,
      withholdingBreakdown: totalDueResult.withholdingBreakdown,
      totalPaidAllPeriods: 0,
      fullyPaidPeriods: 0,
      remainingBalanceForNextPeriod: totalDuePerPeriod,
      carryOverAmount: 0,
      isRentStarted: false,
      actualOutstandingBalance: 0,
      prepaidPeriods: [],
      isFrozen: currentlyFrozen,
      frozenPeriods: [],
      invoiceSummary: {
        totalOutstanding: 0,
        unpaidCount: 0,
        partialCount: 0,
        paidCount: 0,
        totalCount: 0,
      },
    };
  }

  const sortedPayments = [...paymentReports].sort(
    (a, b) => new Date(a.datePaid) - new Date(b.datePaid)
  );
  let lastPaymentDate = null;
  let paymentsMade = 0;

  const nonCreditPayments = sortedPayments.filter((p) => p.status !== 'CREDIT');
  if (nonCreditPayments.length > 0) {
    lastPaymentDate = new Date(nonCreditPayments[nonCreditPayments.length - 1].datePaid);
    paymentsMade = nonCreditPayments.length;
  }

  const invoices = tenant.invoices || [];

  // Prepaid periods
  const prepaidReports = nonCreditPayments.filter((p) => p.status === 'PREPAID');
  const prepaidPeriods = new Set();
  for (const prepaid of prepaidReports) {
    if (prepaid.paymentPeriod) {
      try {
        const periodKey = parsePeriodToMonthKey(prepaid.paymentPeriod);
        if (periodKey) prepaidPeriods.add(`${periodKey}-01T00:00:00.000Z`);
      } catch (_) {}
    }
  }

  const isMonthCoveredByPrepaid = (monthStart, policyMonthsLocal) => {
    if (!prepaidPeriods || prepaidPeriods.size === 0) return false;
    const check = new Date(monthStart);
    for (const prepaidKey of prepaidPeriods) {
      const start = new Date(prepaidKey);
      const end = utcMonthStart(
        start.getUTCFullYear(), start.getUTCMonth(), policyMonthsLocal
      );
      if (check >= start && check < end) return true;
    }
    return false;
  };

  // Invoice period map
  let totalOutstandingFromInvoices = 0;
  let unpaidInvoicesCount = 0;
  let partialInvoicesCount = 0;
  let paidInvoicesCount = 0;
  const invoicePeriods = {};

  for (const invoice of invoices) {
    const periodKey = parsePeriodToMonthKey(invoice.paymentPeriod);
    const isPrepaidPeriod = periodKey
      ? isMonthCoveredByPrepaid(new Date(periodKey + '-01T00:00:00Z'), policyMonths)
      : false;

    if (invoice.status === 'PAID') {
      paidInvoicesCount++;
      if (periodKey) {
        invoicePeriods[periodKey] = {
          totalDue: invoice.totalDue,
          amountPaid: invoice.amountPaid || invoice.totalDue,
          balance: 0,
          status: 'PAID',
          paymentPeriod: invoice.paymentPeriod,
          isFullyPaid: true,
          isPrepaid: isPrepaidPeriod,
        };
      }
      continue;
    } else if (invoice.status === 'PARTIAL') {
      const balance = invoice.balance || invoice.totalDue - invoice.amountPaid;

      if (isPrepaidPeriod) {
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: true,
          };
        }
        continue;
      }

      if (balance <= 0.01) {
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: false,
          };
        }
      } else {
        partialInvoicesCount++;
        totalOutstandingFromInvoices += balance;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.amountPaid,
            balance,
            status: 'PARTIAL',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: false,
            isPrepaid: false,
          };
        }
      }
    } else if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
      if (isPrepaidPeriod) {
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: true,
          };
        }
        continue;
      }

      let isFuturePeriod = false;
      if (periodKey) {
        const periodDate = new Date(periodKey + '-01T00:00:00Z');
        const todayStart = setToStartOfDay(today);
        if (periodDate > todayStart) isFuturePeriod = true;
      }

      if (isFuturePeriod) {
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: 0,
            balance: invoice.totalDue,
            status: 'FUTURE',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: false,
            isPrepaid: false,
            isFuture: true,
          };
        }
      } else {
        unpaidInvoicesCount++;
        totalOutstandingFromInvoices += invoice.totalDue;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.amountPaid || 0,
            balance: invoice.totalDue,
            status: invoice.status,
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: false,
            isPrepaid: false,
            isFuture: false,
          };
        }
      }
    }
  }

  const monthsSinceStart = calculateMonthsDifference(rentStartDate, today);
  const expectedPaymentsRaw = Math.max(0, Math.floor(monthsSinceStart / policyMonths));

  // Period payments
  const periodPayments = {};
  const periodTotalDue = {};
  let totalPaidAllPeriods = 0;

  const paymentPeriods = nonCreditPayments.filter(
    (p) => p.paymentPeriod && p.status !== 'PREPAID'
  );

  paymentPeriods.forEach((payment) => {
    const monthKey = parsePeriodToMonthKey(payment.paymentPeriod);
    if (!monthKey) return;
    const periodKey = new Date(monthKey + '-01T00:00:00Z').toISOString();
    if (!periodPayments[periodKey]) periodPayments[periodKey] = 0;
    periodPayments[periodKey] += payment.amountPaid || 0;
    totalPaidAllPeriods += payment.amountPaid || 0;
    if (payment.totalDue && !periodTotalDue[periodKey]) {
      periodTotalDue[periodKey] = parseFloat(payment.totalDue.toFixed(2));
    }
  });

  const paymentsWithoutPeriod = nonCreditPayments.filter(
    (p) => !p.paymentPeriod || p.status === 'PREPAID'
  );
  let legacyTotalPaid = 0;
  paymentsWithoutPeriod.forEach((p) => (legacyTotalPaid += p.amountPaid || 0));
  if (legacyTotalPaid > 0) {
    const firstPeriodKey = rentStartDate.toISOString();
    if (!periodPayments[firstPeriodKey]) periodPayments[firstPeriodKey] = 0;
    periodPayments[firstPeriodKey] += legacyTotalPaid;
    totalPaidAllPeriods += legacyTotalPaid;
  }

  const periodKeys = Object.keys(periodTotalDue);
  let actualTotalDuePerPeriod = totalDuePerPeriod;
  if (periodKeys.length > 0) {
    const reportedTotalDue = periodTotalDue[periodKeys[0]];
    if (reportedTotalDue > 0) {
      if (Math.abs(reportedTotalDue - totalDueWithoutWithholding) < 0.01) {
        actualTotalDuePerPeriod = totalDueWithoutWithholding;
      } else if (Math.abs(reportedTotalDue - totalDuePerPeriod) < 0.01) {
        actualTotalDuePerPeriod = totalDuePerPeriod;
      } else {
        actualTotalDuePerPeriod = reportedTotalDue;
      }
    }
  }
  actualTotalDuePerPeriod = parseFloat(actualTotalDuePerPeriod.toFixed(2));

  const periodsSinceStart = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  const totalPeriodsToCheck = Math.max(periodsSinceStart + 24, 36);

  const allPeriods = [];
  let frozenPeriodsElapsed = 0;
  const frozenPeriodMonthKeys = [];

  for (let i = 0; i < totalPeriodsToCheck; i++) {
    const periodMonthStart = utcMonthStart(
      rentStartDate.getUTCFullYear(),
      rentStartDate.getUTCMonth(),
      i * policyMonths
    );
    const periodKey = periodMonthStart.toISOString();
    const periodEnd = new Date(
      Date.UTC(
        periodMonthStart.getUTCFullYear(),
        periodMonthStart.getUTCMonth() + policyMonths,
        0, 23, 59, 59, 999
      )
    );
    const periodMonthKey = periodKey.slice(0, 7);

    // ─────────────────────────────────────────────────────────────
    // FREEZE: if this period's start is frozen, skip it entirely.
    // We still record it in allPeriods (marked isFrozen) so totals
    // like fullyPaidPeriods don't shift, and so callers can display
    // "Period X: frozen".
    // ─────────────────────────────────────────────────────────────
    if (isTenantFrozenOn(tenant, periodMonthStart)) {
      if (periodMonthStart <= today) frozenPeriodsElapsed++;
      frozenPeriodMonthKeys.push(periodMonthKey);
      allPeriods.push({
        index: i,
        startDate: new Date(periodMonthStart),
        endDate: periodEnd,
        key: periodKey,
        monthKey: periodMonthKey,
        amountPaid: 0,
        isFullyPaid: true,        // not owed
        remainingBalance: 0,
        hasInvoice: false,
        invoiceStatus: 'FROZEN',
        isPrepaid: false,
        isFrozen: true,
      });
      continue;
    }

    const invoiceForPeriod = invoicePeriods[periodMonthKey];
    const isPrepaid = isMonthCoveredByPrepaid(periodMonthStart, policyMonths);

    let amountPaid = periodPayments[periodKey] || 0;
    let isFullyPaid = false;
    let remainingBalance = actualTotalDuePerPeriod;

    if (isPrepaid) {
      isFullyPaid = true;
      remainingBalance = 0;
      amountPaid = actualTotalDuePerPeriod;
    } else if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') {
      isFullyPaid = true;
      remainingBalance = 0;
      amountPaid = invoiceForPeriod.totalDue || amountPaid;
    } else if (invoiceForPeriod && invoiceForPeriod.status === 'PARTIAL') {
      if (invoiceForPeriod.balance <= 0.01) {
        isFullyPaid = true;
        remainingBalance = 0;
        amountPaid = invoiceForPeriod.totalDue;
      } else {
        remainingBalance = invoiceForPeriod.balance;
        if (amountPaid >= remainingBalance) {
          isFullyPaid = true;
          remainingBalance = 0;
        } else {
          isFullyPaid = false;
          remainingBalance = remainingBalance - amountPaid;
        }
      }
    } else if (
      invoiceForPeriod &&
      (invoiceForPeriod.status === 'UNPAID' || invoiceForPeriod.status === 'OVERDUE')
    ) {
      if (amountPaid >= invoiceForPeriod.totalDue) {
        isFullyPaid = true;
        remainingBalance = 0;
        amountPaid = invoiceForPeriod.totalDue;
      } else {
        isFullyPaid = false;
        remainingBalance = invoiceForPeriod.totalDue - amountPaid;
      }
    } else {
      if (amountPaid >= actualTotalDuePerPeriod) {
        isFullyPaid = true;
        remainingBalance = 0;
      } else {
        remainingBalance = actualTotalDuePerPeriod - amountPaid;
      }
    }

    remainingBalance = parseFloat(remainingBalance.toFixed(2));
    if (Math.abs(remainingBalance) < 0.01) {
      remainingBalance = 0;
      isFullyPaid = true;
    }

    allPeriods.push({
      index: i,
      startDate: new Date(periodMonthStart),
      endDate: periodEnd,
      key: periodKey,
      monthKey: periodMonthKey,
      amountPaid,
      isFullyPaid,
      remainingBalance,
      hasInvoice: !!invoiceForPeriod,
      invoiceStatus: invoiceForPeriod?.status || null,
      isPrepaid,
      isFrozen: false,
    });
  }

  // Carve through periods with carry-over
  let carryOverAmount = 0;
  let fullyPaidPeriods = 0;
  let firstUnpaidPeriodIndex = -1;

  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    if (period.isFrozen) {
      fullyPaidPeriods++;
      continue;
    }
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      fullyPaidPeriods++;
      continue;
    }
    if (period.isPrepaid) {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      fullyPaidPeriods++;
      continue;
    }
    if (period.isFullyPaid) {
      fullyPaidPeriods++;
      continue;
    }
    const totalAvailable = period.amountPaid + carryOverAmount;
    const periodDue = period.remainingBalance || actualTotalDuePerPeriod;
    if (totalAvailable >= periodDue) {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      carryOverAmount = totalAvailable - periodDue;
      fullyPaidPeriods++;
    } else {
      period.isFullyPaid = false;
      period.remainingBalance = periodDue - totalAvailable;
      carryOverAmount = 0;
      if (firstUnpaidPeriodIndex === -1) firstUnpaidPeriodIndex = i;
    }
  }

  // paymentsBehind — skip frozen
  let paymentsBehind = 0;
  const periodsToCheck = Math.min(periodsSinceStart, allPeriods.length);
  for (let i = 0; i < periodsToCheck; i++) {
    const period = allPeriods[i];
    if (period.isFrozen) continue;
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') continue;
    if (!period.isFullyPaid) paymentsBehind++;
  }

  // Next due date — skip frozen
  let nextDueDate;
  let nextPeriodIndex = 0;
  let foundUnpaid = false;
  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    if (period.isFrozen) continue;
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') continue;
    if (!period.isFullyPaid) {
      nextPeriodIndex = i;
      foundUnpaid = true;
      break;
    }
  }

  if (!foundUnpaid) {
    const nextDate = utcMonthStart(
      rentStartDate.getUTCFullYear(),
      rentStartDate.getUTCMonth(),
      fullyPaidPeriods * policyMonths
    );
    nextDueDate = setToEndOfDay(nextDate);
  } else {
    const nextDate = utcMonthStart(
      rentStartDate.getUTCFullYear(),
      rentStartDate.getUTCMonth(),
      nextPeriodIndex * policyMonths
    );
    nextDueDate = setToEndOfDay(nextDate);
  }

  // Overdue / grace
  let isOverdue = false;
  let isInGracePeriod = false;
  const currentDateMidnight = setToStartOfDay(today);
  const dueDateMidnight = setToStartOfDay(nextDueDate);
  const gracePeriodEnd = calculateGracePeriodEnd(
    nextDueDate, paymentPolicy, rentStartDate, nextPeriodIndex
  );
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;

  // actualOutstandingBalance — skip frozen
  let actualOutstandingBalance = 0;
  for (const invoice of invoices) {
    const monthKey = parsePeriodToMonthKey(invoice.paymentPeriod);
    const periodKey = monthKey
      ? new Date(monthKey + '-01T00:00:00Z').toISOString()
      : null;

    if (periodKey && isMonthCoveredByPrepaid(new Date(periodKey), policyMonths)) {
      continue;
    }
    if (periodKey) {
      const periodStart = new Date(periodKey);
      if (isTenantFrozenOn(tenant, periodStart)) continue;
    }

    if (invoice.status === 'PAID') continue;
    if (invoice.status === 'PARTIAL') {
      const balance = invoice.balance || invoice.totalDue - invoice.amountPaid;
      if (balance > 0.01) actualOutstandingBalance += balance;
    }
    if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
      let isFuturePeriod = false;
      if (periodKey) {
        const periodDate = new Date(periodKey);
        if (periodDate > setToStartOfDay(today)) isFuturePeriod = true;
      }
      if (!isFuturePeriod) actualOutstandingBalance += invoice.totalDue;
    }
  }
  actualOutstandingBalance = parseFloat(actualOutstandingBalance.toFixed(2));
  if (Math.abs(actualOutstandingBalance) < 0.01) actualOutstandingBalance = 0;

  // Time remaining
  let timeRemaining;
  if (isOverdue) {
    const overdueDays = Math.abs(
      Math.floor((currentDateMidnight - gracePeriodEndMidnight) / (1000 * 60 * 60 * 24))
    );
    timeRemaining = {
      isOverdue: true,
      isInGracePeriod: false,
      days: -overdueDays,
      hours: 0,
      minutes: 0,
      formatted: `Overdue by ${overdueDays} day${overdueDays > 1 ? 's' : ''} (grace period ended)`,
    };
  } else if (isInGracePeriod) {
    const daysRemaining = Math.floor(
      (gracePeriodEndMidnight - currentDateMidnight) / (1000 * 60 * 60 * 24)
    );
    timeRemaining = {
      isOverdue: false,
      isInGracePeriod: true,
      days: daysRemaining,
      hours: 0,
      minutes: 0,
      formatted: `Grace period: ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} remaining`,
    };
  } else {
    const diffDays = Math.floor(
      (dueDateMidnight - currentDateMidnight) / (1000 * 60 * 60 * 24)
    );
    timeRemaining =
      diffDays === 0
        ? { isOverdue: false, isInGracePeriod: false, days: 0, hours: 0, minutes: 0, formatted: 'Due today' }
        : {
            isOverdue: false,
            isInGracePeriod: false,
            days: diffDays,
            hours: 0,
            minutes: 0,
            formatted: `${diffDays} day${diffDays > 1 ? 's' : ''} remaining`,
          };
  }

  const remainingBalanceForNextPeriod =
    foundUnpaid && nextPeriodIndex < allPeriods.length
      ? allPeriods[nextPeriodIndex].remainingBalance
      : 0;

  const expectedPayments = Math.max(0, expectedPaymentsRaw - frozenPeriodsElapsed);

  return {
    nextDueDate,
    gracePeriodEnd,
    isOverdue,
    isInGracePeriod,
    paymentsBehind,
    paymentsMade: nonCreditPayments.length,
    expectedPayments,
    lastPaymentDate,
    timeRemaining,
    totalDuePerPeriod: actualTotalDuePerPeriod,
    totalDueWithoutWithholding,
    totalWithheld,
    withholdingBreakdown: totalDueResult.withholdingBreakdown,
    totalPaidAllPeriods,
    fullyPaidPeriods,
    remainingBalanceForNextPeriod,
    carryOverAmount,
    isRentStarted: true,
    actualOutstandingBalance,
    prepaidPeriods: Array.from(prepaidPeriods),
    isFrozen: currentlyFrozen,
    frozenPeriods: frozenPeriodMonthKeys,
    invoiceSummary: {
      totalOutstanding: parseFloat(totalOutstandingFromInvoices.toFixed(2)),
      unpaidCount: unpaidInvoicesCount,
      partialCount: partialInvoicesCount,
      paidCount: paidInvoicesCount,
      totalCount: invoices.length,
    },
  };
};

/**
 * Calculate time remaining until a due date
 */
export const calculateTimeRemaining = (dueDate, currentDate = new Date()) => {
  const dueDateEnd = setToEndOfDay(dueDate);
  const currentDateEnd = setToEndOfDay(currentDate);
  
  const diffTime = dueDateEnd - currentDateEnd;
  
  if (diffTime < 0) {
    const overdueDays = Math.abs(Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    let formatted = 'Overdue';
    if (overdueDays === 1) {
      formatted = 'Overdue by 1 day';
    } else if (overdueDays > 1) {
      formatted = `Overdue by ${overdueDays} days`;
    } else {
      formatted = 'Due today';
    }
    return {
      isOverdue: true,
      days: -overdueDays,
      hours: 0,
      minutes: 0,
      formatted
    };
  }
  
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffTime % (86400000)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffTime % (3600000)) / (1000 * 60));
  
  let formatted = '';
  if (diffDays === 0) {
    if (diffHours === 0) {
      formatted = `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} remaining`;
    } else {
      formatted = `${diffHours} hour${diffHours > 1 ? 's' : ''} remaining`;
    }
  } else if (diffDays === 1) {
    formatted = `1 day remaining`;
  } else {
    formatted = `${diffDays} days remaining`;
  }
  
  return {
    isOverdue: false,
    days: diffDays,
    hours: diffHours,
    minutes: diffMinutes,
    formatted
  };
};

/**
 * Calculate months between two dates with decimal precision
 */
const calculateMonthsDifference = (startDate, endDate) => {
  if (startDate > endDate) {
    return 0;
  }
  const years = endDate.getFullYear() - startDate.getFullYear();
  const months = endDate.getMonth() - startDate.getMonth();
  const days = endDate.getDate() - startDate.getDate();
  const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
  const fractionalMonth = days / daysInMonth;
  return (years * 12) + months + fractionalMonth;
};

/**
 * Calculate the current billing period
 */
export const getCurrentBillingPeriod = (date, tenant) => {
  const { paymentPolicy, rentStart } = tenant;
  const policyMonths = getPolicyMonths(paymentPolicy);
  const startDate = setToStartOfDay(new Date(rentStart));
  const checkDate = setToStartOfDay(date);
  
  if (startDate > checkDate) {
    const periodEnd = setToEndOfDay(startDate);
    return {
      periodNumber: 0,
      periodStart: startDate,
      periodEnd,
      daysRemainingInPeriod: calculateDaysRemaining(date, periodEnd),
      isInCurrentPeriod: false,
      progressPercentage: 0,
      periodStartFormatted: startDate.toLocaleDateString(),
      periodEndFormatted: periodEnd.toLocaleDateString(),
      isPending: true
    };
  }
  
  const monthsSinceStart = calculateMonthsDifference(startDate, checkDate);
  const periodNumber = Math.floor(monthsSinceStart / policyMonths);
  
  let periodStart = new Date(startDate);
  if (periodNumber > 0) {
    periodStart = addBillingPeriod(startDate, paymentPolicy);
    for (let i = 1; i < periodNumber; i++) {
      periodStart = addBillingPeriod(periodStart, paymentPolicy);
    }
  }
  periodStart = setToStartOfDay(periodStart);
  
  const periodEnd = addBillingPeriod(periodStart, paymentPolicy);
  const daysRemaining = calculateDaysRemaining(date, periodEnd);
  const periodLength = policyMonths * 30.44;
  const daysIntoPeriod = Math.max(0, periodLength - daysRemaining);
  const progressPercentage = (daysIntoPeriod / periodLength) * 100;
  
  return {
    periodNumber,
    periodStart: setToStartOfDay(periodStart),
    periodEnd,
    daysRemainingInPeriod: Math.max(0, daysRemaining),
    isInCurrentPeriod: date >= periodStart && date <= periodEnd,
    progressPercentage: Math.min(100, Math.max(0, Math.round(progressPercentage))),
    periodStartFormatted: periodStart.toLocaleDateString(),
    periodEndFormatted: periodEnd.toLocaleDateString(),
    isPending: false
  };
};

/**
 * Calculate days remaining until a specific date
 */
const calculateDaysRemaining = (currentDate, endDate) => {
  const currentStart = setToStartOfDay(currentDate);
  const endStart = setToStartOfDay(endDate);
  const diffTime = endStart - currentStart;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Calculate overdue status with grace period
 */
export const calculateOverdueStatus = (dueDate, currentDate, paymentPolicy, rentStartDate, periodIndex = 0) => {
  const dueDateMidnight = setToStartOfDay(dueDate);
  const currentDateMidnight = setToStartOfDay(currentDate);
  const gracePeriodEnd = calculateGracePeriodEnd(dueDate, paymentPolicy, rentStartDate, periodIndex);
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  
  const isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  const isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;
  
  let daysIntoPeriod = 0;
  let formattedStatus = '';
  
  if (isOverdue) {
    daysIntoPeriod = Math.floor((currentDateMidnight - gracePeriodEndMidnight) / (1000 * 60 * 60 * 24));
    formattedStatus = `Overdue by ${daysIntoPeriod} day${daysIntoPeriod > 1 ? 's' : ''} (grace period ended)`;
  } else if (isInGracePeriod) {
    daysIntoPeriod = Math.floor((currentDateMidnight - dueDateMidnight) / (1000 * 60 * 60 * 24));
    formattedStatus = `In grace period (day ${daysIntoPeriod + 1} of 5)`;
  } else {
    const daysUntilDue = Math.floor((dueDateMidnight - currentDateMidnight) / (1000 * 60 * 60 * 24));
    formattedStatus = daysUntilDue === 0 ? 'Due today' : `${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''} until due`;
  }
  
  return {
    isOverdue,
    isInGracePeriod,
    gracePeriodEnd,
    daysIntoPeriod,
    formattedStatus,
    dueDate
  };
};

/**
 * Get payment summary for a tenant
 * UPDATED: Uses range-based prepaid matching so prepaid reports
 * are correctly applied even when their month starts don't exactly
 * align with the tenant's policy-aligned period keys.
 */

export const getPaymentSummary = (tenant) => {
  const paymentReports = tenant.paymentReports || [];
  const invoices = tenant.invoices || [];
  const monthlyRent = calculateEscalatedRent(tenant).currentRent;

  const nextPaymentInfo = calculateNextPaymentDue(tenant, paymentReports);
  const currentPeriod = getCurrentBillingPeriod(new Date(), tenant);

  const nonCreditPayments = paymentReports.filter((p) => p.status !== 'CREDIT');
  const totalPaid = nonCreditPayments.reduce((sum, p) => sum + p.amountPaid, 0);
  const policyMonths = getPolicyMonths(tenant.paymentPolicy);

  const totalDuePerPeriod = nextPaymentInfo.totalDuePerPeriod || 0;
  const totalDueWithoutWithholding = nextPaymentInfo.totalDueWithoutWithholding || 0;
  const totalWithheld = nextPaymentInfo.totalWithheld || 0;
  const outstandingBalance = nextPaymentInfo.actualOutstandingBalance || 0;

  const prepaidPeriodKeys = nextPaymentInfo.prepaidPeriods || [];
  const isMonthCoveredByPrepaid = (monthStart) => {
    if (!prepaidPeriodKeys || prepaidPeriodKeys.length === 0) return false;
    const check = new Date(monthStart);
    for (const prepaidKey of prepaidPeriodKeys) {
      const start = new Date(prepaidKey);
      const end = utcMonthStart(
        start.getUTCFullYear(), start.getUTCMonth(), policyMonths
      );
      if (check >= start && check < end) return true;
    }
    return false;
  };

  let totalExpectedFromInvoices = 0;
  let totalPaidFromInvoices = 0;
  let fullyPaidInvoices = 0;
  let partialInvoices = 0;
  let unpaidInvoices = 0;
  let overdueInvoices = 0;

  const today = new Date();
  const todayStart = setToStartOfDay(today);

  for (const invoice of invoices) {
    const invoiceTotal = invoice.totalDue || 0;
    const invoicePaid = invoice.amountPaid || 0;
    const invoiceBalance = invoice.balance || invoiceTotal - invoicePaid;

    totalExpectedFromInvoices += invoiceTotal;
    totalPaidFromInvoices += invoicePaid;

    const monthKey = parsePeriodToMonthKey(invoice.paymentPeriod);
    let isPrepaid = false;
    let isFrozenPeriod = false;
    if (monthKey) {
      const periodStart = new Date(monthKey + '-01T00:00:00Z');
      isPrepaid = isMonthCoveredByPrepaid(periodStart);
      isFrozenPeriod = isTenantFrozenOn(tenant, periodStart);
    }

    if (invoice.status === 'PAID') {
      fullyPaidInvoices++;
      continue;
    } else if (invoice.status === 'PARTIAL') {
      if (isPrepaid || isFrozenPeriod) {
        fullyPaidInvoices++;
        continue;
      }
      if (invoiceBalance <= 0.01) {
        fullyPaidInvoices++;
      } else {
        partialInvoices++;
        if (new Date(invoice.dueDate) < today) overdueInvoices++;
      }
    } else if (invoice.status === 'UNPAID') {
      if (isPrepaid || isFrozenPeriod) {
        fullyPaidInvoices++;
        continue;
      }
      unpaidInvoices++;
      if (new Date(invoice.dueDate) < today) overdueInvoices++;
    } else if (invoice.status === 'OVERDUE') {
      if (isPrepaid || isFrozenPeriod) {
        fullyPaidInvoices++;
        continue;
      }
      overdueInvoices++;
    }
  }

  let status = 'UP_TO_DATE';
  const rentStartStart = setToStartOfDay(new Date(tenant.rentStart));

  if (nextPaymentInfo.isFrozen) {
    status = 'FROZEN';
  } else if (rentStartStart > todayStart) {
    status = 'NOT_STARTED';
  } else if (overdueInvoices > 0) {
    status = 'OVERDUE';
  } else if (unpaidInvoices > 0) {
    status = 'UNPAID';
  } else if (partialInvoices > 0 && outstandingBalance > 0.01) {
    status = 'PARTIALLY_PAID';
  } else if (fullyPaidInvoices > 0 && outstandingBalance === 0) {
    status = 'PAID';
  } else if (outstandingBalance < -0.01) {
    status = 'OVERPAID';
  } else if (totalPaid > 0 && outstandingBalance === 0) {
    status = 'PAID';
  } else if (invoices.length > 0 && fullyPaidInvoices === invoices.length) {
    status = 'PAID';
  } else {
    status = 'UP_TO_DATE';
  }

  const finalPaidReports = [];
  for (const report of paymentReports) {
    if (report.status === 'PARTIAL') {
      const linkedInvoices = invoices.filter(
        (inv) => inv.paymentReportId === report.id
      );
      if (linkedInvoices.length > 0) {
        const allFullyPaid = linkedInvoices.every((inv) => inv.status === 'PAID');
        if (allFullyPaid) {
          finalPaidReports.push({
            id: report.id,
            amountPaid: report.amountPaid,
            status: report.status,
            effectiveStatus: 'PAID',
          });
        }
      }
    }
  }

  return {
    paymentPolicy: tenant.paymentPolicy,
    policyMonths,
    monthlyRent,
    paymentAmountPerPeriod: calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy),
    totalDuePerPeriod,
    totalDueWithoutWithholding,
    totalWithheld,
    withholdingBreakdown: nextPaymentInfo.withholdingBreakdown,
    isFrozen: nextPaymentInfo.isFrozen,
    frozenPeriods: nextPaymentInfo.frozenPeriods,
    invoiceStatus: {
      fullyPaid: fullyPaidInvoices,
      partial: partialInvoices,
      unpaid: unpaidInvoices,
      overdue: overdueInvoices,
      total: invoices.length,
    },
    nextPayment: {
      dueDate: nextPaymentInfo.nextDueDate,
      dueDateFormatted: nextPaymentInfo.nextDueDate
        ? nextPaymentInfo.nextDueDate.toLocaleDateString()
        : null,
      dueDateTime: nextPaymentInfo.nextDueDate
        ? nextPaymentInfo.nextDueDate.toLocaleString()
        : null,
      amount: totalDuePerPeriod,
      isOverdue: nextPaymentInfo.isOverdue,
      isInGracePeriod: nextPaymentInfo.isInGracePeriod,
      timeRemaining: nextPaymentInfo.timeRemaining,
      paymentsBehind: nextPaymentInfo.paymentsBehind,
      gracePeriodEnd: nextPaymentInfo.gracePeriodEnd,
      gracePeriodEndFormatted: nextPaymentInfo.gracePeriodEnd
        ? nextPaymentInfo.gracePeriodEnd.toLocaleDateString()
        : null,
      fullyPaidPeriods: nextPaymentInfo.fullyPaidPeriods,
      remainingBalanceForNextPeriod: nextPaymentInfo.remainingBalanceForNextPeriod,
      carryOverAmount: nextPaymentInfo.carryOverAmount,
    },
    currentPeriod: {
      ...currentPeriod,
      periodStartFormatted: currentPeriod.periodStart.toLocaleDateString(),
      periodEndFormatted: currentPeriod.periodEnd.toLocaleDateString(),
    },
    paymentHistory: {
      totalPaid: parseFloat(totalPaidFromInvoices.toFixed(2)),
      totalExpected: parseFloat(totalExpectedFromInvoices.toFixed(2)),
      outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
      paymentsMade: nonCreditPayments.length,
      expectedPaymentsCount: nextPaymentInfo.expectedPayments || 0,
      lastPaymentDate: nextPaymentInfo.lastPaymentDate,
      lastPaymentDateFormatted: nextPaymentInfo.lastPaymentDate
        ? nextPaymentInfo.lastPaymentDate.toLocaleDateString()
        : null,
      lastPaymentDateTime: nextPaymentInfo.lastPaymentDate
        ? nextPaymentInfo.lastPaymentDate.toLocaleString()
        : null,
    },
    reconciliation: {
      prepaidPeriods: nextPaymentInfo.prepaidPeriods || [],
      finalPaidReports,
      finalPaidCount: finalPaidReports.length,
    },
    status,
    isRentStarted: rentStartStart <= todayStart,
    rentStartDate: rentStartStart,
  };
};