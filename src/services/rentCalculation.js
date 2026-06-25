/**
 * Get number of months in a billing policy
 * @param {string} [paymentPolicy='MONTHLY']
 * @returns {number}
 */
export const getPolicyMonths = (paymentPolicy = 'MONTHLY') => {
  switch (paymentPolicy) {
    case 'QUARTERLY':
      return 3;
    case 'ANNUAL':
      return 12;
    case 'MONTHLY':
    default:
      return 1;
  }
};

/**
 * Add one billing period to a date based on payment policy
 * @param {Date} date
 * @param {string} [paymentPolicy='MONTHLY']
 * @returns {Date}
 */
export const addBillingPeriod = (date, paymentPolicy = 'MONTHLY') => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + getPolicyMonths(paymentPolicy));
  return next;
};

/**
 * Calculate escalated rent based on tenant's escalation settings
 * @param {Object} tenant - Tenant object with escalationRate & escalationFrequency
 * @param {Date} [asOfDate=new Date()] - Date to calculate rent as of (defaults to today)
 * @returns {{ currentRent: number, nextEscalationDate: Date | null, escalationsApplied: number }}
 */
export const calculateEscalatedRent = (tenant, asOfDate = new Date()) => {
  const { rent, escalationRate, escalationFrequency, rentStart } = tenant;

  // If no escalation, return base rent
  if (!escalationRate || escalationRate <= 0 || !escalationFrequency || !rentStart) {
    return {
      currentRent: rent,
      nextEscalationDate: null,
      escalationsApplied: 0
    };
  }

  const startDate = new Date(rentStart);
  const diffInMs = asOfDate - startDate;
  const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

  let periodsElapsed = 0;
  let periodMonths = 12; // default: ANNUALLY

  switch (escalationFrequency) {
    case 'ANNUALLY':
      periodMonths = 12;
      break;
    case 'BI_ANNUALLY':
      periodMonths = 6;
      break;
    case 'BI_ENNIAL':
      periodMonths = 24;
      break;
    default:
      return { currentRent: rent, nextEscalationDate: null, escalationsApplied: 0 };
  }

  const periodDays = periodMonths * 30.44; // avg days per month
  periodsElapsed = Math.floor(diffInDays / periodDays);

  // Avoid negative or excessive escalations
  periodsElapsed = Math.max(0, periodsElapsed);

  // Calculate escalated rent
  const escalatedRent = rent * Math.pow(1 + escalationRate / 100, periodsElapsed);

  // Calculate next escalation date
  const nextEscalationDate = new Date(startDate);
  nextEscalationDate.setMonth(nextEscalationDate.getMonth() + (periodsElapsed + 1) * periodMonths);

  return {
    currentRent: parseFloat(escalatedRent.toFixed(2)), // round to 2 decimals
    nextEscalationDate,
    escalationsApplied: periodsElapsed
  };
};

/**
 * Get rent schedule for next N escalations (e.g., for preview or reporting)
 * @param {Object} tenant - Tenant object
 * @param {number} [numPeriods=5] - Number of future escalations to project
 * @returns {Array<{ period: number, date: Date, rent: number }>}
 */
export const getRentSchedule = (tenant, numPeriods = 5) => {
  const { rent, escalationRate, escalationFrequency, rentStart } = tenant;
  const schedule = [];

  if (!escalationRate || escalationRate <= 0 || !escalationFrequency || !rentStart) {
    // No escalation — just current rent indefinitely
    schedule.push({
      period: 0,
      date: new Date(rentStart),
      rent: rent
    });
    return schedule;
  }

  const startDate = new Date(rentStart);
  let periodMonths = 12;
  
  switch (escalationFrequency) {
    case 'ANNUALLY':
      periodMonths = 12;
      break;
    case 'BI_ANNUALLY':
      periodMonths = 6;
      break;
    case 'BI_ENNIAL':
      periodMonths = 24;
      break;
    default:
      periodMonths = 12;
  }

  for (let i = 0; i <= numPeriods; i++) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + i * periodMonths);
    
    const rentAfterEscalation = rent * Math.pow(1 + escalationRate / 100, i);
    
    schedule.push({
      period: i, // 0 = base, 1 = first escalation, etc.
      date,
      rent: parseFloat(rentAfterEscalation.toFixed(2))
    });
  }

  return schedule;
};

