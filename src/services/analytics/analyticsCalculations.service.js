const OPEN_STATUSES = new Set(['UNPAID', 'PARTIAL', 'OVERDUE']);
const COLLECTION_STATUSES = new Set(['PAID', 'PARTIAL', 'UNPAID']);

const money = value => Number((Number(value) || 0).toFixed(2));
const positive = value => Math.max(Number(value) || 0, 0);

export const collectionRate = (paid, billed) => billed > 0
  ? money((paid / billed) * 100)
  : null;

// ========== RENT INVOICE CALCULATIONS ==========
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
    unpaid: { count: 0, amount: 0 },
    overdue: { count: 0, amount: 0 }
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
    } else if (invoice.status === 'OVERDUE') {
      initial.overdue.count += 1;
      initial.overdue.amount += positive(invoice.balance);
    } else if (invoice.status === 'UNPAID') {
      initial.unpaid.count += 1;
      initial.unpaid.amount += positive(invoice.balance);
    }
  }

  initial.paid.amount = money(initial.paid.amount);
  initial.partial.totalDue = money(initial.partial.totalDue);
  initial.partial.paidAmount = money(initial.partial.paidAmount);
  initial.partial.unpaidAmount = money(initial.partial.unpaidAmount);
  initial.unpaid.amount = money(initial.unpaid.amount);
  initial.overdue.amount = money(initial.overdue.amount);
  return initial;
};

// ========== BILL INVOICE CALCULATIONS ==========
export const calculateBillInvoiceAnalytics = (billInvoices) => {
  const total = billInvoices.length;
  const totalAmount = billInvoices.reduce((sum, b) => sum + positive(b.grandTotal), 0);
  const totalPaid = billInvoices.reduce((sum, b) => sum + positive(b.amountPaid), 0);
  const totalOutstanding = billInvoices.reduce((sum, b) => sum + positive(b.balance), 0);
  
  const overdue = billInvoices.filter(b => b.status === 'OVERDUE' && positive(b.balance) > 0);
  const totalOverdue = overdue.reduce((sum, b) => sum + positive(b.balance), 0);
  
  const byType = {};
  const byStatus = {};
  
  for (const invoice of billInvoices) {
    // By bill type
    const type = invoice.billType || 'UNKNOWN';
    if (!byType[type]) byType[type] = { label: type, count: 0, amount: 0 };
    byType[type].count += 1;
    byType[type].amount += positive(invoice.grandTotal);
    
    // By status
    const status = invoice.status || 'UNKNOWN';
    if (!byStatus[status]) byStatus[status] = { label: status, count: 0, amount: 0 };
    byStatus[status].count += 1;
    byStatus[status].amount += positive(invoice.grandTotal);
  }
  
  return {
    summary: {
      totalBillInvoices: total,
      totalAmount: money(totalAmount),
      totalPaid: money(totalPaid),
      totalOutstanding: money(totalOutstanding),
      totalOverdue: money(totalOverdue),
      collectionRate: collectionRate(totalPaid, totalAmount),
      overdueCount: overdue.length
    },
    byType: Object.values(byType).map(item => ({ ...item, amount: money(item.amount) })),
    byStatus: Object.values(byStatus).map(item => ({ ...item, amount: money(item.amount) }))
  };
};

