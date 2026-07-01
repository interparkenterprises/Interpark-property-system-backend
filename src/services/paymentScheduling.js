// services/paymentScheduling.js

import { calculateEscalatedRent, calculatePaymentByPolicy, calculateServiceCharge, calculateVAT } from './rentCalculation.js';

/**
 * Get policy months based on payment policy
 */
const getPolicyMonths = (paymentPolicy = 'MONTHLY') => {
  switch (paymentPolicy) {
    case 'QUARTERLY': return 3;
    case 'ANNUAL': return 12;
    default: return 1;
  }
};

/**
 * Add billing period while preserving the day of month (but setting time to end of day)
 * @param {Date} date - Starting date
 * @param {string} paymentPolicy - Payment policy
 * @returns {Date} - New date at end of day (11:59:59.999 PM)
 */
const addBillingPeriod = (date, paymentPolicy = 'MONTHLY') => {
  const newDate = new Date(date);
  const monthsToAdd = getPolicyMonths(paymentPolicy);
  
  // Get the original day of month
  const originalDay = date.getDate();
  
  // Add months
  newDate.setMonth(newDate.getMonth() + monthsToAdd);
  
  // Handle edge cases (e.g., Jan 31 + 1 month = March 3rd, should be March 31st)
  if (newDate.getDate() !== originalDay) {
    // Set to last day of the previous month
    newDate.setDate(0);
  }
  
  // Set to end of day (11:59:59.999 PM)
  newDate.setHours(23, 59, 59, 999);
  
  return newDate;
};

/**
 * Set a date to the end of day (11:59:59.999 PM)
 * @param {Date} date - The date to modify
 * @returns {Date} - Date set to end of day
 */
const setToEndOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(23, 59, 59, 999);
  return newDate;
};

/**
 * Set a date to the start of day (12:00:00.000 AM)
 * @param {Date} date - The date to modify
 * @returns {Date} - Date set to start of day
 */
const setToStartOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

/**
 * Get the month start date (first day of the month) for a given date
 * This is used to normalize payment periods for comparison
 */
const getMonthStart = (date) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Calculate the grace period end date for any payment policy
 * Grace period always ends on the 5th of the month at 11:59:59 PM
 * 
 * @param {Date} dueDate - The due date (1st of the month at end of day)
 * @param {string} paymentPolicy - MONTHLY, QUARTERLY, or ANNUAL
 * @param {Date} rentStartDate - The rent start date
 * @param {number} periodIndex - The index of the current period
 * @returns {Date} - Grace period end date (5th of the month at 11:59:59 PM)
 */
const calculateGracePeriodEnd = (dueDate, paymentPolicy, rentStartDate, periodIndex = 0) => {
  const policyMonths = getPolicyMonths(paymentPolicy);
  
  // For all payment policies, the grace period ends on the 5th of the month
  // that the payment period starts in
  let periodStartDate;
  
  if (paymentPolicy === 'MONTHLY') {
    // For monthly, the period start is the month of the due date
    periodStartDate = new Date(dueDate);
    periodStartDate.setDate(1);
  } else {
    // For quarterly/annual, calculate the period start based on rent start + period index
    periodStartDate = new Date(rentStartDate);
    periodStartDate.setMonth(periodStartDate.getMonth() + (periodIndex * policyMonths));
    periodStartDate.setDate(1);
  }
  
  // Set to the 5th of that month at 11:59:59 PM
  const graceEnd = new Date(
    periodStartDate.getFullYear(),
    periodStartDate.getMonth(),
    5,
    23, 59, 59, 999
  );
  
  // If the 5th falls before the due date (shouldn't happen for monthly),
  // but for safety, if due date is after the 5th, use the next month's 5th
  // This would only happen if there's a data issue
  if (graceEnd < dueDate) {
    graceEnd.setMonth(graceEnd.getMonth() + 1);
  }
  
  return graceEnd;
};

/**
 * Calculate the next payment due date based on payment history and policy
 * Due date is always the 1st of the month (at 11:59:59 PM) with grace period until the 5th
 */
