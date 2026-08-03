// services/paymentScheduling.js

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

// Note: getPolicyMonths is now imported from rentCalculation.js
// Do not define it locally to avoid conflicts

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

/**
 * Get the month start date (first day of the month) for a given date
 */
const getMonthStart = (date) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
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
 * UPDATED: Now includes withholding tax calculations
 */
export const calculateNextPaymentDue = (tenant, paymentReports = []) => {
  const { paymentPolicy, rentStart } = tenant;
  const today = new Date();
  const currentDateEndOfDay = setToEndOfDay(today);
  const rentStartDate = setToStartOfDay(new Date(rentStart));
  const policyMonths = getPolicyMonths(paymentPolicy);
  
  // Calculate monthly rent with escalation
  const rentInfo = calculateEscalatedRent(tenant);
  const monthlyRent = rentInfo.currentRent;
  
  // =============================================
  // CALCULATE TOTAL DUE PER PERIOD WITH WITHHOLDING TAX
  // =============================================
  const totalDueResult = calculateTotalDuePerPeriodWithWithholding(tenant, monthlyRent, paymentPolicy);
  const totalDuePerPeriod = totalDueResult.totalDueWithWithholding;
  const totalDueWithoutWithholding = totalDueResult.totalDueWithoutWithholding;
  const totalWithheld = totalDueResult.totalWithheld;
  
  // If rent hasn't started yet, next due date is rent start date
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
      lastPaymentDate: paymentReports.length > 0 ? new Date(paymentReports[paymentReports.length - 1].datePaid) : null,
      timeRemaining: calculateTimeRemaining(nextDueDate, currentDateEndOfDay),
      totalDuePerPeriod,
      totalDueWithoutWithholding,
      totalWithheld,
      withholdingBreakdown: totalDueResult.withholdingBreakdown,
      totalPaidAllPeriods: 0,
      fullyPaidPeriods: 0,
      remainingBalanceForNextPeriod: totalDuePerPeriod,
      carryOverAmount: 0,
      isRentStarted: false
    };
  }
  
  // Sort payments by date (oldest to newest)
  const sortedPayments = [...paymentReports].sort((a, b) => new Date(a.datePaid) - new Date(b.datePaid));
  
  let lastPaymentDate = null;
  let paymentsMade = 0;
  
  // Get the most recent payment (excluding CREDIT records)
  const nonCreditPayments = sortedPayments.filter(p => p.status !== 'CREDIT');
  if (nonCreditPayments.length > 0) {
    lastPaymentDate = new Date(nonCreditPayments[nonCreditPayments.length - 1].datePaid);
    paymentsMade = nonCreditPayments.length;
  }
  
  // Calculate expected number of payments by now
  const monthsSinceStart = calculateMonthsDifference(rentStartDate, today);
  const expectedPayments = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  
  // Group payments by period
  const periodPayments = {};
  const periodTotalDue = {};
  let totalPaidAllPeriods = 0;
  
  const paymentPeriods = nonCreditPayments.filter(p => p.paymentPeriod);
  
  paymentPeriods.forEach(payment => {
    const paymentDate = new Date(payment.paymentPeriod);
    const monthStart = getMonthStart(paymentDate);
    const periodKey = monthStart.toISOString();
    
    if (!periodPayments[periodKey]) {
      periodPayments[periodKey] = 0;
    }
    periodPayments[periodKey] += payment.amountPaid || 0;
    totalPaidAllPeriods += payment.amountPaid || 0;
    
    if (payment.totalDue && !periodTotalDue[periodKey]) {
      periodTotalDue[periodKey] = parseFloat(payment.totalDue.toFixed(2));
    }
  });
  
  // Handle payments without a payment period (legacy data)
  const paymentsWithoutPeriod = nonCreditPayments.filter(p => !p.paymentPeriod);
  let legacyTotalPaid = 0;
  paymentsWithoutPeriod.forEach(p => {
    legacyTotalPaid += p.amountPaid || 0;
  });
  
  if (legacyTotalPaid > 0) {
    const firstPeriodKey = getMonthStart(rentStartDate).toISOString();
    if (!periodPayments[firstPeriodKey]) {
      periodPayments[firstPeriodKey] = 0;
    }
    periodPayments[firstPeriodKey] += legacyTotalPaid;
    totalPaidAllPeriods += legacyTotalPaid;
  }
  
  // CRITICAL: Use the withholding tax adjusted total due per period
  // If payment reports have a different totalDue, use that (source of truth)
  const periodKeys = Object.keys(periodTotalDue);
  let actualTotalDuePerPeriod = totalDuePerPeriod;
  
  if (periodKeys.length > 0) {
    // Use the first period's totalDue from payment reports
    const reportedTotalDue = periodTotalDue[periodKeys[0]];
    if (reportedTotalDue > 0) {
      // Compare with our calculated value to see if withholding tax was applied
      if (Math.abs(reportedTotalDue - totalDueWithoutWithholding) < 0.01) {
        // The payment report used the amount WITHOUT withholding tax
        // This means we should use the original amount
        actualTotalDuePerPeriod = totalDueWithoutWithholding;
      } else if (Math.abs(reportedTotalDue - totalDuePerPeriod) < 0.01) {
        // The payment report used the amount WITH withholding tax
        actualTotalDuePerPeriod = totalDuePerPeriod;
      } else {
        // Use the reported value as source of truth
        actualTotalDuePerPeriod = reportedTotalDue;
      }
    }
  }
  
  // Round to 2 decimal places
  actualTotalDuePerPeriod = parseFloat(actualTotalDuePerPeriod.toFixed(2));
  
  // Build periods
  const periodsSinceStart = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  const totalPeriodsToCheck = Math.max(periodsSinceStart + 24, 36);
  
  const allPeriods = [];
  
  for (let i = 0; i < totalPeriodsToCheck; i++) {
    const periodDate = new Date(rentStartDate);
    periodDate.setMonth(periodDate.getMonth() + (i * policyMonths));
    const periodMonthStart = getMonthStart(periodDate);
    const periodKey = periodMonthStart.toISOString();
    
    const periodEnd = new Date(periodMonthStart);
    periodEnd.setMonth(periodEnd.getMonth() + policyMonths);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodEnd.setHours(23, 59, 59, 999);
    
    allPeriods.push({
      index: i,
      startDate: new Date(periodMonthStart),
      endDate: periodEnd,
      key: periodKey,
      amountPaid: periodPayments[periodKey] || 0,
      isFullyPaid: false,
      remainingBalance: actualTotalDuePerPeriod
    });
  }
  
  // Process periods sequentially, carrying over overpayments
  let carryOverAmount = 0;
  let fullyPaidPeriods = 0;
  let firstUnpaidPeriodIndex = -1;
  
  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    const totalAvailable = period.amountPaid + carryOverAmount;
    
    if (totalAvailable >= actualTotalDuePerPeriod) {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      carryOverAmount = totalAvailable - actualTotalDuePerPeriod;
      fullyPaidPeriods++;
    } else {
      period.isFullyPaid = false;
      period.remainingBalance = actualTotalDuePerPeriod - totalAvailable;
      carryOverAmount = 0;
      if (firstUnpaidPeriodIndex === -1) {
        firstUnpaidPeriodIndex = i;
      }
    }
  }
  
  // Calculate payments behind
  let paymentsBehind = 0;
  const periodsToCheck = Math.min(periodsSinceStart, allPeriods.length);
  for (let i = 0; i < periodsToCheck; i++) {
    if (!allPeriods[i].isFullyPaid) {
      paymentsBehind++;
    }
  }
  
  // Determine the next due date
  let nextDueDate;
  let nextPeriodIndex = 0;
  
  for (let i = 0; i < allPeriods.length; i++) {
    if (!allPeriods[i].isFullyPaid) {
      nextPeriodIndex = i;
      break;
    }
    if (i === allPeriods.length - 1) {
      nextPeriodIndex = allPeriods.length;
    }
  }
  
  if (nextPeriodIndex >= allPeriods.length) {
    const nextDate = new Date(rentStartDate);
    nextDate.setMonth(nextDate.getMonth() + (fullyPaidPeriods * policyMonths));
    nextDueDate = setToEndOfDay(nextDate);
  } else {
    const nextDate = new Date(rentStartDate);
    nextDate.setMonth(nextDate.getMonth() + (nextPeriodIndex * policyMonths));
    nextDueDate = setToEndOfDay(nextDate);
  }
  
  // Calculate grace period
  const gracePeriodEnd = calculateGracePeriodEnd(
    nextDueDate, 
    paymentPolicy, 
    rentStartDate, 
    nextPeriodIndex
  );
  
  const currentDateMidnight = setToStartOfDay(today);
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  const dueDateMidnight = setToStartOfDay(nextDueDate);
  
  const isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  const isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;
  
  let timeRemaining;
  if (isOverdue) {
    const overdueDays = Math.abs(Math.floor((currentDateMidnight - gracePeriodEndMidnight) / (1000 * 60 * 60 * 24)));
    timeRemaining = {
      isOverdue: true,
      isInGracePeriod: false,
      days: -overdueDays,
      hours: 0,
      minutes: 0,
      formatted: `Overdue by ${overdueDays} day${overdueDays > 1 ? 's' : ''} (grace period ended)`
    };
  } else if (isInGracePeriod) {
    const daysRemaining = Math.floor((gracePeriodEndMidnight - currentDateMidnight) / (1000 * 60 * 60 * 24));
    timeRemaining = {
      isOverdue: false,
      isInGracePeriod: true,
      days: daysRemaining,
      hours: 0,
      minutes: 0,
      formatted: `Grace period: ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} remaining`
    };
  } else {
    const diffTime = dueDateMidnight - currentDateMidnight;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      timeRemaining = {
        isOverdue: false,
        isInGracePeriod: false,
        days: 0,
        hours: 0,
        minutes: 0,
        formatted: 'Due today'
      };
    } else {
      timeRemaining = {
        isOverdue: false,
        isInGracePeriod: false,
        days: diffDays,
        hours: 0,
        minutes: 0,
        formatted: `${diffDays} day${diffDays > 1 ? 's' : ''} remaining`
      };
    }
  }
  
  let remainingBalanceForNextPeriod = 0;
  if (nextPeriodIndex < allPeriods.length) {
    remainingBalanceForNextPeriod = allPeriods[nextPeriodIndex].remainingBalance;
  } else {
    remainingBalanceForNextPeriod = 0;
  }
  
  return {
    nextDueDate,
    gracePeriodEnd,
    isOverdue,
    isInGracePeriod,
    paymentsBehind,
    paymentsMade: nonCreditPayments.length,
    expectedPayments: periodsSinceStart,
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
    _debug: {
      periodPayments,
      periodTotalDue,
      allPeriods: allPeriods.slice(0, 12).map(p => ({
        index: p.index,
        key: p.key,
        amountPaid: p.amountPaid,
        isFullyPaid: p.isFullyPaid,
        remainingBalance: p.remainingBalance
      })),
      carryOverAmount,
      fullyPaidPeriods,
      nextPeriodIndex,
      actualTotalDuePerPeriod,
      totalDueWithoutWithholding,
      totalWithheld,
      periodsSinceStart
    }
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
 * Get payment summary for a tenant (UPDATED with withholding tax)
 */
export const getPaymentSummary = (tenant) => {
  const paymentReports = tenant.paymentReports || [];
  const monthlyRent = calculateEscalatedRent(tenant).currentRent;
  
  // Get the next payment info which now includes withholding tax
  const nextPaymentInfo = calculateNextPaymentDue(tenant, paymentReports);
  const currentPeriod = getCurrentBillingPeriod(new Date(), tenant);
  
  // Calculate total paid (excluding CREDIT records)
  const nonCreditPayments = paymentReports.filter(p => p.status !== 'CREDIT');
  const totalPaid = nonCreditPayments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const policyMonths = getPolicyMonths(tenant.paymentPolicy);
  
  // Use the total due per period from nextPaymentInfo (already includes withholding tax)
  const totalDuePerPeriod = nextPaymentInfo.totalDuePerPeriod || 0;
  const totalDueWithoutWithholding = nextPaymentInfo.totalDueWithoutWithholding || 0;
  const totalWithheld = nextPaymentInfo.totalWithheld || 0;
  
  // Calculate expected total based on number of periods
  const rentStartDate = new Date(tenant.rentStart);
  const today = new Date();
  const rentStartStart = setToStartOfDay(rentStartDate);
  const todayStart = setToStartOfDay(today);
  
  let expectedPaymentsCount = 0;
  let expectedTotal = 0;
  
  if (rentStartStart <= todayStart) {
    let monthsDiff = 0;
    const years = todayStart.getFullYear() - rentStartStart.getFullYear();
    const months = todayStart.getMonth() - rentStartStart.getMonth();
    monthsDiff = (years * 12) + months;
    
    if (monthsDiff === 0) {
      expectedPaymentsCount = 1;
    } else {
      const completedPeriods = Math.floor(monthsDiff / policyMonths);
      const hasCurrentPeriod = (monthsDiff % policyMonths) >= 0;
      expectedPaymentsCount = completedPeriods + (hasCurrentPeriod ? 1 : 0);
    }
    
    // Use the total due per period (with withholding tax)
    expectedTotal = expectedPaymentsCount * totalDuePerPeriod;
  } else {
    expectedPaymentsCount = 0;
    expectedTotal = 0;
  }
  
  expectedTotal = parseFloat(expectedTotal.toFixed(2));
  const totalPaidRounded = parseFloat(totalPaid.toFixed(2));
  
  // Calculate outstanding balance (with withholding tax considered)
  let outstandingBalance = expectedTotal - totalPaidRounded;
  outstandingBalance = parseFloat(outstandingBalance.toFixed(2));
  
  // Determine status
  let status = 'UP_TO_DATE';
  if (rentStartStart > todayStart) {
    status = 'NOT_STARTED';
  } else if (totalPaidRounded === 0 && expectedTotal === 0) {
    status = 'NO_PAYMENTS_DUE';
  } else if (totalPaidRounded === 0 && expectedTotal > 0) {
    status = 'UNPAID';
  } else if (outstandingBalance > 0) {
    if (nextPaymentInfo.isOverdue) {
      status = 'OVERDUE';
    } else if (nextPaymentInfo.isInGracePeriod) {
      status = 'IN_GRACE_PERIOD';
    } else {
      status = 'PARTIALLY_PAID';
    }
  } else if (outstandingBalance < 0) {
    status = 'OVERPAID';
  } else {
    const hasPaidReport = nonCreditPayments.some(p => p.status === 'PAID');
    if (hasPaidReport && nextPaymentInfo.fullyPaidPeriods >= 1) {
      status = 'PAID';
    } else if (nextPaymentInfo.isOverdue) {
      status = 'OVERDUE';
    } else if (nextPaymentInfo.isInGracePeriod) {
      status = 'IN_GRACE_PERIOD';
    } else {
      status = 'UP_TO_DATE';
    }
  }
  
  const nextPaymentDate = nextPaymentInfo.nextDueDate;
  const gracePeriodEnd = nextPaymentInfo.gracePeriodEnd;
  
  // Calculate payment amount per period (without withholding tax for display)
  const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
  
  return {
    paymentPolicy: tenant.paymentPolicy,
    policyMonths,
    monthlyRent,
    paymentAmountPerPeriod: paymentAmount,
    totalDuePerPeriod: totalDuePerPeriod, // WITH withholding tax
    totalDueWithoutWithholding: totalDueWithoutWithholding, // WITHOUT withholding tax
    totalWithheld: totalWithheld, // Amount withheld for tax
    withholdingBreakdown: nextPaymentInfo.withholdingBreakdown,
    nextPayment: {
      dueDate: nextPaymentDate,
      dueDateFormatted: nextPaymentDate ? nextPaymentDate.toLocaleDateString() : null,
      dueDateTime: nextPaymentDate ? nextPaymentDate.toLocaleString() : null,
      amount: totalDuePerPeriod,
      isOverdue: nextPaymentInfo.isOverdue,
      isInGracePeriod: nextPaymentInfo.isInGracePeriod,
      timeRemaining: nextPaymentInfo.timeRemaining,
      paymentsBehind: nextPaymentInfo.paymentsBehind,
      gracePeriodEnd: gracePeriodEnd,
      gracePeriodEndFormatted: gracePeriodEnd ? gracePeriodEnd.toLocaleDateString() : null,
      fullyPaidPeriods: nextPaymentInfo.fullyPaidPeriods,
      remainingBalanceForNextPeriod: nextPaymentInfo.remainingBalanceForNextPeriod,
      carryOverAmount: nextPaymentInfo.carryOverAmount
    },
    currentPeriod: {
      ...currentPeriod,
      periodStartFormatted: currentPeriod.periodStart.toLocaleDateString(),
      periodEndFormatted: currentPeriod.periodEnd.toLocaleDateString()
    },
    paymentHistory: {
      totalPaid: totalPaidRounded,
      expectedTotal: Math.max(0, expectedTotal),
      outstandingBalance: rentStartStart > todayStart ? 0 : outstandingBalance,
      paymentsMade: nonCreditPayments.length,
      expectedPaymentsCount: Math.max(0, expectedPaymentsCount),
      lastPaymentDate: nextPaymentInfo.lastPaymentDate,
      lastPaymentDateFormatted: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleDateString() : null,
      lastPaymentDateTime: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleString() : null
    },
    status,
    isRentStarted: rentStartStart <= todayStart,
    rentStartDate: rentStartStart
  };
};