// ========== COMPREHENSIVE INVOICE ANALYTICS ==========
export const calculateComprehensiveInvoiceAnalytics = (rentInvoices, billInvoices) => {
  // Rent Invoice Summary
  const rentTotal = rentInvoices.reduce((sum, i) => sum + positive(i.totalDue), 0);
  const rentPaid = rentInvoices.reduce((sum, i) => sum + positive(i.amountPaid), 0);
  const rentOutstanding = rentInvoices.reduce((sum, i) => sum + positive(i.balance), 0);
  const rentOverdue = rentInvoices.filter(i => i.status === 'OVERDUE' && positive(i.balance) > 0);
  const rentOverdueAmount = rentOverdue.reduce((sum, i) => sum + positive(i.balance), 0);
  
  // Bill Invoice Summary
  const billTotal = billInvoices.reduce((sum, i) => sum + positive(i.grandTotal), 0);
  const billPaid = billInvoices.reduce((sum, i) => sum + positive(i.amountPaid), 0);
  const billOutstanding = billInvoices.reduce((sum, i) => sum + positive(i.balance), 0);
  const billOverdue = billInvoices.filter(i => i.status === 'OVERDUE' && positive(i.balance) > 0);
  const billOverdueAmount = billOverdue.reduce((sum, i) => sum + positive(i.balance), 0);
  
  // Combined
  const totalInvoices = rentInvoices.length + billInvoices.length;
  const totalAmount = rentTotal + billTotal;
  const totalPaid = rentPaid + billPaid;
  const totalOutstanding = rentOutstanding + billOutstanding;
  const totalOverdue = rentOverdueAmount + billOverdueAmount;
  
  return {
    summary: {
      totalInvoices,
      totalAmount: money(totalAmount),
      totalPaid: money(totalPaid),
      totalOutstanding: money(totalOutstanding),
      totalOverdue: money(totalOverdue),
      overallCollectionRate: collectionRate(totalPaid, totalAmount),
      rentInvoices: {
        count: rentInvoices.length,
        amount: money(rentTotal),
        paid: money(rentPaid),
        outstanding: money(rentOutstanding),
        overdue: money(rentOverdueAmount),
        overdueCount: rentOverdue.length,
        collectionRate: collectionRate(rentPaid, rentTotal)
      },
      billInvoices: {
        count: billInvoices.length,
        amount: money(billTotal),
        paid: money(billPaid),
        outstanding: money(billOutstanding),
        overdue: money(billOverdueAmount),
        overdueCount: billOverdue.length,
        collectionRate: collectionRate(billPaid, billTotal)
      }
    },
    aging: calculateAgingBuckets([...rentInvoices, ...billInvoices.map(b => ({
      ...b,
      totalDue: b.grandTotal,
      amountPaid: b.amountPaid
    }))])
  };
};

// ========== AGING BUCKETS ==========
export const calculateAgingBuckets = (invoices) => {
  const now = new Date();
  const buckets = {
    current: { count: 0, amount: 0 },
    '1-30': { count: 0, amount: 0 },
    '31-60': { count: 0, amount: 0 },
    '61-90': { count: 0, amount: 0 },
    '90+': { count: 0, amount: 0 }
  };
  
  for (const invoice of invoices) {
    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') continue;
    if (positive(invoice.balance) <= 0) continue;
    
    const dueDate = new Date(invoice.dueDate);
    const daysOverdue = Math.max(0, Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)));
    
    let bucket;
    if (daysOverdue === 0) bucket = 'current';
    else if (daysOverdue <= 30) bucket = '1-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else bucket = '90+';
    
    buckets[bucket].count += 1;
    buckets[bucket].amount += positive(invoice.balance);
  }
  
  return Object.entries(buckets).map(([label, data]) => ({
    label,
    ...data,
    amount: money(data.amount)
  }));
};

// ========== INVOICE PERFORMANCE METRICS ==========
export const calculateInvoicePerformanceMetrics = (rentInvoices, billInvoices) => {
  // Payment velocity (average days to pay)
  const paidRentInvoices = rentInvoices.filter(i => i.status === 'PAID' && i.amountPaid > 0);
  const paidBillInvoices = billInvoices.filter(i => i.status === 'PAID' && i.amountPaid > 0);
  
  const calculateAvgDaysToPay = (invoices) => {
    if (invoices.length === 0) return null;
    const totalDays = invoices.reduce((sum, inv) => {
      const issueDate = new Date(inv.issueDate);
      const paymentDate = new Date(inv.updatedAt || inv.createdAt);
      const days = Math.floor((paymentDate - issueDate) / (1000 * 60 * 60 * 24));
      return sum + Math.max(0, days);
    }, 0);
    return money(totalDays / invoices.length);
  };
  
  // On-time payment rate
  const rentPaidOnTime = paidRentInvoices.filter(inv => {
    const dueDate = new Date(inv.dueDate);
    const paymentDate = new Date(inv.updatedAt || inv.createdAt);
    return paymentDate <= dueDate;
  });
  
  const billPaidOnTime = paidBillInvoices.filter(inv => {
    const dueDate = new Date(inv.dueDate);
    const paymentDate = new Date(inv.updatedAt || inv.createdAt);
    return paymentDate <= dueDate;
  });
  
  return {
    paymentVelocity: {
      rentInvoices: calculateAvgDaysToPay(paidRentInvoices),
      billInvoices: calculateAvgDaysToPay(paidBillInvoices),
      overall: calculateAvgDaysToPay([...paidRentInvoices, ...paidBillInvoices])
    },
    onTimePaymentRate: {
      rentInvoices: paidRentInvoices.length > 0 ? 
        money((rentPaidOnTime.length / paidRentInvoices.length) * 100) : null,
      billInvoices: paidBillInvoices.length > 0 ?
        money((billPaidOnTime.length / paidBillInvoices.length) * 100) : null
    },
    averageInvoiceAmount: {
      rentInvoices: rentInvoices.length > 0 ?
        money(rentInvoices.reduce((sum, i) => sum + positive(i.totalDue), 0) / rentInvoices.length) : null,
      billInvoices: billInvoices.length > 0 ?
        money(billInvoices.reduce((sum, i) => sum + positive(i.grandTotal), 0) / billInvoices.length) : null
    }
  };
};