/**
 * Calculate payment amount based on monthly rent and payment policy
 * @param {number} monthlyRent - Monthly rent amount
 * @param {string} paymentPolicy - MONTHLY, QUARTERLY, or ANNUAL
 * @returns {number} - Payment amount for the selected policy
 */
export const calculatePaymentByPolicy = (monthlyRent, paymentPolicy) => {
  return parseFloat((monthlyRent * getPolicyMonths(paymentPolicy)).toFixed(2));
};

/**
 * Calculate a generic charge by payment policy
 * Useful when the amount represents a monthly full charge
 * (rent + service charge + VAT) rather than rent only.
 * @param {number} monthlyAmount
 * @param {string} paymentPolicy
 * @returns {number}
 */
export const calculateChargeByPolicy = (monthlyAmount, paymentPolicy = 'MONTHLY') => {
  return parseFloat((monthlyAmount * getPolicyMonths(paymentPolicy)).toFixed(2));
};

/**
 * Get rent schedule with payment policy applied
 * @param {Object} tenant - Tenant object
 * @param {number} [numPeriods=5] - Number of future escalations to project
 * @returns {Array<{ period: number, date: Date, monthlyRent: number, paymentAmount: number, paymentPolicy: string }>}
 */
export const getRentScheduleWithPayments = (tenant, numPeriods = 5) => {
  const schedule = getRentSchedule(tenant, numPeriods);
  
  return schedule.map(item => ({
    period: item.period,
    date: item.date,
    monthlyRent: item.rent,
    paymentAmount: calculatePaymentByPolicy(item.rent, tenant.paymentPolicy),
    paymentPolicy: tenant.paymentPolicy
  }));
};

/**
 * Get the base rent (excluding VAT) for calculations
 * @param {number} totalRent - The total rent amount (may include VAT)
 * @param {string} vatType - INCLUSIVE, EXCLUSIVE, or NOT_APPLICABLE
 * @param {number} vatRate - VAT rate as percentage
 * @returns {number} - Base rent excluding VAT
 */
export const getBaseRent = (totalRent, vatType, vatRate) => {
  if (vatType === 'INCLUSIVE' && vatRate > 0) {
    // Extract VAT from the total
    return parseFloat((totalRent / (1 + vatRate / 100)).toFixed(2));
  }
  // For EXCLUSIVE or NOT_APPLICABLE, the total is the base
  return totalRent;
};

/**
 * Calculate service charge amount based on tenant's service charge settings
 * Service charge is calculated based on rent ONLY (not rent + VAT)
 * When VAT is INCLUSIVE, we use the base rent (excluding VAT)
 * @param {Object} tenant - Tenant object with serviceCharge relation
 * @param {number} monthlyRent - Current monthly rent amount (may include VAT)
 * @returns {Object} - Service charge details
 */
export const calculateServiceCharge = (tenant, monthlyRent) => {
  const serviceCharge = tenant.serviceCharge;
  
  if (!serviceCharge) {
    return {
      amount: 0,
      type: null,
      vatType: 'NOT_APPLICABLE',
      vatRate: 0,
      vatAmount: 0,
      totalWithVat: 0,
      breakdown: null
    };
  }

  // Get the base rent (excluding VAT) for service charge calculation
  const baseRent = getBaseRent(monthlyRent, tenant.vatType, tenant.vatRate);
  
  let amount = 0;
  let breakdown = null;

  switch (serviceCharge.type) {
    case 'FIXED':
      amount = serviceCharge.fixedAmount || 0;
      breakdown = {
        type: 'FIXED',
        fixedAmount: amount
      };
      break;
    case 'PERCENTAGE':
      // Calculate percentage based on BASE rent (excluding VAT)
      amount = (baseRent * (serviceCharge.percentage || 0)) / 100;
      breakdown = {
        type: 'PERCENTAGE',
        percentage: serviceCharge.percentage,
        baseAmount: baseRent,
        totalRentIncludingVat: monthlyRent,
        calculatedAmount: amount,
        note: `Calculated on base rent (${baseRent}) excluding VAT`
      };
      break;
    case 'PER_SQ_FT':
      const sizeSqFt = tenant.unit?.sizeSqFt || 0;
      amount = sizeSqFt * (serviceCharge.perSqFtRate || 0);
      breakdown = {
        type: 'PER_SQ_FT',
        sizeSqFt: sizeSqFt,
        perSqFtRate: serviceCharge.perSqFtRate,
        calculatedAmount: amount
      };
      break;
    default:
      amount = 0;
  }

  // Round to 2 decimal places
  amount = parseFloat(amount.toFixed(2));

  // Calculate VAT on service charge using service charge's own VAT settings
  const vatType = serviceCharge.vatType || 'NOT_APPLICABLE';
  const vatRate = serviceCharge.vatRate || 0;
  let vatAmount = 0;

  if (vatType !== 'NOT_APPLICABLE' && vatRate > 0) {
    if (vatType === 'INCLUSIVE') {
      vatAmount = (amount * vatRate) / (100 + vatRate);
    } else if (vatType === 'EXCLUSIVE') {
      vatAmount = (amount * vatRate) / 100;
    }
  }

  vatAmount = parseFloat(vatAmount.toFixed(2));

  return {
    amount,
    type: serviceCharge.type,
    vatType,
    vatRate,
    vatAmount,
    totalWithVat: parseFloat((amount + vatAmount).toFixed(2)),
    breakdown
  };
};