export const calculateNextPaymentDue = (tenant, paymentReports = []) => {
  const { paymentPolicy, rentStart } = tenant;
  const today = new Date();
  const currentDateEndOfDay = setToEndOfDay(today);
  const rentStartDate = setToStartOfDay(new Date(rentStart));
  const policyMonths = getPolicyMonths(paymentPolicy);
  
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
      totalDuePerPeriod: 0,
      totalPaidAllPeriods: 0,
      fullyPaidPeriods: 0,
      remainingBalanceForNextPeriod: 0,
      carryOverAmount: 0
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
  const startDate = setToStartOfDay(new Date(rentStart));
  const monthsSinceStart = calculateMonthsDifference(startDate, today);
  const expectedPayments = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  
  // CRITICAL FIX: Use payment report's totalDue as the source of truth
  // Group payments by month and find the totalDue from the payment report
  const periodPayments = {};
  const periodTotalDue = {};
  let totalPaidAllPeriods = 0;
  
  // Only include non-CREDIT payments for period grouping
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
    
    // Store the totalDue from the payment report (this is the source of truth)
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
  
  // If there are legacy payments, add them to the first period
  if (legacyTotalPaid > 0) {
    const firstPeriodKey = getMonthStart(rentStartDate).toISOString();
    if (!periodPayments[firstPeriodKey]) {
      periodPayments[firstPeriodKey] = 0;
    }
    periodPayments[firstPeriodKey] += legacyTotalPaid;
    totalPaidAllPeriods += legacyTotalPaid;
  }
  
  // Calculate total due per period - use the value from payment report if available
  // Otherwise calculate it
  let totalDuePerPeriod = 0;
  
  // Try to get totalDue from payment reports first (source of truth)
  const periodKeys = Object.keys(periodTotalDue);
  if (periodKeys.length > 0) {
    // Use the first period's totalDue as the base
    totalDuePerPeriod = periodTotalDue[periodKeys[0]];
  }
  
  // If no totalDue found in payment reports, calculate it
  if (totalDuePerPeriod === 0) {
    const monthlyRent = calculateEscalatedRent(tenant).currentRent;
    const rentPaymentByPolicy = calculatePaymentByPolicy(monthlyRent, paymentPolicy);
    const vatOnRent = calculateVAT(rentPaymentByPolicy, tenant.vatType, tenant.vatRate);
    const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
    const serviceChargeTotalByPolicy = serviceChargeDetails.totalWithVat * getPolicyMonths(paymentPolicy);
    totalDuePerPeriod = rentPaymentByPolicy + vatOnRent + serviceChargeTotalByPolicy;
  }
  
  // Round to 2 decimal places to avoid floating point issues
  totalDuePerPeriod = parseFloat(totalDuePerPeriod.toFixed(2));
  
  // Calculate how many periods have elapsed since rent start
  const periodsSinceStart = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  
  // Build periods using month start dates for consistency
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
      remainingBalance: totalDuePerPeriod
    });
  }
  
  // Process periods sequentially, carrying over overpayments
  let carryOverAmount = 0;
  let fullyPaidPeriods = 0;
  let firstUnpaidPeriodIndex = -1;
  
  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    
    const totalAvailable = period.amountPaid + carryOverAmount;
    
    if (totalAvailable >= totalDuePerPeriod) {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      carryOverAmount = totalAvailable - totalDuePerPeriod;
      fullyPaidPeriods++;
    } else {
      period.isFullyPaid = false;
      period.remainingBalance = totalDuePerPeriod - totalAvailable;
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
  
  // Find the first period that is not fully paid
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
  
  // =============================================
  // GRACE PERIOD IMPLEMENTATION FOR ALL PAYMENT POLICIES
  // Rent is due on the 1st of the month (at 11:59:59 PM)
  // Grace period extends until the 5th of the month (at 11:59:59 PM)
  // Overdue starts from the 6th of the month
  // =============================================
  
  // Calculate grace period end using the helper function
  const gracePeriodEnd = calculateGracePeriodEnd(
    nextDueDate, 
    paymentPolicy, 
    rentStartDate, 
    nextPeriodIndex
  );
  
  // Determine if the payment is in grace period or overdue
  const currentDateMidnight = setToStartOfDay(today);
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  const dueDateMidnight = setToStartOfDay(nextDueDate);
  
  // Overdue if current date is strictly after grace period end date
  const isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  
  // Check if currently in grace period (after due date but before grace period end)
  const isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;
  
  // Calculate time remaining with grace period consideration
  let timeRemaining;
  if (isOverdue) {
    // Calculate how many days overdue past the grace period
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
    // Calculate days remaining in grace period
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
    // Regular time remaining until due date
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
    totalDuePerPeriod,
    totalPaidAllPeriods,
    fullyPaidPeriods,
    remainingBalanceForNextPeriod,
    carryOverAmount,
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
      totalDuePerPeriod,
      periodsSinceStart
    }
  };
};