// ========== DATE UTILITIES ==========
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

// ========== TREND CALCULATIONS ==========
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

// ========== OCCUPANCY ==========
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

// ========== REVENUE BY PROPERTY ==========
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

// ========== BILL ANALYTICS ==========
export const calculateBillAnalytics = (bills) => {
  const totalBills = bills.length;
  const totalAmount = bills.reduce((sum, b) => sum + positive(b.totalAmount), 0);
  const totalPaid = bills.reduce((sum, b) => sum + positive(b.amountPaid), 0);
  // Calculate balance from totalAmount - amountPaid since balance doesn't exist on Bill
  const totalOutstanding = bills.reduce((sum, b) => sum + positive(b.totalAmount - b.amountPaid), 0);
  const overdueBills = bills.filter(b => b.status === 'OVERDUE' && positive(b.totalAmount - b.amountPaid) > 0);
  const totalOverdue = overdueBills.reduce((sum, b) => sum + positive(b.totalAmount - b.amountPaid), 0);

  return {
    summary: {
      totalBills,
      totalAmount: money(totalAmount),
      totalPaid: money(totalPaid),
      totalOutstanding: money(totalOutstanding),
      totalOverdue: money(totalOverdue),
      collectionRate: collectionRate(totalPaid, totalAmount),
      overdueCount: overdueBills.length
    },
    byType: groupBy(bills, 'type', 'totalAmount'),
    byStatus: groupBy(bills, 'status', 'totalAmount')
  };
};

// ========== TENANT LIFECYCLE ==========
export const calculateTenantLifecycle = (tenants, units) => {
  const activeTenants = tenants.filter(t => t.unit?.status === 'OCCUPIED');
  const churnedTenants = tenants.filter(t => t.unit?.status !== 'OCCUPIED' && t.createdAt);
  
  const averageRent = activeTenants.reduce((sum, t) => sum + positive(t.rent), 0) / (activeTenants.length || 1);
  const totalDeposits = tenants.reduce((sum, t) => sum + positive(t.deposit), 0);
  
  return {
    summary: {
      totalTenants: tenants.length,
      activeTenants: activeTenants.length,
      churnedTenants: churnedTenants.length,
      retentionRate: tenants.length > 0 ? 
        money(((tenants.length - churnedTenants.length) / tenants.length) * 100) : null,
      averageRent: money(averageRent),
      totalDeposits: money(totalDeposits)
    }
  };
};

// ========== LEAD ANALYTICS ==========
export const calculateLeadAnalytics = (leads) => {
  const totalLeads = leads.length;
  const converted = leads.filter(l => 
    l.offerLetters?.some(o => ['ACCEPTED', 'CONVERTED'].includes(o.status))
  );
  const activeLeads = leads.filter(l => 
    !l.offerLetters?.some(o => ['ACCEPTED', 'CONVERTED', 'REJECTED', 'EXPIRED'].includes(o.status))
  );
  
  return {
    summary: {
      totalLeads,
      convertedLeads: converted.length,
      activeLeads: activeLeads.length,
      conversionRate: totalLeads > 0 ? money((converted.length / totalLeads) * 100) : null,
      averageConversionDays: calculateAverageConversionTime(leads)
    },
    bySource: groupBy(leads, 'natureOfLead', () => 1),
    byStatus: groupBy(leads, l => l.offerLetters?.[0]?.status || 'NEW', () => 1)
  };
};

// ========== DATA QUALITY ==========
export const calculateDataQuality = (data) => {
  const {
    invoices = [],
    bills = [],
    tenants = [],
    units = [],
    paymentReports = []
  } = data;
  
  return {
    orphanedInvoices: invoices.filter(i => i.status === 'PAID' && positive(i.balance) > 0).length,
    inconsistentTenants: tenants.filter(t => t.unit?.status !== 'OCCUPIED').length,
    orphanedUnits: units.filter(u => u.status === 'OCCUPIED' && !u.tenant).length,
    missingPaymentAllocations: paymentReports.filter(p => p.invoices?.length === 0 && p.billInvoices?.length === 0).length,
    duplicateRecords: {
      invoices: findDuplicates(invoices, 'invoiceNumber'),
      bills: [] // Bill doesn't have a unique reference number field
    }
  };
};