/**
 * Calculate VAT amount for a given amount
 * @param {number} amount - The base amount
 * @param {string} vatType - INCLUSIVE, EXCLUSIVE, or NOT_APPLICABLE
 * @param {number} vatRate - VAT rate as percentage (e.g., 16 for 16%)
 * @returns {number} - VAT amount
 */
export const calculateVAT = (amount, vatType, vatRate) => {
  if (vatType === 'NOT_APPLICABLE' || !vatRate || vatRate === 0 || !amount || amount === 0) {
    return 0;
  }

  let vatAmount = 0;
  if (vatType === 'INCLUSIVE') {
    vatAmount = (amount * vatRate) / (100 + vatRate);
  } else if (vatType === 'EXCLUSIVE') {
    vatAmount = (amount * vatRate) / 100;
  }

  return parseFloat(vatAmount.toFixed(2));
};

/**
 * Calculate total payment including rent, service charge, and VAT
 * @param {Object} tenant - Tenant object with serviceCharge relation
 * @param {number} monthlyRent - Current monthly rent amount
 * @param {string} paymentPolicy - MONTHLY, QUARTERLY, or ANNUAL
 * @returns {Object} - Complete payment breakdown
 */
export const calculateTotalPayment = (tenant, monthlyRent, paymentPolicy) => {
  // Calculate rent payment by policy
  const rentPayment = calculatePaymentByPolicy(monthlyRent, paymentPolicy);
  
  // Calculate service charge (based on base rent ONLY)
  const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
  
  // Calculate service charge by policy (if it's monthly, multiply by policy months)
  const serviceChargeByPolicy = serviceChargeDetails.amount * getPolicyMonths(paymentPolicy);
  const serviceChargeVatByPolicy = serviceChargeDetails.vatAmount * getPolicyMonths(paymentPolicy);
  const serviceChargeTotalByPolicy = serviceChargeDetails.totalWithVat * getPolicyMonths(paymentPolicy);
  
  // Calculate VAT on rent using tenant's VAT settings
  const vatOnRent = calculateVAT(rentPayment, tenant.vatType, tenant.vatRate);
  
  // Total
  const total = rentPayment + vatOnRent + serviceChargeTotalByPolicy;

  return {
    rent: {
      monthly: monthlyRent,
      paymentByPolicy: rentPayment,
      vatType: tenant.vatType || 'NOT_APPLICABLE',
      vatRate: tenant.vatRate || 0,
      vatAmount: vatOnRent,
      baseRent: getBaseRent(monthlyRent, tenant.vatType, tenant.vatRate)
    },
    serviceCharge: {
      monthly: serviceChargeDetails.amount,
      paymentByPolicy: serviceChargeByPolicy,
      type: serviceChargeDetails.type,
      vatType: serviceChargeDetails.vatType,
      vatRate: serviceChargeDetails.vatRate,
      vatAmount: serviceChargeVatByPolicy,
      totalByPolicy: serviceChargeTotalByPolicy,
      breakdown: serviceChargeDetails.breakdown
    },
    total: {
      monthly: parseFloat((monthlyRent + serviceChargeDetails.amount + serviceChargeDetails.vatAmount).toFixed(2)),
      paymentByPolicy: parseFloat(total.toFixed(2)),
      vatTotal: parseFloat((vatOnRent + serviceChargeVatByPolicy).toFixed(2))
    },
    paymentPolicy
  };
};