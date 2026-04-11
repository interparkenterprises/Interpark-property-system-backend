import { calculateEscalatedRent, calculatePaymentByPolicy } from './rentCalculation.js';

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
 * Calculate the next payment due date based on payment history and policy
 * Due date is always at the end of the day (11:59:59 PM)
 * @param {Object} tenant - Tenant object
 * @param {Array} paymentReports - Array of payment reports (optional)
 * @returns {Object} - Next payment due date and related info
 */
export const calculateNextPaymentDue = (tenant, paymentReports = []) => {
  const { paymentPolicy, rentStart } = tenant;
  const today = new Date();
  const currentDateEndOfDay = setToEndOfDay(today);
  const rentStartDate = setToStartOfDay(new Date(rentStart));
  
  // If rent hasn't started yet, next due date is rent start date
  if (rentStartDate > currentDateEndOfDay) {
    return {
      nextDueDate: setToEndOfDay(rentStartDate),
      isOverdue: false,
      paymentsBehind: 0,
      paymentsMade: paymentReports.length,
      expectedPayments: 0,
      lastPaymentDate: paymentReports.length > 0 ? new Date(paymentReports[paymentReports.length - 1].datePaid) : null,
      timeRemaining: calculateTimeRemaining(setToEndOfDay(rentStartDate), currentDateEndOfDay)
    };
  }
  
  // Sort payments by date (oldest to newest)
  const sortedPayments = [...paymentReports].sort((a, b) => new Date(a.datePaid) - new Date(b.datePaid));
  
  let nextDueDate = null;
  let lastPaymentDate = null;
  let paymentsMade = 0;
  
  // Get the most recent payment
  if (sortedPayments.length > 0) {
    lastPaymentDate = new Date(sortedPayments[sortedPayments.length - 1].datePaid);
    paymentsMade = sortedPayments.length;
  }
  
  // Get policy months
  const policyMonths = getPolicyMonths(paymentPolicy);
  
  // Calculate expected number of payments by now
  const startDate = setToStartOfDay(new Date(rentStart));
  const monthsSinceStart = calculateMonthsDifference(startDate, today);
  const expectedPayments = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  
  // Determine if payments are up to date
  const paymentsBehind = Math.max(0, expectedPayments - paymentsMade);
  
  if (paymentsBehind > 0) {
    // Tenant is behind, next due date is based on last payment
    if (lastPaymentDate) {
      nextDueDate = addBillingPeriod(lastPaymentDate, paymentPolicy);
    } else {
      // No payments made yet, use rent start date (set to end of day)
      nextDueDate = setToEndOfDay(new Date(rentStart));
    }
  } else {
    // Up to date, next due date is from the last payment or start date
    if (lastPaymentDate) {
      nextDueDate = addBillingPeriod(lastPaymentDate, paymentPolicy);
    } else {
      nextDueDate = setToEndOfDay(new Date(rentStart));
    }
  }
  
  // Check if overdue (compare dates only, not time)
  const isOverdue = calculateIfOverdue(nextDueDate, currentDateEndOfDay);
  
  // Calculate time remaining
  const timeRemaining = calculateTimeRemaining(nextDueDate, currentDateEndOfDay);
  
  return {
    nextDueDate,
    isOverdue,
    paymentsBehind,
    paymentsMade,
    expectedPayments,
    lastPaymentDate,
    timeRemaining
  };
};

/**
 * Calculate if a payment is overdue
 * Payment is overdue if current date is after the due date
 * (Tenant has until end of due date to pay)
 * @param {Date} dueDate - The due date (set to end of day)
 * @param {Date} currentDate - Current date (set to end of day)
 * @returns {boolean}
 */