/**
 * Calculate if a payment is overdue (with grace period)
 * Payment is overdue if current date is after the grace period end date (5th of the month)
 * @param {Date} dueDate - The due date (1st of the month at end of day)
 * @param {Date} currentDate - Current date (set to end of day)
 * @param {string} paymentPolicy - Payment policy
 * @param {Date} rentStartDate - Rent start date
 * @param {number} periodIndex - The current period index
 * @returns {Object} - Overdue status with grace period info
 */
export const calculateOverdueStatus = (dueDate, currentDate, paymentPolicy, rentStartDate, periodIndex = 0) => {
  const dueDateMidnight = setToStartOfDay(dueDate);
  const currentDateMidnight = setToStartOfDay(currentDate);
  
  // Calculate grace period end using the helper
  const gracePeriodEnd = calculateGracePeriodEnd(dueDate, paymentPolicy, rentStartDate, periodIndex);
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  
  // Overdue if current date is strictly after grace period end date
  const isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  
  // Check if in grace period (after due date but before grace period end)
  const isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;
  
  // Calculate days into grace period or overdue
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
 * Calculate the current billing period based on date and payment policy
 * @param {Date} date - The date to check
 * @param {Object} tenant - Tenant object
 * @returns {Object} - Current billing period info
 */
export const getCurrentBillingPeriod = (date, tenant) => {
  const { paymentPolicy, rentStart } = tenant;
  const policyMonths = getPolicyMonths(paymentPolicy);
  const startDate = setToStartOfDay(new Date(rentStart));
  const checkDate = setToStartOfDay(date);
  
  // If rent hasn't started yet, return a "pending" period
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
  
  // Calculate which billing period we're in
  const monthsSinceStart = calculateMonthsDifference(startDate, checkDate);
  const periodNumber = Math.floor(monthsSinceStart / policyMonths);
  
  // Calculate period start and end dates
  let periodStart = new Date(startDate);
  if (periodNumber > 0) {
    periodStart = addBillingPeriod(startDate, paymentPolicy);
    for (let i = 1; i < periodNumber; i++) {
      periodStart = addBillingPeriod(periodStart, paymentPolicy);
    }
  }
  periodStart = setToStartOfDay(periodStart);
  
  // Calculate period end (end of the last day of the period)
  const periodEnd = addBillingPeriod(periodStart, paymentPolicy);
  
  // Calculate days remaining in period (from current date to period end)
  const daysRemaining = calculateDaysRemaining(date, periodEnd);
  
  // Calculate progress through period (percentage)
  const periodLength = getPolicyMonths(paymentPolicy) * 30.44; // average days per month
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
 * Calculate time remaining until a due date
 * @param {Date} dueDate - The due date (end of day)
 * @param {Date} currentDate - Current date (end of day)
 * @returns {Object} - Time remaining in various units
 */
export const calculateTimeRemaining = (dueDate, currentDate = new Date()) => {
  // Set both dates to end of day for accurate comparison
  const dueDateEnd = setToEndOfDay(dueDate);
  const currentDateEnd = setToEndOfDay(currentDate);
  
  const diffTime = dueDateEnd - currentDateEnd;
  
  if (diffTime < 0) {
    // Calculate how many days overdue
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
 * Calculate days remaining until a specific date
 * @param {Date} currentDate - Current date
 * @param {Date} endDate - End date (set to end of day)
 * @returns {number} - Days remaining
 */
const calculateDaysRemaining = (currentDate, endDate) => {
  const currentStart = setToStartOfDay(currentDate);
  const endStart = setToStartOfDay(endDate);
  const diffTime = endStart - currentStart;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Calculate months between two dates with decimal precision
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @returns {number}
 */
const calculateMonthsDifference = (startDate, endDate) => {
  // If start date is in the future, return 0
  if (startDate > endDate) {
    return 0;
  }
  
  const years = endDate.getFullYear() - startDate.getFullYear();
  const months = endDate.getMonth() - startDate.getMonth();
  const days = endDate.getDate() - startDate.getDate();
  
  // Calculate fractional month based on days
  const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
  const fractionalMonth = days / daysInMonth;
  
  return (years * 12) + months + fractionalMonth;
};

/**
 * Get payment summary for a tenant
 * @param {Object} tenant - Tenant object with paymentReports
 * @returns {Object} - Complete payment summary
 */
export const getPaymentSummary = (tenant) => {
  const paymentReports = tenant.paymentReports || [];
  const monthlyRent = calculateEscalatedRent(tenant).currentRent;
  const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
  
  // Get the next payment info which includes totalDuePerPeriod
  const nextPaymentInfo = calculateNextPaymentDue(tenant, paymentReports);
  const currentPeriod = getCurrentBillingPeriod(new Date(), tenant);
  
  // Calculate total paid (excluding CREDIT records)
  const nonCreditPayments = paymentReports.filter(p => p.status !== 'CREDIT');
  const totalPaid = nonCreditPayments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const policyMonths = getPolicyMonths(tenant.paymentPolicy);
  
  // CRITICAL FIX: Use the FULL total due per period from nextPaymentInfo
  const totalDuePerPeriod = nextPaymentInfo.totalDuePerPeriod || paymentAmount;
  
  // Calculate expected total based on number of periods that should have been paid
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
    
    expectedTotal = expectedPaymentsCount * totalDuePerPeriod;
  } else {
    expectedPaymentsCount = 0;
    expectedTotal = 0;
  }
  
  // Round expectedTotal to avoid floating point issues
  expectedTotal = parseFloat(expectedTotal.toFixed(2));
  const totalPaidRounded = parseFloat(totalPaid.toFixed(2));
  
  // Calculate outstanding balance
  let outstandingBalance = expectedTotal - totalPaidRounded;
  
  // Round to 2 decimal places
  outstandingBalance = parseFloat(outstandingBalance.toFixed(2));
  
  // Determine status with proper logic using FULL amounts
  let status = 'UP_TO_DATE';
  if (rentStartStart > todayStart) {
    status = 'NOT_STARTED';
  } else if (totalPaidRounded === 0 && expectedTotal === 0) {
    status = 'NO_PAYMENTS_DUE';
  } else if (totalPaidRounded === 0 && expectedTotal > 0) {
    status = 'UNPAID';
  } else if (outstandingBalance > 0) {
    // Check if in grace period before marking as overdue
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
    // All payments are up to date - check if there's a PAID status payment report
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
  
  // Get next payment period
  const nextPaymentDate = nextPaymentInfo.nextDueDate;
  const gracePeriodEnd = nextPaymentInfo.gracePeriodEnd;
  const nextPaymentPeriod = nextPaymentDate ? getCurrentBillingPeriod(nextPaymentDate, tenant) : null;
  
  return {
    paymentPolicy: tenant.paymentPolicy,
    policyMonths,
    monthlyRent,
    paymentAmountPerPeriod: paymentAmount,
    totalDuePerPeriod: totalDuePerPeriod,
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