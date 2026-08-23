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
 * UPDATED: Now checks invoice status for accurate outstanding balance
 * and handles prepaid periods correctly
 */
export const calculateNextPaymentDue = (tenant, paymentReports = []) => {
  const { paymentPolicy, rentStart } = tenant;
  const today = new Date();
  const currentDateEndOfDay = setToEndOfDay(today);
  const rentStartDate = setToStartOfDay(new Date(rentStart));
  const policyMonths = getPolicyMonths(paymentPolicy);
  
  const rentInfo = calculateEscalatedRent(tenant);
  const monthlyRent = rentInfo.currentRent;
  
  const totalDueResult = calculateTotalDuePerPeriodWithWithholding(tenant, monthlyRent, paymentPolicy);
  const totalDuePerPeriod = totalDueResult.totalDueWithWithholding;
  const totalDueWithoutWithholding = totalDueResult.totalDueWithoutWithholding;
  const totalWithheld = totalDueResult.totalWithheld;
  
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
      isRentStarted: false,
      actualOutstandingBalance: 0,
      prepaidPeriods: [],
      invoiceSummary: {
        totalOutstanding: 0,
        unpaidCount: 0,
        partialCount: 0,
        paidCount: 0,
        totalCount: 0
      }
    };
  }
  
  const sortedPayments = [...paymentReports].sort((a, b) => new Date(a.datePaid) - new Date(b.datePaid));
  let lastPaymentDate = null;
  let paymentsMade = 0;
  
  const nonCreditPayments = sortedPayments.filter(p => p.status !== 'CREDIT');
  if (nonCreditPayments.length > 0) {
    lastPaymentDate = new Date(nonCreditPayments[nonCreditPayments.length - 1].datePaid);
    paymentsMade = nonCreditPayments.length;
  }
  
  const invoices = tenant.invoices || [];
  
  // =============================================
  // FIXED: Identify prepaid periods
  // =============================================
  const prepaidReports = nonCreditPayments.filter(p => p.status === 'PREPAID');
  const prepaidPeriods = new Set();
  
  for (const prepaid of prepaidReports) {
    if (prepaid.paymentPeriod) {
      try {
        const periodDate = new Date(prepaid.paymentPeriod);
        if (!isNaN(periodDate.getTime())) {
          const periodKey = getMonthStart(periodDate).toISOString();
          prepaidPeriods.add(periodKey);
        }
      } catch (e) {
        // Ignore
      }
    }
  }
  
  // =============================================
  // FIXED: Build invoice period map
  // =============================================
  let totalOutstandingFromInvoices = 0;
  let unpaidInvoicesCount = 0;
  let partialInvoicesCount = 0;
  let paidInvoicesCount = 0;
  let invoicePeriods = {};
  
  for (const invoice of invoices) {
    // Parse the payment period string
    let periodKey = null;
    if (invoice.paymentPeriod) {
      try {
        const periodDate = new Date(invoice.paymentPeriod + " 1");
        if (!isNaN(periodDate.getTime())) {
          periodKey = periodDate.toISOString().slice(0, 7);
        } else {
          const fallbackDate = new Date(invoice.paymentPeriod);
          if (!isNaN(fallbackDate.getTime())) {
            periodKey = fallbackDate.toISOString().slice(0, 7);
          }
        }
      } catch (e) {
        try {
          const fallbackDate = new Date(invoice.paymentPeriod);
          if (!isNaN(fallbackDate.getTime())) {
            periodKey = fallbackDate.toISOString().slice(0, 7);
          }
        } catch (e2) {
          console.warn(`Could not parse paymentPeriod: ${invoice.paymentPeriod}`);
        }
      }
    }
    
    // =============================================
    // FIXED: Skip invoices for prepaid periods when calculating outstanding
    // =============================================
    const isPrepaidPeriod = periodKey && prepaidPeriods.has(periodKey);
    
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
          isPrepaid: isPrepaidPeriod
        };
      }
      continue;
    } else if (invoice.status === 'PARTIAL') {
      // Only count partial invoices that actually have a balance
      const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
      
      if (isPrepaidPeriod) {
        // Prepaid period - treat as paid regardless of status
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: true
          };
        }
        continue;
      }
      
      if (balance <= 0.01) {
        // Balance is effectively zero, treat as paid
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: false
          };
        }
      } else {
        partialInvoicesCount++;
        totalOutstandingFromInvoices += balance;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.amountPaid,
            balance: balance,
            status: 'PARTIAL',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: false,
            isPrepaid: false
          };
        }
      }
    } else if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
      if (isPrepaidPeriod) {
        // Prepaid period - treat as paid regardless of status
        paidInvoicesCount++;
        if (periodKey) {
          invoicePeriods[periodKey] = {
            totalDue: invoice.totalDue,
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentPeriod: invoice.paymentPeriod,
            isFullyPaid: true,
            isPrepaid: true
          };
        }
        continue;
      }
      
      // Check if this is a future period that shouldn't be counted yet
      let isFuturePeriod = false;
      if (periodKey) {
        const periodDate = new Date(periodKey);
        const todayStart = setToStartOfDay(today);
        if (periodDate > todayStart) {
          isFuturePeriod = true;
        }
      }
      
      if (isFuturePeriod) {
        // Future period - don't count as outstanding yet
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
            isFuture: true
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
            isFuture: false
          };
        }
      }
    }
  }
  
  const monthsSinceStart = calculateMonthsDifference(rentStartDate, today);
  const expectedPayments = Math.max(0, Math.floor(monthsSinceStart / policyMonths));
  
  // =============================================
  // FIXED: Process payment periods
  // =============================================
  const periodPayments = {};
  const periodTotalDue = {};
  let totalPaidAllPeriods = 0;
  
  const paymentPeriods = nonCreditPayments.filter(p => p.paymentPeriod && p.status !== 'PREPAID');
  
  paymentPeriods.forEach(payment => {
    let periodKey = null;
    if (payment.paymentPeriod) {
      try {
        const paymentDate = new Date(payment.paymentPeriod + " 1");
        if (!isNaN(paymentDate.getTime())) {
          const monthStart = getMonthStart(paymentDate);
          periodKey = monthStart.toISOString();
        }
      } catch (e) {
        try {
          const paymentDate = new Date(payment.paymentPeriod);
          if (!isNaN(paymentDate.getTime())) {
            const monthStart = getMonthStart(paymentDate);
            periodKey = monthStart.toISOString();
          }
        } catch (e2) {
          // Ignore
        }
      }
    }
    
    if (periodKey) {
      if (!periodPayments[periodKey]) {
        periodPayments[periodKey] = 0;
      }
      periodPayments[periodKey] += payment.amountPaid || 0;
      totalPaidAllPeriods += payment.amountPaid || 0;
      
      if (payment.totalDue && !periodTotalDue[periodKey]) {
        periodTotalDue[periodKey] = parseFloat(payment.totalDue.toFixed(2));
      }
    }
  });
  
  // Handle payments without period (legacy)
  const paymentsWithoutPeriod = nonCreditPayments.filter(p => !p.paymentPeriod || p.status === 'PREPAID');
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
  
  // Build all periods and determine which are fully paid
  for (let i = 0; i < totalPeriodsToCheck; i++) {
    const periodDate = new Date(rentStartDate);
    periodDate.setMonth(periodDate.getMonth() + (i * policyMonths));
    const periodMonthStart = getMonthStart(periodDate);
    const periodKey = periodMonthStart.toISOString();
    
    const periodEnd = new Date(periodMonthStart);
    periodEnd.setMonth(periodEnd.getMonth() + policyMonths);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodEnd.setHours(23, 59, 59, 999);
    
    const periodMonthKey = periodMonthStart.toISOString().slice(0, 7);
    const invoiceForPeriod = invoicePeriods[periodMonthKey];
    
    // =============================================
    // FIXED: Check if this period is prepaid
    // =============================================
    const isPrepaid = prepaidPeriods.has(periodKey);
    
    let amountPaid = periodPayments[periodKey] || 0;
    let isFullyPaid = false;
    let remainingBalance = actualTotalDuePerPeriod;
    
    if (isPrepaid) {
      // Prepaid period - fully paid
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
    } else if (invoiceForPeriod && (invoiceForPeriod.status === 'UNPAID' || invoiceForPeriod.status === 'OVERDUE')) {
      if (amountPaid >= invoiceForPeriod.totalDue) {
        isFullyPaid = true;
        remainingBalance = 0;
        amountPaid = invoiceForPeriod.totalDue;
      } else {
        isFullyPaid = false;
        remainingBalance = invoiceForPeriod.totalDue - amountPaid;
      }
    } else {
      // No invoice for this period - check if payments cover it
      if (amountPaid >= actualTotalDuePerPeriod) {
        isFullyPaid = true;
        remainingBalance = 0;
      } else {
        remainingBalance = actualTotalDuePerPeriod - amountPaid;
      }
    }
    
    // Round to avoid floating point issues
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
      amountPaid: amountPaid,
      isFullyPaid: isFullyPaid,
      remainingBalance: remainingBalance,
      hasInvoice: !!invoiceForPeriod,
      invoiceStatus: invoiceForPeriod?.status || null,
      isPrepaid: isPrepaid
    });
  }
  
  // Process periods and carry over payments
  let carryOverAmount = 0;
  let fullyPaidPeriods = 0;
  let firstUnpaidPeriodIndex = -1;
  
  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    
    // If prepaid, it's fully paid
    if (period.isPrepaid) {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      fullyPaidPeriods++;
      continue;
    }
    
    // If there's a PAID invoice, it's fully paid
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') {
      period.isFullyPaid = true;
      period.remainingBalance = 0;
      fullyPaidPeriods++;
      continue;
    }
    
    // If already marked as fully paid, count it
    if (period.isFullyPaid) {
      fullyPaidPeriods++;
      continue;
    }
    
    // Check if payments cover this period
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
      if (firstUnpaidPeriodIndex === -1) {
        firstUnpaidPeriodIndex = i;
      }
    }
  }
  
  // =============================================
  // FIXED: Calculate payments behind (excluding prepaid)
  // =============================================
  let paymentsBehind = 0;
  const periodsToCheck = Math.min(periodsSinceStart, allPeriods.length);
  
  for (let i = 0; i < periodsToCheck; i++) {
    const period = allPeriods[i];
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    
    // Skip prepaid periods
    if (period.isPrepaid) {
      continue;
    }
    
    // If there's a PAID invoice, it's not behind
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') {
      continue;
    }
    
    if (!period.isFullyPaid) {
      paymentsBehind++;
    }
  }
  
  // =============================================
  // FIXED: Determine the next due date
  // =============================================
  let nextDueDate;
  let nextPeriodIndex = 0;
  let foundUnpaid = false;
  
  // Find the first unpaid period (excluding prepaid)
  for (let i = 0; i < allPeriods.length; i++) {
    const period = allPeriods[i];
    const invoiceForPeriod = invoicePeriods[period.monthKey];
    
    // Skip prepaid periods
    if (period.isPrepaid) {
      continue;
    }
    
    // Skip periods with PAID invoices
    if (invoiceForPeriod && invoiceForPeriod.status === 'PAID') {
      continue;
    }
    
    if (!period.isFullyPaid) {
      nextPeriodIndex = i;
      foundUnpaid = true;
      break;
    }
  }
  
  // If no unpaid period found, the next due date is the next period after the last fully paid period
  if (!foundUnpaid) {
    const nextDate = new Date(rentStartDate);
    const fullyPaidCount = fullyPaidPeriods;
    nextDate.setMonth(nextDate.getMonth() + (fullyPaidCount * policyMonths));
    nextDueDate = setToEndOfDay(nextDate);
  } else {
    const nextDate = new Date(rentStartDate);
    nextDate.setMonth(nextDate.getMonth() + (nextPeriodIndex * policyMonths));
    nextDueDate = setToEndOfDay(nextDate);
  }
  
  // =============================================
  // FIXED: Determine if the tenant is overdue (excluding prepaid)
  // =============================================
  let isOverdue = false;
  let isInGracePeriod = false;
  let gracePeriodEnd = null;
  
  const currentDateMidnight = setToStartOfDay(today);
  const dueDateMidnight = setToStartOfDay(nextDueDate);
  
  // Calculate grace period end for the next due date
  gracePeriodEnd = calculateGracePeriodEnd(
    nextDueDate,
    paymentPolicy,
    rentStartDate,
    nextPeriodIndex
  );
  
  const gracePeriodEndMidnight = setToStartOfDay(gracePeriodEnd);
  
  // Check if the current date is past the grace period end
  isOverdue = currentDateMidnight > gracePeriodEndMidnight;
  isInGracePeriod = !isOverdue && currentDateMidnight > dueDateMidnight;
  
  // =============================================
  // FIXED: Calculate the ACTUAL outstanding balance (excluding prepaid)
  // =============================================
  let actualOutstandingBalance = 0;
  
  // Add up balances from invoices that are NOT for prepaid periods
  for (const invoice of invoices) {
    let periodKey = null;
    if (invoice.paymentPeriod) {
      try {
        const periodDate = new Date(invoice.paymentPeriod + " 1");
        if (!isNaN(periodDate.getTime())) {
          periodKey = getMonthStart(periodDate).toISOString();
        }
      } catch (e) {
        // Ignore
      }
    }
    
    // Skip if this invoice is for a prepaid period
    if (periodKey && prepaidPeriods.has(periodKey)) {
      continue;
    }
    
    // Skip paid invoices
    if (invoice.status === 'PAID') {
      continue;
    }
    
    // For partial invoices, add the balance
    if (invoice.status === 'PARTIAL') {
      const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
      if (balance > 0.01) {
        actualOutstandingBalance += balance;
      }
    }
    
    // For unpaid invoices, add the total due (only if not future)
    if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
      // Check if this is a future period
      let isFuturePeriod = false;
      if (periodKey) {
        const periodDate = new Date(periodKey);
        const todayStart = setToStartOfDay(today);
        if (periodDate > todayStart) {
          isFuturePeriod = true;
        }
      }
      
      if (!isFuturePeriod) {
        actualOutstandingBalance += invoice.totalDue;
      }
    }
  }
  
  // Round the outstanding balance
  actualOutstandingBalance = parseFloat(actualOutstandingBalance.toFixed(2));
  if (Math.abs(actualOutstandingBalance) < 0.01) {
    actualOutstandingBalance = 0;
  }
  
  // =============================================
  // Calculate time remaining
  // =============================================
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
  if (foundUnpaid && nextPeriodIndex < allPeriods.length) {
    remainingBalanceForNextPeriod = allPeriods[nextPeriodIndex].remainingBalance;
  } else {
    remainingBalanceForNextPeriod = 0;
  }
  
  // =============================================
  // Return the corrected payment info
  // =============================================
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
    // FIXED: Include the corrected outstanding balance
    actualOutstandingBalance: actualOutstandingBalance,
    prepaidPeriods: Array.from(prepaidPeriods),
    invoiceSummary: {
      totalOutstanding: parseFloat(totalOutstandingFromInvoices.toFixed(2)),
      unpaidCount: unpaidInvoicesCount,
      partialCount: partialInvoicesCount,
      paidCount: paidInvoicesCount,
      totalCount: invoices.length
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
 * Get payment summary for a tenant (UPDATED - properly handles PAID invoices and prepaid periods)
 */
export const getPaymentSummary = (tenant) => {
  const paymentReports = tenant.paymentReports || [];
  const invoices = tenant.invoices || [];
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
  
  // =============================================
  // FIXED: Use the ACTUAL outstanding balance from nextPaymentInfo
  // =============================================
  const outstandingBalance = nextPaymentInfo.actualOutstandingBalance || 0;
  
  // =============================================
  // FIXED: Calculate from INVOICES (source of truth)
  // =============================================
  let totalExpectedFromInvoices = 0;
  let totalPaidFromInvoices = 0;
  let fullyPaidInvoices = 0;
  let partialInvoices = 0;
  let unpaidInvoices = 0;
  let overdueInvoices = 0;
  
  const today = new Date();
  const todayStart = setToStartOfDay(today);
  
  for (const invoice of invoices) {
    // Use invoice's own tracking (most accurate)
    const invoiceTotal = invoice.totalDue || 0;
    const invoicePaid = invoice.amountPaid || 0;
    const invoiceBalance = invoice.balance || (invoiceTotal - invoicePaid);
    
    totalExpectedFromInvoices += invoiceTotal;
    totalPaidFromInvoices += invoicePaid;
    
    if (invoice.status === 'PAID') {
      fullyPaidInvoices++;
      continue;
    } else if (invoice.status === 'PARTIAL') {
      partialInvoices++;
      // Only count as outstanding if balance > 0.01
      if (invoiceBalance > 0.01) {
        // Check if this invoice is for a prepaid period
        let isPrepaid = false;
        if (invoice.paymentPeriod) {
          try {
            const periodDate = new Date(invoice.paymentPeriod + " 1");
            if (!isNaN(periodDate.getTime())) {
              const periodKey = getMonthStart(periodDate).toISOString();
              if (nextPaymentInfo.prepaidPeriods && 
                  nextPaymentInfo.prepaidPeriods.includes(periodKey)) {
                isPrepaid = true;
              }
            }
          } catch (e) {
            // Ignore
          }
        }
        
        if (!isPrepaid && new Date(invoice.dueDate) < today) {
          overdueInvoices++;
        }
      } else {
        // Balance is effectively zero, treat as paid
        fullyPaidInvoices++;
      }
    } else if (invoice.status === 'UNPAID') {
      unpaidInvoices++;
      
      // Check if this is a prepaid period
      let isPrepaid = false;
      if (invoice.paymentPeriod) {
        try {
          const periodDate = new Date(invoice.paymentPeriod + " 1");
          if (!isNaN(periodDate.getTime())) {
            const periodKey = getMonthStart(periodDate).toISOString();
            if (nextPaymentInfo.prepaidPeriods && 
                nextPaymentInfo.prepaidPeriods.includes(periodKey)) {
              isPrepaid = true;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
      
      if (!isPrepaid && new Date(invoice.dueDate) < today) {
        overdueInvoices++;
      }
    } else if (invoice.status === 'OVERDUE') {
      overdueInvoices++;
    }
  }
  
  // =============================================
  // FIXED: Determine status
  // =============================================
  let status = 'UP_TO_DATE';
  const rentStartStart = setToStartOfDay(new Date(tenant.rentStart));
  
  if (rentStartStart > todayStart) {
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
  
  // =============================================
  // FIXED: Check for "final paid" payment reports
  // =============================================
  const finalPaidReports = [];
  for (const report of paymentReports) {
    if (report.status === 'PARTIAL') {
      // Check if all linked invoices are fully paid
      const linkedInvoices = invoices.filter(inv => inv.paymentReportId === report.id);
      if (linkedInvoices.length > 0) {
        const allFullyPaid = linkedInvoices.every(inv => inv.status === 'PAID');
        if (allFullyPaid) {
          finalPaidReports.push({
            id: report.id,
            amountPaid: report.amountPaid,
            status: report.status,
            effectiveStatus: 'PAID'
          });
        }
      }
    }
  }
  
  // =============================================
  // Build the final summary
  // =============================================
  return {
    paymentPolicy: tenant.paymentPolicy,
    policyMonths,
    monthlyRent,
    paymentAmountPerPeriod: calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy),
    totalDuePerPeriod: totalDuePerPeriod,
    totalDueWithoutWithholding: totalDueWithoutWithholding,
    totalWithheld: totalWithheld,
    withholdingBreakdown: nextPaymentInfo.withholdingBreakdown,
    invoiceStatus: {
      fullyPaid: fullyPaidInvoices,
      partial: partialInvoices,
      unpaid: unpaidInvoices,
      overdue: overdueInvoices,
      total: invoices.length
    },
    nextPayment: {
      dueDate: nextPaymentInfo.nextDueDate,
      dueDateFormatted: nextPaymentInfo.nextDueDate ? nextPaymentInfo.nextDueDate.toLocaleDateString() : null,
      dueDateTime: nextPaymentInfo.nextDueDate ? nextPaymentInfo.nextDueDate.toLocaleString() : null,
      amount: totalDuePerPeriod,
      isOverdue: nextPaymentInfo.isOverdue,
      isInGracePeriod: nextPaymentInfo.isInGracePeriod,
      timeRemaining: nextPaymentInfo.timeRemaining,
      paymentsBehind: nextPaymentInfo.paymentsBehind,
      gracePeriodEnd: nextPaymentInfo.gracePeriodEnd,
      gracePeriodEndFormatted: nextPaymentInfo.gracePeriodEnd ? nextPaymentInfo.gracePeriodEnd.toLocaleDateString() : null,
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
      // Use invoice data as source of truth
      totalPaid: parseFloat(totalPaidFromInvoices.toFixed(2)),
      totalExpected: parseFloat(totalExpectedFromInvoices.toFixed(2)),
      outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
      paymentsMade: nonCreditPayments.length,
      expectedPaymentsCount: nextPaymentInfo.expectedPayments || 0,
      lastPaymentDate: nextPaymentInfo.lastPaymentDate,
      lastPaymentDateFormatted: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleDateString() : null,
      lastPaymentDateTime: nextPaymentInfo.lastPaymentDate ? 
        nextPaymentInfo.lastPaymentDate.toLocaleString() : null
    },
    // Include reconciliation data for transparency
    reconciliation: {
      prepaidPeriods: nextPaymentInfo.prepaidPeriods || [],
      finalPaidReports: finalPaidReports,
      // Count of payment reports that appear as PARTIAL but are effectively paid
      finalPaidCount: finalPaidReports.length
    },
    status,
    isRentStarted: rentStartStart <= todayStart,
    rentStartDate: rentStartStart
  };
};