const calculateIfOverdue = (dueDate, currentDate) => {
  // Compare dates by resetting to midnight and comparing
  const dueDateMidnight = setToStartOfDay(dueDate);
  const currentDateMidnight = setToStartOfDay(currentDate);
  
  // If current date is strictly after due date, it's overdue
  return currentDateMidnight > dueDateMidnight;
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
  const nextPaymentInfo = calculateNextPaymentDue(tenant, paymentReports);
  const currentPeriod = getCurrentBillingPeriod(new Date(), tenant);
  
  // Calculate total paid and outstanding
  const totalPaid = paymentReports.reduce((sum, payment) => sum + payment.amount, 0);
  const policyMonths = getPolicyMonths(tenant.paymentPolicy);
  
  // FIX: Only calculate expected payments if rent start date is in the past
  const rentStartDate = new Date(tenant.rentStart);
  const today = new Date();
  let expectedPaymentsCount = 0;
  let expectedTotal = 0;
  
  if (rentStartDate <= today) {
    // Rent has started, calculate normally
    const monthsSinceStart = calculateMonthsDifference(rentStartDate, today);
    expectedPaymentsCount = Math.floor(monthsSinceStart / policyMonths);
    expectedTotal = expectedPaymentsCount * paymentAmount;
  } else {
    // Rent hasn't started yet, no payments expected
    expectedPaymentsCount = 0;
    expectedTotal = 0;
  }
  
  const outstandingBalance = expectedTotal - totalPaid;
  
  // Determine status with proper logic
  let status = 'UP_TO_DATE';
  if (rentStartDate > today) {
    // Rent hasn't started yet
    status = 'NOT_STARTED';
  } else if (totalPaid === 0 && expectedTotal === 0) {
    status = 'NO_PAYMENTS_DUE';
  } else if (totalPaid === 0 && expectedTotal > 0) {
    status = 'UNPAID';
  } else if (outstandingBalance > 0) {
    status = 'PARTIALLY_PAID';
  } else if (outstandingBalance < 0) {
    status = 'OVERPAID';
  } else if (nextPaymentInfo.isOverdue) {
    status = 'OVERDUE';
  } else {
    status = 'UP_TO_DATE';
  }
  
  // Get next payment period
  const nextPaymentDate = nextPaymentInfo.nextDueDate;
  const nextPaymentPeriod = nextPaymentDate ? getCurrentBillingPeriod(nextPaymentDate, tenant) : null;
  
  // Calculate grace period info
  const gracePeriodDays = 0;
  const gracePeriodEnd = nextPaymentDate ? new Date(nextPaymentDate) : null;
  if (gracePeriodEnd && gracePeriodDays > 0) {
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
    gracePeriodEnd.setHours(23, 59, 59, 999);
  }
  
  return {
    paymentPolicy: tenant.paymentPolicy,
    policyMonths,
    monthlyRent,
    paymentAmountPerPeriod: paymentAmount,
    nextPayment: {
      dueDate: nextPaymentDate,
      dueDateFormatted: nextPaymentDate ? nextPaymentDate.toLocaleDateString() : null,
      dueDateTime: nextPaymentDate ? nextPaymentDate.toLocaleString() : null,
      amount: paymentAmount,
      isOverdue: nextPaymentInfo.isOverdue,
      timeRemaining: nextPaymentInfo.timeRemaining,
      paymentsBehind: nextPaymentInfo.paymentsBehind,
      gracePeriodEnd: gracePeriodEnd,
      gracePeriodEndFormatted: gracePeriodEnd ? gracePeriodEnd.toLocaleDateString() : null
    },
    currentPeriod: {
      ...currentPeriod,
      periodStartFormatted: currentPeriod.periodStart.toLocaleDateString(),
      periodEndFormatted: currentPeriod.periodEnd.toLocaleDateString()
    },
    paymentHistory: {
      totalPaid,
      expectedTotal: Math.max(0, expectedTotal),
      outstandingBalance: rentStartDate > today ? 0 : outstandingBalance,
      paymentsMade: paymentReports.length,
      expectedPaymentsCount: Math.max(0, expectedPaymentsCount),
      lastPaymentDate: nextPaymentInfo.lastPaymentDate,
      lastPaymentDateFormatted: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleDateString() : null,
      lastPaymentDateTime: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleString() : null
    },
    status,
    isRentStarted: rentStartDate <= today,
    rentStartDate: rentStartDate
  };
};