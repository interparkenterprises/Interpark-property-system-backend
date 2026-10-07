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
 * Calculate service charge amount based on tenant's service charge settings.
 *
 * Service charge is calculated based on BASE rent (excluding VAT) when the
 * type is PERCENTAGE. For FIXED and PER_SQ_FT, the configured value is used
 * directly and treated according to the service charge's own VAT settings.
 *
 * VAT CONVENTION (mirrors how rent is handled elsewhere in this file):
 *   - When vatType is INCLUSIVE, the configured/derived `amount` is the
 *     gross figure the tenant pays. `exclusiveAmount` is backed out.
 *   - When vatType is EXCLUSIVE, the configured/derived `amount` is the base
 *     and `totalWithVat` adds VAT on top.
 *   - When vatType is NOT_APPLICABLE, `amount === totalWithVat === exclusiveAmount`.
 *
 * The returned `amount` is therefore ALWAYS the figure the tenant is billed
 * for the service charge (inclusive when VAT is inclusive), matching the
 * convention used for rent. `vatAmount` remains a memo.
 *
 * @param {Object} tenant - Tenant object with serviceCharge relation
 * @param {number} monthlyRent - Current monthly rent amount (may include VAT)
 * @returns {Object} - Service charge details
 */
export const calculateServiceCharge = (tenant, monthlyRent) => {
  const serviceCharge = tenant.serviceCharge;

  if (!serviceCharge) {
    return {
      amount: 0,
      exclusiveAmount: 0,
      type: null,
      vatType: 'NOT_APPLICABLE',
      vatRate: 0,
      vatAmount: 0,
      totalWithVat: 0,
      breakdown: null
    };
  }

  // Get the base rent (excluding VAT) for PERCENTAGE service charge calculation
  const baseRent = getBaseRent(monthlyRent, tenant.vatType, tenant.vatRate);

  // ---- 1. Compute the raw configured amount (per the SC type) ----
  let rawAmount = 0;
  let breakdown = null;

  switch (serviceCharge.type) {
    case 'FIXED':
      rawAmount = serviceCharge.fixedAmount || 0;
      breakdown = {
        type: 'FIXED',
        fixedAmount: rawAmount
      };
      break;

    case 'PERCENTAGE':
      // Percentage is on the BASE rent (excluding VAT). The result is
      // therefore exclusive-of-VAT by construction — but we still apply
      // the SC's own vatType below, because the SC config governs its VAT.
      rawAmount = (baseRent * (serviceCharge.percentage || 0)) / 100;
      breakdown = {
        type: 'PERCENTAGE',
        percentage: serviceCharge.percentage,
        baseAmount: baseRent,
        totalRentIncludingVat: monthlyRent,
        calculatedAmount: rawAmount,
        note: `Calculated on base rent (${baseRent}) excluding VAT`
      };
      break;

    case 'PER_SQ_FT': {
      const sizeSqFt = tenant.unit?.sizeSqFt || 0;
      rawAmount = sizeSqFt * (serviceCharge.perSqFtRate || 0);
      breakdown = {
        type: 'PER_SQ_FT',
        sizeSqFt,
        perSqFtRate: serviceCharge.perSqFtRate,
        calculatedAmount: rawAmount
      };
      break;
    }

    default:
      rawAmount = 0;
  }

  rawAmount = parseFloat(rawAmount.toFixed(2));

  // ---- 2. Apply the service charge's OWN VAT settings ----
  const vatType = serviceCharge.vatType || 'NOT_APPLICABLE';
  const vatRate = serviceCharge.vatRate || 0;

  let exclusiveAmount;
  let vatAmount = 0;
  let totalWithVat;

  if (vatType === 'INCLUSIVE' && vatRate > 0) {
    // rawAmount is already the gross figure; back out the VAT.
    totalWithVat = rawAmount;
    vatAmount = parseFloat(((rawAmount * vatRate) / (100 + vatRate)).toFixed(2));
    exclusiveAmount = parseFloat((rawAmount - vatAmount).toFixed(2));
  } else if (vatType === 'EXCLUSIVE' && vatRate > 0) {
    // rawAmount is the net base; VAT is added on top.
    exclusiveAmount = rawAmount;
    vatAmount = parseFloat(((rawAmount * vatRate) / 100).toFixed(2));
    totalWithVat = parseFloat((rawAmount + vatAmount).toFixed(2));
  } else {
    // NOT_APPLICABLE (or rate is 0)
    exclusiveAmount = rawAmount;
    vatAmount = 0;
    totalWithVat = rawAmount;
  }

  return {
    // `amount` is the tenant-facing figure (inclusive when VAT is inclusive)
    amount: totalWithVat,
    // `exclusiveAmount` is the net-of-VAT base
    exclusiveAmount,
    // `totalWithVat` mirrors `amount` — kept for backward compatibility
    totalWithVat,
    // Memo VAT amount (informational)
    vatAmount,
    type: serviceCharge.type,
    vatType,
    vatRate,
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
 * Calculate total payment including rent, service charge, and VAT.
 *
 * VAT CONVENTION:
 *   - Rent: `paymentByPolicy` is the raw rent × months (inclusive if the
 *     tenant's vatType is INCLUSIVE, exclusive if EXCLUSIVE). `vatAmount`
 *     holds the VAT portion for memos.
 *   - Service charge: `paymentByPolicy` is the tenant-facing SC × months
 *     (inclusive when the SC's vatType is INCLUSIVE). `vatAmount` holds
 *     the memo VAT portion.
 *
 * Because both components already carry their own VAT treatment inside
 * their `totalByPolicy` / `paymentByPolicy`, the grand total is simply
 * their sum plus the (possibly zero) rent VAT when rent is EXCLUSIVE.
 *
 * @param {Object} tenant - Tenant object with serviceCharge relation
 * @param {number} monthlyRent - Current monthly rent amount
 * @param {string} paymentPolicy - MONTHLY, QUARTERLY, or ANNUAL
 * @returns {Object} - Complete payment breakdown
 */
export const calculateTotalPayment = (tenant, monthlyRent, paymentPolicy) => {
  const policyMonths = getPolicyMonths(paymentPolicy);

  // ---- Rent ----
  const rentPayment = calculatePaymentByPolicy(monthlyRent, paymentPolicy);
  const rentVatType = tenant.vatType || 'NOT_APPLICABLE';
  const rentVatRate = tenant.vatRate || 0;

  // `vatOnRent` is a memo VAT figure regardless of rent VAT mode.
  const vatOnRent = calculateVAT(rentPayment, rentVatType, rentVatRate);

  // The amount the tenant owes for rent (inclusive if INCLUSIVE, base if EXCLUSIVE).
  // `calculatePaymentByPolicy` returns `monthlyRent * months`, which is
  // whatever the tenant's stored rent represents. So this is already correct
  // for both VAT modes.
  const rentAmountPayable = rentPayment;

  // ---- Service charge ----
  const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);

  // `serviceChargeDetails.amount` is the tenant-facing figure (inclusive
  // when the SC's vatType is INCLUSIVE). Multiply by policy months.
  const serviceChargeByPolicy = parseFloat(
    (serviceChargeDetails.amount * policyMonths).toFixed(2)
  );
  const serviceChargeExclusiveByPolicy = parseFloat(
    (serviceChargeDetails.exclusiveAmount * policyMonths).toFixed(2)
  );
  const serviceChargeVatByPolicy = parseFloat(
    (serviceChargeDetails.vatAmount * policyMonths).toFixed(2)
  );

  // ---- Grand total ----
  // Rent: if EXCLUSIVE, we add VAT on top; if INCLUSIVE, rentPayment already includes it.
  // Service charge: `serviceChargeByPolicy` already includes its own VAT if applicable.
  let total;
  if (rentVatType === 'EXCLUSIVE' && rentVatRate > 0) {
    total = rentAmountPayable + vatOnRent + serviceChargeByPolicy;
  } else {
    // INCLUSIVE or NOT_APPLICABLE — VAT (if any) is already inside the amounts
    total = rentAmountPayable + serviceChargeByPolicy;
  }

  total = parseFloat(total.toFixed(2));

  // Total VAT (memo, for reporting)
  const totalVat = parseFloat(
    (
      (rentVatType === 'EXCLUSIVE' ? vatOnRent : 0) +
      serviceChargeVatByPolicy
    ).toFixed(2)
  );

  return {
    rent: {
      monthly: monthlyRent,
      paymentByPolicy: rentAmountPayable,
      vatType: rentVatType,
      vatRate: rentVatRate,
      vatAmount: vatOnRent,
      baseRent: getBaseRent(monthlyRent, rentVatType, rentVatRate)
    },
    serviceCharge: {
      monthly: serviceChargeDetails.amount,
      monthlyExclusive: serviceChargeDetails.exclusiveAmount,
      paymentByPolicy: serviceChargeByPolicy,
      paymentByPolicyExclusive: serviceChargeExclusiveByPolicy,
      type: serviceChargeDetails.type,
      vatType: serviceChargeDetails.vatType,
      vatRate: serviceChargeDetails.vatRate,
      vatAmount: serviceChargeVatByPolicy,
      totalByPolicy: serviceChargeByPolicy,
      breakdown: serviceChargeDetails.breakdown
    },
    total: {
      monthly: parseFloat(
        (
          monthlyRent +
          serviceChargeDetails.amount +
          (rentVatType === 'EXCLUSIVE' ? vatOnRent / policyMonths : 0)
        ).toFixed(2)
      ),
      paymentByPolicy: total,
      vatTotal: totalVat
    },
    paymentPolicy
  };
};
// =============================================
// WITHHOLDING TAX FUNCTIONS
// =============================================

/**
 * Calculate withholding tax (WHT) on rent
 * Withholding tax is calculated on the rent amount (excluding VAT)
 * @param {number} amount - The base amount (rent excluding VAT)
 * @param {number} withholdingRate - Withholding tax rate as percentage
 * @param {boolean} isExempt - Whether tenant is exempt from withholding tax
 * @returns {Object} - Withholding tax details
 */
export const calculateWithholdingTax = (amount, withholdingRate, isExempt = false) => {
  // If exempt or no rate, return zero
  if (isExempt || !withholdingRate || withholdingRate === 0 || !amount || amount === 0) {
    return {
      amount: 0,
      rate: withholdingRate || 0,
      taxableAmount: amount,
      applicable: false,
      isExempt: isExempt
    };
  }

  const whtAmount = (amount * withholdingRate) / 100;
  
  return {
    amount: parseFloat(whtAmount.toFixed(2)),
    rate: withholdingRate,
    taxableAmount: amount,
    applicable: true,
    isExempt: false
  };
};

/**
 * Calculate withholding VAT (WH VAT)
 * Withholding VAT is calculated on the VAT amount
 * @param {number} vatAmount - The VAT amount
 * @param {number} withholdingVatRate - Withholding VAT rate as percentage
 * @param {boolean} isExempt - Whether tenant is exempt from withholding VAT
 * @returns {Object} - Withholding VAT details
 */
export const calculateWithholdingVat = (vatAmount, withholdingVatRate, isExempt = false) => {
  if (isExempt || !withholdingVatRate || withholdingVatRate === 0 || !vatAmount || vatAmount === 0) {
    return {
      amount: 0,
      rate: withholdingVatRate || 0,
      taxableAmount: vatAmount,
      applicable: false,
      isExempt: isExempt
    };
  }

  const whVatAmount = (vatAmount * withholdingVatRate) / 100;
  
  return {
    amount: parseFloat(whVatAmount.toFixed(2)),
    rate: withholdingVatRate,
    taxableAmount: vatAmount,
    applicable: true,
    isExempt: false
  };
};

/**
 * Calculate total payment with withholding taxes
 *
 * Withholding tax is deducted from the invoice total, giving the "net
 * payable" — what the tenant actually hands over. The gross total (before
 * withholding) is preserved as `totalDueWithoutWithholding`.
 *
 * VAT CONVENTION:
 *   - The grand total (before withholding) already accounts for rent VAT
 *     and service charge VAT according to each component's own settings.
 *   - Withholding tax is computed on the rent base (excluding rent VAT),
 *     per Kenyan practice.
 *   - Withholding VAT is computed on the rent VAT amount (memo), per
 *     Kenyan practice.
 *   - The service charge is NOT subject to withholding tax; its VAT is
 *     already inside `serviceCharge.totalByPolicy` and is never re-added.
 *
 * @param {Object} tenant - Tenant object with withholding tax fields
 * @param {number} monthlyRent - Current monthly rent amount
 * @param {string} paymentPolicy - MONTHLY, QUARTERLY, or ANNUAL
 * @returns {Object} - Complete payment breakdown with withholding taxes
 */
export const calculateTotalPaymentWithWithholding = (tenant, monthlyRent, paymentPolicy) => {
  // Base calculations (rent + SC + VAT)
  const basePayment = calculateTotalPayment(tenant, monthlyRent, paymentPolicy);

  const policyMonths = getPolicyMonths(paymentPolicy);

  // Base rent (excluding VAT) for WHT calculation
  const baseRent = basePayment.rent.baseRent || monthlyRent;
  const rentPaymentByPolicy = basePayment.rent.paymentByPolicy;
  const vatOnRent = basePayment.rent.vatAmount;

  // Service charge is NOT subject to withholding tax.
  // Its VAT is already inside `serviceCharge.totalByPolicy` — do not re-add.
  const serviceChargeTotal = basePayment.serviceCharge.totalByPolicy;

  // ---- Withholding tax on rent (on the base, exclusive of VAT) ----
  const wht = calculateWithholdingTax(
    baseRent * policyMonths,
    tenant.withholdingTaxRate || 0,
    tenant.isWithholdingTaxExempt || false
  );

  // ---- Withholding VAT (on the rent VAT amount) ----
  const whVat = calculateWithholdingVat(
    vatOnRent,
    tenant.withholdingVatRate || 0,
    tenant.isWithholdingTaxExempt || false
  );

  // ---- Net amounts after withholding ----
  // Rent: subtract WHT from the rent payable
  const netRent = parseFloat((rentPaymentByPolicy - wht.amount).toFixed(2));

  // Rent VAT: subtract withholding VAT. Only meaningful when rent VAT is
  // EXCLUSIVE (added on top). If rent VAT is INCLUSIVE, `vatOnRent` is
  // already inside `rentPaymentByPolicy` and `whVat` still reduces the
  // tenant's cash outflow, so we subtract it from the rent amount too.
  const netVat = parseFloat((vatOnRent - whVat.amount).toFixed(2));

  // Service charge: unchanged (withholding does not apply).
  const netServiceCharge = serviceChargeTotal;

  // ---- Gross total (before withholding) ----
  const totalDueWithoutWithholding = basePayment.total.paymentByPolicy;

  // ---- Net payable (what the tenant actually pays) ----
  //   For INCLUSIVE rent VAT:  rent (already includes VAT) + SC − WHT − WhVAT
  //   For EXCLUSIVE rent VAT:  rent + rent VAT + SC − WHT − WhVAT
  //   For NOT_APPLICABLE:      rent + SC − WHT
  let totalPayable;
  if (basePayment.rent.vatType === 'EXCLUSIVE' && basePayment.rent.vatRate > 0) {
    totalPayable = netRent + netVat + netServiceCharge;
  } else {
    // INCLUSIVE or NOT_APPLICABLE — VAT (if any) is inside rentPayment.
    // Subtract withholding VAT from the rent side.
    totalPayable = netRent - whVat.amount + netServiceCharge;
    // The line above intentionally subtracts whVat separately because
    // netRent only accounts for WHT, not WhVAT, when VAT is inclusive.
  }
  totalPayable = parseFloat(totalPayable.toFixed(2));

  // Amounts withheld (to be remitted to tax authorities)
  const totalWithheld = parseFloat((wht.amount + whVat.amount).toFixed(2));

  return {
    ...basePayment,
    withholdingTax: {
      rent: wht,
      vat: whVat,
      totalWithheld,
      netPayable: totalPayable,
      breakdown: {
        rentBaseAmount: parseFloat((baseRent * policyMonths).toFixed(2)),
        rentVatAmount: vatOnRent,
        serviceChargeAmount: serviceChargeTotal,
        whtRate: tenant.withholdingTaxRate || 0,
        whVatRate: tenant.withholdingVatRate || 0,
        isExempt: tenant.isWithholdingTaxExempt || false
      }
    },
    // Convenience: the gross total before withholding (for display)
    totalDueWithoutWithholding: parseFloat(totalDueWithoutWithholding.toFixed(2))
  };
};
/**
 * Get net payment amount after withholding taxes
 * @param {Object} tenant - Tenant object
 * @param {number} monthlyRent - Current monthly rent
 * @param {string} paymentPolicy - Payment policy
 * @returns {number} - Net payment amount
 */
export const getNetPaymentWithWithholding = (tenant, monthlyRent, paymentPolicy) => {
  const calculation = calculateTotalPaymentWithWithholding(tenant, monthlyRent, paymentPolicy);
  return calculation.withholdingTax.netPayable;
};