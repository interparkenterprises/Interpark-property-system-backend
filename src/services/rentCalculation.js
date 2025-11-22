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
  const periodMonths = escalationFrequency === 'BI_ANNUALLY' ? 6 : 12;

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