// ========== PERFORMANCE ANALYTICS ==========
export const calculatePerformanceAnalytics = (dailyReports, todos) => {
  const submittedReports = dailyReports.filter(r => r.status === 'SUBMITTED');
  const completedTodos = todos.filter(t => t.status === 'COMPLETED');
  const overdueTodos = todos.filter(t => t.status === 'OVERDUE');
  const highPriorityTodos = todos.filter(t => t.priority === 'URGENT' || t.priority === 'HIGH');
  
  return {
    summary: {
      reportSubmissionRate: dailyReports.length > 0 ?
        money((submittedReports.length / dailyReports.length) * 100) : null,
      taskCompletionRate: todos.length > 0 ?
        money((completedTodos.length / todos.length) * 100) : null,
      overdueTasks: overdueTodos.length,
      highPriorityTasks: highPriorityTodos.length,
      averageTaskCompletionDays: calculateAverageTaskCompletionTime(completedTodos)
    },
    byStatus: groupBy(todos, 'status', () => 1),
    byPriority: groupBy(todos, 'priority', () => 1)
  };
};

// ========== VAT ANALYTICS ==========
export const calculateVATAnalytics = (invoices, billInvoices, tenants) => {
  const vatInvoices = invoices.filter(i => i.vat > 0);
  const vatBillInvoices = billInvoices.filter(b => b.vatAmount > 0);
  const vatTenants = tenants.filter(t => t.vatType !== 'NOT_APPLICABLE');
  
  const totalVATCollected = vatInvoices.reduce((sum, i) => sum + positive(i.vat), 0);
  const totalVATOnBills = vatBillInvoices.reduce((sum, b) => sum + positive(b.vatAmount), 0);
  
  return {
    summary: {
      vatCollected: money(totalVATCollected),
      vatOnBills: money(totalVATOnBills),
      vatEligibleTenants: vatTenants.length,
      vatInvoices: vatInvoices.length,
      vatBillInvoices: vatBillInvoices.length
    }
  };
};

// ========== HELPER FUNCTIONS ==========
const groupBy = (items, keyFn, valueFn = () => 1) => {
  // Handle string keyFn
  if (typeof keyFn === 'string') {
    const field = keyFn;
    keyFn = item => item[field];
  }
  
  // Handle string valueFn
  if (typeof valueFn === 'string') {
    const field = valueFn;
    valueFn = item => item[field];
  }
  
  const grouped = items.reduce((acc, item) => {
    const key = keyFn(item) || 'UNKNOWN';
    if (!acc[key]) acc[key] = { label: key, count: 0, amount: 0 };
    acc[key].count += 1;
    acc[key].amount += positive(valueFn(item));
    return acc;
  }, {});
  
  return Object.values(grouped).map(item => ({
    ...item,
    amount: money(item.amount)
  }));
};

const calculateAverageConversionTime = (leads) => {
  const converted = leads.filter(l => 
    l.offerLetters?.some(o => ['ACCEPTED', 'CONVERTED'].includes(o.status))
  );
  
  if (converted.length === 0) return null;
  
  const times = converted.map(l => {
    const created = new Date(l.createdAt);
    const convertedDate = l.offerLetters.find(o => ['ACCEPTED', 'CONVERTED'].includes(o.status));
    if (!convertedDate) return null;
    const convertedAt = new Date(convertedDate.createdAt);
    return Math.floor((convertedAt - created) / (1000 * 60 * 60 * 24));
  }).filter(t => t !== null);
  
  return times.length > 0 ? money(times.reduce((a, b) => a + b, 0) / times.length) : null;
};

const calculateAverageTaskCompletionTime = (tasks) => {
  const completed = tasks.filter(t => t.completedAt);
  if (completed.length === 0) return null;
  
  const times = completed.map(t => {
    const created = new Date(t.createdAt);
    const completed = new Date(t.completedAt);
    return Math.floor((completed - created) / (1000 * 60 * 60 * 24));
  });
  
  return times.length > 0 ? money(times.reduce((a, b) => a + b, 0) / times.length) : null;
};

const findDuplicates = (items, field) => {
  const seen = new Set();
  const duplicates = [];
  
  for (const item of items) {
    const value = item[field];
    if (value && seen.has(value)) {
      duplicates.push(value);
    }
    if (value) seen.add(value);
  }
  
  return duplicates;
};