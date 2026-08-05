const OPEN_STATUSES = new Set(['UNPAID', 'PARTIAL', 'OVERDUE']);
const COLLECTION_STATUSES = new Set(['PAID', 'PARTIAL', 'UNPAID']);

const money = value => Number((Number(value) || 0).toFixed(2));

const positive = value => Math.max(Number(value) || 0, 0);

export const collectionRate = (paid, billed) => billed > 0
  ? money((paid / billed) * 100)
  : null;

export const calculateReceivables = (periodInvoices, openInvoices, asOfExclusive) => {
  const billed = periodInvoices.reduce((sum, invoice) => sum + positive(invoice.totalDue), 0);
  const paid = periodInvoices.reduce((sum, invoice) => sum + positive(invoice.amountPaid), 0);
  const outstanding = openInvoices.reduce((sum, invoice) => (
    OPEN_STATUSES.has(invoice.status) ? sum + positive(invoice.balance) : sum
  ), 0);
  const arrears = openInvoices.reduce((sum, invoice) => (
    OPEN_STATUSES.has(invoice.status) &&
    positive(invoice.balance) > 0 &&
    new Date(invoice.dueDate) < asOfExclusive
      ? sum + positive(invoice.balance)
      : sum
  ), 0);

  return {
    billed: money(billed),
    paid: money(paid),
    outstanding: money(outstanding),
    arrears: money(arrears),
    collectionRate: collectionRate(paid, billed),
    invoiceCount: periodInvoices.length,
    openInvoiceCount: openInvoices.filter(invoice => OPEN_STATUSES.has(invoice.status) && positive(invoice.balance) > 0).length
  };
};

export const calculateStatusDistribution = invoices => {
  const initial = {
    paid: { count: 0, amount: 0 },
    partial: { count: 0, paidAmount: 0, unpaidAmount: 0, totalDue: 0 },
    unpaid: { count: 0, amount: 0 }
  };

  for (const invoice of invoices) {
    if (invoice.status === 'PAID') {
      initial.paid.count += 1;
      initial.paid.amount += Math.min(positive(invoice.amountPaid), positive(invoice.totalDue));
    } else if (invoice.status === 'PARTIAL') {
      initial.partial.count += 1;
      initial.partial.totalDue += positive(invoice.totalDue);
      initial.partial.paidAmount += positive(invoice.amountPaid);
      initial.partial.unpaidAmount += positive(invoice.balance);
    } else if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
      initial.unpaid.count += 1;
      initial.unpaid.amount += positive(invoice.balance);
    }
  }

  initial.paid.amount = money(initial.paid.amount);
  initial.partial.totalDue = money(initial.partial.totalDue);
  initial.partial.paidAmount = money(initial.partial.paidAmount);
  initial.partial.unpaidAmount = money(initial.partial.unpaidAmount);
  initial.unpaid.amount = money(initial.unpaid.amount);
  return initial;
};

const nairobiDate = value => new Date(new Date(value).getTime() + (3 * 60 * 60 * 1000));
const dayKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const isoWeekKey = date => {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

export const periodKey = (value, grain) => {
  const date = nairobiDate(value);
  if (grain === 'day') return dayKey(date);
  if (grain === 'week') return isoWeekKey(date);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const calculateReceivablesTrend = (invoices, grain) => {
  const buckets = new Map();
  for (const invoice of invoices) {
    const period = periodKey(invoice.dueDate, grain);
    const bucket = buckets.get(period) || { period, billed: 0, paid: 0, outstanding: 0, invoiceCount: 0 };
    bucket.billed += positive(invoice.totalDue);
    bucket.paid += positive(invoice.amountPaid);
    bucket.outstanding += positive(invoice.balance);
    bucket.invoiceCount += 1;
    buckets.set(period, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)).map(bucket => ({
    ...bucket,
    billed: money(bucket.billed),
    paid: money(bucket.paid),
    outstanding: money(bucket.outstanding),
    collectionRate: collectionRate(bucket.paid, bucket.billed)
  }));
};

export const calculateCollectionsTrend = (reports, grain) => {
  const buckets = new Map();
  let excludedCreditCount = 0;
  let excludedPrepaidCount = 0;

  for (const report of reports) {
    if (report.status === 'CREDIT') {
      excludedCreditCount += 1;
      continue;
    }
    if (report.status === 'PREPAID') {
      excludedPrepaidCount += 1;
      continue;
    }
    if (!COLLECTION_STATUSES.has(report.status) || positive(report.amountPaid) <= 0) continue;

    const period = periodKey(report.datePaid, grain);
    const bucket = buckets.get(period) || { period, collected: 0, transactionCount: 0 };
    bucket.collected += positive(report.amountPaid);
    bucket.transactionCount += 1;
    buckets.set(period, bucket);
  }

  return {
    series: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)).map(bucket => ({
      ...bucket,
      collected: money(bucket.collected)
    })),
    dataQuality: { excludedCreditCount, excludedPrepaidCount }
  };
};

export const calculateOccupancy = units => {
  const occupiedUnits = units.filter(unit => unit.status === 'OCCUPIED').length;
  const vacantUnits = units.filter(unit => unit.status === 'VACANT').length;
  const totalUnits = occupiedUnits + vacantUnits;
  return {
    totalUnits,
    occupiedUnits,
    vacantUnits,
    occupancyRate: totalUnits > 0 ? money((occupiedUnits / totalUnits) * 100) : null
  };
};

export const calculateRevenueByProperty = invoices => {
  const properties = new Map();
  for (const invoice of invoices) {
    const property = invoice.tenant?.unit?.property;
    if (!property) continue;
    const bucket = properties.get(property.id) || {
      propertyId: property.id,
      propertyName: property.name,
      billed: 0,
      paid: 0,
      outstanding: 0,
      invoiceCount: 0
    };
    bucket.billed += positive(invoice.totalDue);
    bucket.paid += positive(invoice.amountPaid);
    bucket.outstanding += positive(invoice.balance);
    bucket.invoiceCount += 1;
    properties.set(property.id, bucket);
  }
  return [...properties.values()].map(bucket => ({
    ...bucket,
    billed: money(bucket.billed),
    paid: money(bucket.paid),
    outstanding: money(bucket.outstanding),
    collectionRate: collectionRate(bucket.paid, bucket.billed)
  })).sort((a, b) => b.paid - a.paid || a.propertyName.localeCompare(b.propertyName));
};
