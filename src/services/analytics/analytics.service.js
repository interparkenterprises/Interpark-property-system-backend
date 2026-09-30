import prisma from '../../lib/prisma.js';
import permissionService from '../permissionService.js';
import {
  calculateCollectionsTrend,
  calculateOccupancy,
  calculateReceivables,
  calculateReceivablesTrend,
  calculateRevenueByProperty,
  calculateStatusDistribution,
  calculateBillInvoiceAnalytics,
  calculateComprehensiveInvoiceAnalytics,
  calculateInvoicePerformanceMetrics,
  calculateAgingBuckets,
  calculateBillAnalytics,
  calculateTenantLifecycle,
  calculateLeadAnalytics,
  calculateDataQuality,
  calculatePerformanceAnalytics,
  calculateVATAnalytics
} from './analyticsCalculations.service.js';
import { publicFilters, TIMEZONE } from './analyticsFilter.service.js';

const positive = value => Math.max(Number(value) || 0, 0);
const amount = value => Math.max(Number(value) || 0, 0);
const rounded = value => Number(value.toFixed(2));

// ========== DEFINITIONS REGISTRY ==========
// Every metric that has non-obvious semantics gets an entry here.
// The frontend reads meta.definitions[key] to render tooltips without
// hardcoding strings.
const DEFINITIONS = {
  billed: {
    label: 'Billed (cohort)',
    description: 'Sum of totalDue for invoices whose DUE DATE falls in the selected window.',
    axis: 'dueDate',
    basis: 'invoice'
  },
  paid: {
    label: 'Allocated collections',
    description: 'Sum of amountPaid on those same invoices — payments allocated at any time, not cash-date.',
    axis: 'dueDate',
    basis: 'invoice'
  },
  cashCollectedInPeriod: {
    label: 'Cash collected in period',
    description: 'Sum of PaymentReport.amountPaid where datePaid falls in the window. Excludes CREDIT and PREPAID.',
    axis: 'datePaid',
    basis: 'cash'
  },
  outstanding: {
    label: 'Outstanding balance',
    description: 'Sum of balance on all open invoices as of `asOf`. Not limited to the window.',
    axis: 'asOf',
    basis: 'invoice'
  },
  arrears: {
    label: 'Arrears',
    description: 'Portion of outstanding where dueDate < asOf.',
    axis: 'asOf',
    basis: 'invoice'
  },
  collectionRate: {
    label: 'Collection rate',
    description: 'paid / billed × 100. Cohort efficiency, not cash efficiency.',
    axis: 'dueDate',
    basis: 'ratio'
  },
  churnRate: {
    label: 'Churn rate',
    description: 'formerTenants / totalTenantsEver × 100. Cumulative, not period.',
    axis: 'lifetime',
    basis: 'count'
  },
  occupancyRate: {
    label: 'Occupancy rate',
    description: 'occupiedUnits / totalUnits × 100 at asOf. Snapshot.',
    axis: 'asOf',
    basis: 'count'
  },
  averageTenureDays: {
    label: 'Average tenure',
    description: 'Mean days between createdAt and (leftAt || updatedAt) for churned tenants.',
    axis: 'lifetime',
    basis: 'duration'
  },
  onTimePaymentRate: {
    label: 'On-time payment rate',
    description: 'Share of paid invoices where paymentDate <= dueDate.',
    axis: 'dueDate',
    basis: 'ratio'
  },
  paymentVelocity: {
    label: 'Payment velocity',
    description: 'Average days from issueDate to paymentDate for paid invoices.',
    axis: 'issueDate',
    basis: 'duration'
  }
};

const pickDefinitions = (keys = []) => keys.reduce((acc, key) => {
  if (DEFINITIONS[key]) acc[key] = DEFINITIONS[key];
  return acc;
}, {});

// ========== TREND HELPERS ==========
const group = (rows, key, value = () => 1) => Object.values(rows.reduce((all, row) => {
  const label = key(row) || 'UNKNOWN';
  all[label] ||= { label, count: 0, amount: 0 };
  all[label].count += 1;
  all[label].amount += amount(value(row));
  return all;
}, {})).map(item => ({ ...item, amount: rounded(item.amount) }));

const trend = (rows, date, value, grain) => group(rows, row => {
  const shifted = new Date(new Date(date(row)).getTime() + 10800000);
  if (grain === 'day') return shifted.toISOString().slice(0, 10);
  if (grain === 'week') {
    const d = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
    const weekday = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - weekday);
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return `${d.getUTCFullYear()}-W${String(Math.ceil((((d - start) / 86400000) + 1) / 7)).padStart(2, '0')}`;
  }
  return shifted.toISOString().slice(0, 7);
}, value).map(({ label: period, ...item }) => ({ period, ...item })).sort((a, b) => a.period.localeCompare(b.period));

// ========== PROPERTY BREAKDOWN (with Unassigned bucket) ==========
const UNASSIGNED_PROPERTY_ID = '__unassigned__';

const propertyBreakdown = (rows, value) => {
  const buckets = rows.reduce((all, row) => {
    const id = row.property?.id || UNASSIGNED_PROPERTY_ID;
    const name = row.property?.name || 'Unassigned';
    all[id] ||= { propertyId: id, propertyName: name, count: 0, amount: 0 };
    all[id].count += 1;
    all[id].amount += amount(value(row));
    return all;
  }, {});

  return Object.values(buckets)
    .map(item => ({ ...item, amount: rounded(item.amount) }))
    .sort((a, b) => {
      if (a.propertyId === UNASSIGNED_PROPERTY_ID) return 1;
      if (b.propertyId === UNASSIGNED_PROPERTY_ID) return -1;
      return b.amount - a.amount || a.propertyName.localeCompare(b.propertyName);
    });
};

export class AnalyticsAccessError extends Error {
  constructor(message = 'You do not have access to the requested property') {
    super(message);
    this.name = 'AnalyticsAccessError';
    this.statusCode = 403;
  }
}

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  totalDue: true,
  amountPaid: true,
  balance: true,
  status: true,
  issueDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  vat: true,
  paymentPeriod: true,
  rent: true,
  serviceCharge: true
};

const billInvoiceSelect = {
  id: true,
  invoiceNumber: true,
  billId: true,
  billReferenceNumber: true,
  billReferenceDate: true,
  billType: true,
  totalAmount: true,
  vatRate: true,
  vatAmount: true,
  grandTotal: true,
  amountPaid: true,
  balance: true,
  status: true,
  issueDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  units: true,
  chargePerUnit: true
};

const unitOccupancySelect = {
  id: true,
  status: true,
  tenants: {
    where: { status: 'ACTIVE' },
    select: { id: true }
  }
};

const envelope = (data, filters, propertyIds, dataQuality = {}, definitionKeys = []) => ({
  success: true,
  data,
  meta: {
    generatedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    currency: 'KES',
    filters: publicFilters(filters),
    accessiblePropertyIds: propertyIds,
    freshness: 'live',
    definitionsVersion: '3.1',
    definitions: pickDefinitions(definitionKeys),
    dataQuality
  }
});

export class AnalyticsService {
  constructor(database = prisma, permissions = permissionService) {
    this.prisma = database;
    this.permissions = permissions;
  }

  async resolveScope(user, filters) {
    const accessible = await this.permissions.getAccessiblePropertyIds(user.id, user.role);
    let propertyIds = accessible;

    if (filters.propertyId) {
      if (!accessible.includes(filters.propertyId)) throw new AnalyticsAccessError();
      propertyIds = [filters.propertyId];
    }

    if (filters.landlordId) {
      const owned = await this.prisma.property.findMany({
        where: { id: { in: propertyIds }, landlordId: filters.landlordId },
        select: { id: true }
      });
      propertyIds = owned.map(property => property.id);
    }

    return propertyIds;
  }

  invoicePropertyWhere(propertyIds) {
    return { tenant: { unit: { propertyId: { in: propertyIds } } } };
  }

  buildDateFilter(filters, field) {
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      return { [field]: { gte: filters.start, lt: filters.endExclusive } };
    }
    return {};
  }

  async periodInvoices(propertyIds, filters, includeProperty = false) {
    const whereClause = {
      ...this.invoicePropertyWhere(propertyIds),
      status: { not: 'CANCELLED' },
      ...this.buildDateFilter(filters, 'dueDate')
    };

    return this.prisma.invoice.findMany({
      where: whereClause,
      select: includeProperty ? {
        ...invoiceSelect,
        tenant: {
          select: {
            unit: {
              select: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      } : invoiceSelect,
      orderBy: { dueDate: 'asc' }
    });
  }

  async openInvoices(propertyIds, filters) {
    const whereClause = {
      ...this.invoicePropertyWhere(propertyIds),
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      issueDate: { lt: filters.asOfExclusive },
      balance: { gt: 0 }
    };

    return this.prisma.invoice.findMany({
      where: whereClause,
      select: invoiceSelect
    });
  }

  async periodBillInvoices(propertyIds, filters, includeProperty = false) {
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' },
      ...this.buildDateFilter(filters, 'dueDate')
    };

    return this.prisma.billInvoice.findMany({
      where: whereClause,
      select: includeProperty ? {
        ...billInvoiceSelect,
        tenant: {
          select: {
            unit: {
              select: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      } : billInvoiceSelect,
      orderBy: { dueDate: 'asc' }
    });
  }

  async openBillInvoices(propertyIds, filters) {
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      issueDate: { lt: filters.asOfExclusive },
      balance: { gt: 0 }
    };

    return this.prisma.billInvoice.findMany({
      where: whereClause,
      select: billInvoiceSelect
    });
  }

  // Shared helper: cash collected in the current date window (Axis B)
  async cashInPeriod(propertyIds, filters) {
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { in: ['PAID', 'PARTIAL', 'UNPAID'] } // exclude CREDIT / PREPAID
    };
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }
    const rows = await this.prisma.paymentReport.findMany({
      where: whereClause,
      select: { id: true, amountPaid: true }
    });
    const safeRows = rows ?? [];
    return {
      amount: rounded(safeRows.reduce((sum, r) => sum + positive(r.amountPaid), 0)),
      transactionCount: safeRows.length
    };
  }

  // ========== EXISTING METHODS ==========

  async getReceivablesSummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [periodInvoices, openInvoices, cash, openInvoicesWithTenantStatus] = await Promise.all([
      this.periodInvoices(propertyIds, filters),
      this.openInvoices(propertyIds, filters),
      this.cashInPeriod(propertyIds, filters),
      this.prisma.invoice.findMany({
        where: {
          ...this.invoicePropertyWhere(propertyIds),
          status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
          issueDate: { lt: filters.asOfExclusive },
          balance: { gt: 0 }
        },
        select: {
          id: true,
          balance: true,
          tenant: { select: { status: true } }
        }
      })
    ]);

    const data = calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive);

    const activeArrears = openInvoicesWithTenantStatus
      .filter(inv => inv.tenant?.status === 'ACTIVE')
      .reduce((sum, inv) => sum + positive(inv.balance), 0);

    const leftArrears = openInvoicesWithTenantStatus
      .filter(inv => inv.tenant?.status === 'LEFT')
      .reduce((sum, inv) => sum + positive(inv.balance), 0);

    return envelope({
      ...data,
      cashCollectedInPeriod: cash.amount,
      cashTransactionCount: cash.transactionCount,
      arrearsByTenantStatus: {
        activeTenants: rounded(activeArrears),
        formerTenants: rounded(leftArrears),
        total: rounded(activeArrears + leftArrears)
      }
    }, filters, propertyIds, {
      excludedCancelledInvoices: true,
      paidIsAllocationBased: true,
      cashIsDatePaid: true
    }, ['billed', 'paid', 'cashCollectedInPeriod', 'outstanding', 'arrears', 'collectionRate']);
  }

  async getStatusDistribution(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters);
    return envelope(calculateStatusDistribution(invoices), filters, propertyIds, {
      excludedCancelledInvoices: true
    });
  }

  async getReceivablesTrend(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters);
    return envelope(
      { series: calculateReceivablesTrend(invoices, filters.grain) },
      filters,
      propertyIds,
      { excludedCancelledInvoices: true }
    );
  }

  async getCollectionsTrend(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { in: ['PAID', 'PARTIAL', 'UNPAID', 'CREDIT', 'PREPAID'] }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }

    const reports = await this.prisma.paymentReport.findMany({
      where: whereClause,
      select: { id: true, amountPaid: true, status: true, datePaid: true },
      orderBy: { datePaid: 'asc' }
    });
    const result = calculateCollectionsTrend(reports, filters.grain);
    return envelope({ series: result.series }, filters, propertyIds, result.dataQuality, ['cashCollectedInPeriod']);
  }

  async getRevenueByProperty(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters, true);
    return envelope({ properties: calculateRevenueByProperty(invoices) }, filters, propertyIds, {
      excludedCancelledInvoices: true
    }, ['billed', 'paid', 'outstanding', 'collectionRate']);
  }

  async getOccupancySummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const units = await this.prisma.unit.findMany({
      where: { propertyId: { in: propertyIds } },
      select: unitOccupancySelect
    });
    const occupiedWithoutTenant = units.filter(
      unit => unit.status === 'OCCUPIED' && unit.tenants.length === 0
    ).length;
    return envelope(calculateOccupancy(units), filters, propertyIds, { occupiedWithoutTenant }, ['occupancyRate']);
  }

  async getTenantsSummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [activeTenants, leftTenants, activeAgg, leftAgg] = await Promise.all([
      this.prisma.tenant.count({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'ACTIVE' }
      }),
      this.prisma.tenant.count({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'LEFT' }
      }),
      this.prisma.tenant.aggregate({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'ACTIVE' },
        _sum: { rent: true, deposit: true },
        _avg: { rent: true }
      }),
      this.prisma.tenant.groupBy({
        by: ['leftReason'],
        where: { unit: { propertyId: { in: propertyIds } }, status: 'LEFT' },
        _count: { _all: true }
      })
    ]);

    const byLeftReason = leftAgg.reduce((acc, row) => {
      acc[row.leftReason || 'UNSPECIFIED'] = row._count._all;
      return acc;
    }, {});

    const totalEver = activeTenants + leftTenants;

    return envelope({
      currentTenants: activeTenants,
      formerTenants: leftTenants,
      totalTenantsEver: totalEver,
      churnRate: totalEver > 0 ? rounded((leftTenants / totalEver) * 100) : null,
      currentRentRoll: rounded(activeAgg._sum.rent || 0),
      averageRent: rounded(activeAgg._avg.rent || 0),
      depositsHeld: rounded(activeAgg._sum.deposit || 0),
      byLeftReason
    }, filters, propertyIds, { lifecycleStatusAvailable: true }, ['churnRate']);
  }

  async getOverview(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [
      periodInvoices,
      openInvoices,
      units,
      currentTenants,
      formerTenants,
      activeAgg,
      leftAgg,
      cash
    ] = await Promise.all([
      this.periodInvoices(propertyIds, filters),
      this.openInvoices(propertyIds, filters),
      this.prisma.unit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: unitOccupancySelect
      }),
      this.prisma.tenant.count({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'ACTIVE' }
      }),
      this.prisma.tenant.count({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'LEFT' }
      }),
      this.prisma.tenant.aggregate({
        where: { unit: { propertyId: { in: propertyIds } }, status: 'ACTIVE' },
        _sum: { rent: true, deposit: true },
        _avg: { rent: true }
      }),
      this.prisma.tenant.groupBy({
        by: ['leftReason'],
        where: { unit: { propertyId: { in: propertyIds } }, status: 'LEFT' },
        _count: { _all: true }
      }),
      this.cashInPeriod(propertyIds, filters)
    ]);

    const totalTenantsEver = currentTenants + formerTenants;

    const byLeftReason = leftAgg.reduce((acc, row) => {
      acc[row.leftReason || 'UNSPECIFIED'] = row._count._all;
      return acc;
    }, {});

    const receivables = calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive);

    return envelope({
      receivables: {
        ...receivables,
        cashCollectedInPeriod: cash.amount,
        cashTransactionCount: cash.transactionCount
      },
      occupancy: calculateOccupancy(units),
      tenants: {
        currentTenants,
        formerTenants,
        totalTenantsEver,
        churnRate: totalTenantsEver > 0
          ? rounded((formerTenants / totalTenantsEver) * 100)
          : null,
        currentRentRoll: rounded(activeAgg._sum.rent || 0),
        averageRent: rounded(activeAgg._avg.rent || 0),
        depositsHeld: rounded(activeAgg._sum.deposit || 0),
        byLeftReason
      }
    }, filters, propertyIds, {
      excludedCancelledInvoices: true,
      occupiedWithoutTenant: units.filter(
        unit => unit.status === 'OCCUPIED' && unit.tenants.length === 0
      ).length,
      lifecycleStatusAvailable: true
    }, ['billed', 'paid', 'cashCollectedInPeriod', 'outstanding', 'arrears', 'collectionRate', 'churnRate', 'occupancyRate']);
  }

  // ========== COHORT VS CASH ==========
  async getCohortVsCash(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [periodInvoices, openInvoices, cashReports] = await Promise.all([
      this.periodInvoices(propertyIds, filters),
      this.openInvoices(propertyIds, filters),
      this.prisma.paymentReport.findMany({
        where: {
          tenant: { unit: { propertyId: { in: propertyIds } } },
          status: { in: ['PAID', 'PARTIAL', 'UNPAID', 'CREDIT', 'PREPAID'] },
          ...(filters.hasDateFilter && filters.start && filters.endExclusive
            ? { datePaid: { gte: filters.start, lt: filters.endExclusive } }
            : {})
        },
        select: { id: true, amountPaid: true, status: true, datePaid: true }
      })
    ]);

    const cohort = calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive);
    const cashResult = calculateCollectionsTrend(cashReports, filters.grain);

    const cashTotal = cashResult.series.reduce((sum, point) => sum + point.collected, 0);
    const cashTransactionCount = cashResult.series.reduce((sum, point) => sum + point.transactionCount, 0);

    return envelope({
      cohort: {
        billed: cohort.billed,
        allocated: cohort.paid,
        collectionRate: cohort.collectionRate,
        invoiceCount: cohort.invoiceCount
      },
      cash: {
        collected: rounded(cashTotal),
        transactionCount: cashTransactionCount,
        excludedCredit: cashResult.dataQuality.excludedCreditCount ?? 0,
        excludedPrepaid: cashResult.dataQuality.excludedPrepaidCount ?? 0
      },
      snapshot: {
        outstanding: cohort.outstanding,
        arrears: cohort.arrears,
        openInvoiceCount: cohort.openInvoiceCount,
        asOf: filters.asOf
      }
    }, filters, propertyIds, {
      paidIsAllocationBased: true,
      cashIsDatePaid: true
    }, ['billed', 'paid', 'cashCollectedInPeriod', 'outstanding', 'arrears', 'collectionRate']);
  }

  // ========== INVOICE ANALYTICS ==========

  async getComprehensiveInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [rentInvoices, billInvoices] = await Promise.all([
      this.periodInvoices(propertyIds, filters, true),
      this.periodBillInvoices(propertyIds, filters, true)
    ]);

    const comprehensive = calculateComprehensiveInvoiceAnalytics(rentInvoices, billInvoices, filters.asOfExclusive);
    const performance = calculateInvoicePerformanceMetrics(rentInvoices, billInvoices);

    const rentAging = calculateAgingBuckets(rentInvoices, filters.asOfExclusive);
    const billAging = calculateAgingBuckets(
      billInvoices.map(b => ({ ...b, totalDue: b.grandTotal, amountPaid: b.amountPaid })),
      filters.asOfExclusive
    );

    return envelope({
      summary: comprehensive.summary,
      performance,
      aging: {
        rentInvoices: rentAging,
        billInvoices: billAging,
        combined: calculateAgingBuckets(
          [
            ...rentInvoices,
            ...billInvoices.map(b => ({ ...b, totalDue: b.grandTotal, amountPaid: b.amountPaid }))
          ],
          filters.asOfExclusive
        )
      },
      rentInvoices: {
        byStatus: calculateStatusDistribution(rentInvoices),
        trend: calculateReceivablesTrend(rentInvoices, filters.grain),
        byProperty: calculateRevenueByProperty(rentInvoices)
      },
      billInvoices: {
        byStatus: calculateBillInvoiceAnalytics(billInvoices).byStatus,
        byType: calculateBillInvoiceAnalytics(billInvoices).byType,
        trend: trend(billInvoices, row => row.issueDate, row => row.grandTotal, filters.grain),
        byProperty: propertyBreakdown(
          billInvoices.map(b => ({ ...b, property: b.tenant?.unit?.property })),
          row => row.grandTotal
        )
      }
    }, filters, propertyIds, {
      comprehensiveInvoiceVersion: '3.1',
      includesRentInvoices: true,
      includesBillInvoices: true
    }, ['paymentVelocity', 'onTimePaymentRate']);
  }

  async getRentInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [periodInvoices, openInvoices] = await Promise.all([
      this.periodInvoices(propertyIds, filters, true),
      this.openInvoices(propertyIds, filters)
    ]);

    const receivables = calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive);
    const statusDist = calculateStatusDistribution(periodInvoices);
    const trendData = calculateReceivablesTrend(periodInvoices, filters.grain);
    const byProperty = calculateRevenueByProperty(periodInvoices);
    const aging = calculateAgingBuckets(periodInvoices, filters.asOfExclusive);

    const paidInvoices = periodInvoices.filter(i => i.status === 'PAID' || i.amountPaid > 0);
    const avgDaysToPay = paidInvoices.length > 0 ?
      rounded(paidInvoices.reduce((sum, inv) => {
        const issueDate = new Date(inv.issueDate);
        const paymentDate = new Date(inv.updatedAt || inv.createdAt);
        return sum + Math.max(0, Math.floor((paymentDate - issueDate) / (1000 * 60 * 60 * 24)));
      }, 0) / paidInvoices.length) : null;

    return envelope({
      summary: receivables,
      statusDistribution: statusDist,
      trend: trendData,
      byProperty,
      aging,
      performance: {
        averageDaysToPay: avgDaysToPay,
        paidInvoices: paidInvoices.length,
        totalInvoices: periodInvoices.length,
        paymentVelocity: avgDaysToPay
      }
    }, filters, propertyIds, {
      rentInvoiceVersion: '3.1',
      excludedCancelledInvoices: true
    }, ['billed', 'paid', 'outstanding', 'arrears', 'collectionRate', 'paymentVelocity']);
  }

  async getBillInvoiceAnalyticsDetailed(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [periodBillInvoices, openBillInvoices] = await Promise.all([
      this.periodBillInvoices(propertyIds, filters, true),
      this.openBillInvoices(propertyIds, filters)
    ]);

    const analytics = calculateBillInvoiceAnalytics(periodBillInvoices);
    const aging = calculateAgingBuckets(
      periodBillInvoices.map(b => ({ ...b, totalDue: b.grandTotal, amountPaid: b.amountPaid })),
      filters.asOfExclusive
    );

    const waterInvoices = periodBillInvoices.filter(b => b.billType === 'WATER');
    const electricityInvoices = periodBillInvoices.filter(b => b.billType === 'ELECTRICITY');

    const waterAnalytics = calculateBillInvoiceAnalytics(waterInvoices);
    const electricityAnalytics = calculateBillInvoiceAnalytics(electricityInvoices);

    return envelope({
      summary: analytics.summary,
      byStatus: analytics.byStatus,
      byType: analytics.byType,
      trend: trend(periodBillInvoices, row => row.issueDate, row => row.grandTotal, filters.grain),
      byProperty: propertyBreakdown(
        periodBillInvoices.map(b => ({ ...b, property: b.tenant?.unit?.property })),
        row => row.grandTotal
      ),
      aging,
      breakdown: {
        water: {
          ...waterAnalytics.summary,
          invoices: waterInvoices.length,
          averageUnits: waterInvoices.length > 0 ?
            rounded(waterInvoices.reduce((sum, b) => sum + b.units, 0) / waterInvoices.length) : null,
          averageChargePerUnit: waterInvoices.length > 0 ?
            rounded(waterInvoices.reduce((sum, b) => sum + b.chargePerUnit, 0) / waterInvoices.length) : null
        },
        electricity: {
          ...electricityAnalytics.summary,
          invoices: electricityInvoices.length,
          averageUnits: electricityInvoices.length > 0 ?
            rounded(electricityInvoices.reduce((sum, b) => sum + b.units, 0) / electricityInvoices.length) : null,
          averageChargePerUnit: electricityInvoices.length > 0 ?
            rounded(electricityInvoices.reduce((sum, b) => sum + b.chargePerUnit, 0) / electricityInvoices.length) : null
        }
      }
    }, filters, propertyIds, {
      billInvoiceVersion: '3.1',
      excludedCancelledInvoices: true
    }, ['billed', 'paid', 'outstanding', 'collectionRate']);
  }

  async getInvoiceAgingReport(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [rentInvoices, billInvoices] = await Promise.all([
      this.openInvoices(propertyIds, filters),
      this.openBillInvoices(propertyIds, filters)
    ]);

    const rentAging = calculateAgingBuckets(rentInvoices, filters.asOfExclusive);
    const billAging = calculateAgingBuckets(
      billInvoices.map(b => ({ ...b, totalDue: b.grandTotal, amountPaid: b.amountPaid })),
      filters.asOfExclusive
    );

    const combinedAging = calculateAgingBuckets(
      [
        ...rentInvoices,
        ...billInvoices.map(b => ({ ...b, totalDue: b.grandTotal, amountPaid: b.amountPaid }))
      ],
      filters.asOfExclusive
    );

    // Normalize Invoice and BillInvoice into one shape so the client never
    // has to fall back between totalDue/grandTotal or invoiceNumber/billReferenceNumber.
    // `kind` distinguishes them for callers who need to route to a detail page.
    const combined = [
      ...rentInvoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        totalDue: inv.totalDue,
        balance: inv.balance,
        status: inv.status,
        dueDate: inv.dueDate,
        kind: 'RENT'
      })),
      ...billInvoices.map(b => ({
        id: b.id,
        invoiceNumber: b.billReferenceNumber ?? b.invoiceNumber ?? null,
        totalDue: b.grandTotal,
        balance: b.balance,
        status: b.status,
        dueDate: b.dueDate,
        kind: 'BILL'
      }))
    ];

    // Aging details respect asOfExclusive, not `new Date()`.
    const getAgingDetails = (rows, bucket, asOfDate) => {
      return rows.filter(inv => {
        if (inv.status === 'PAID' || inv.status === 'CANCELLED') return false;
        if (positive(inv.balance) <= 0) return false;

        const dueDate = new Date(inv.dueDate);
        const daysOverdue = Math.max(
          0,
          Math.floor((asOfDate - dueDate) / (1000 * 60 * 60 * 24))
        );

        if (bucket === 'current') return daysOverdue === 0;
        if (bucket === '1-30') return daysOverdue > 0 && daysOverdue <= 30;
        if (bucket === '31-60') return daysOverdue > 30 && daysOverdue <= 60;
        if (bucket === '61-90') return daysOverdue > 60 && daysOverdue <= 90;
        if (bucket === '90+') return daysOverdue > 90;
        return false;
      });
    };

    const asOfDate = filters.asOfExclusive;

    return envelope({
      summary: {
        totalOutstanding: rounded(
          rentInvoices.reduce((sum, i) => sum + positive(i.balance), 0) +
          billInvoices.reduce((sum, b) => sum + positive(b.balance), 0)
        ),
        rentOutstanding: rounded(rentInvoices.reduce((sum, i) => sum + positive(i.balance), 0)),
        billOutstanding: rounded(billInvoices.reduce((sum, b) => sum + positive(b.balance), 0)),
        rentCount: rentInvoices.length,
        billCount: billInvoices.length
      },
      aging: {
        rentInvoices: rentAging,
        billInvoices: billAging,
        combined: combinedAging
      },
      details: {
        current: getAgingDetails(combined, 'current', asOfDate),
        '1-30': getAgingDetails(combined, '1-30', asOfDate),
        '31-60': getAgingDetails(combined, '31-60', asOfDate),
        '61-90': getAgingDetails(combined, '61-90', asOfDate),
        '90+': getAgingDetails(combined, '90+', asOfDate)
      }
    }, filters, propertyIds, {
      agingReportVersion: '3.1',
      asOf: filters.asOf
    }, ['outstanding', 'arrears']);
  }

  async getInvoiceReconciliationReport(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const invoiceWhereClause = {
      ...this.invoicePropertyWhere(propertyIds),
      status: { not: 'CANCELLED' }
    };
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceWhereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const billInvoiceWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' }
    };
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      billInvoiceWhereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const paymentWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } }
    };
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      paymentWhereClause.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }

    const [rentInvoices, billInvoices, paymentReports] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhereClause,
        select: {
          ...invoiceSelect,
          paymentReport: { select: { id: true, amountPaid: true, status: true } }
        }
      }),
      this.prisma.billInvoice.findMany({
        where: billInvoiceWhereClause,
        select: {
          ...billInvoiceSelect,
          paymentReport: { select: { id: true, amountPaid: true, status: true } }
        }
      }),
      this.prisma.paymentReport.findMany({
        where: paymentWhereClause,
        select: {
          id: true,
          amountPaid: true,
          status: true,
          datePaid: true,
          invoices: { select: { id: true, amountPaid: true } },
          billInvoices: { select: { id: true, amountPaid: true } }
        }
      })
    ]);

    const unallocatedPayments = paymentReports.filter(p =>
      p.invoices.length === 0 && p.billInvoices.length === 0
    );

    const partialAllocations = [...rentInvoices, ...billInvoices].filter(inv =>
      inv.status === 'PARTIAL' && positive(inv.balance) > 0
    );

    return envelope({
      summary: {
        totalRentInvoices: rentInvoices.length,
        totalBillInvoices: billInvoices.length,
        totalPaymentReports: paymentReports.length,
        unallocatedPayments: unallocatedPayments.length,
        partiallyAllocatedInvoices: partialAllocations.length,
        totalUnallocatedAmount: rounded(unallocatedPayments.reduce((sum, p) => sum + positive(p.amountPaid), 0))
      },
      details: {
        unallocatedPayments: unallocatedPayments.map(p => ({
          id: p.id,
          amount: p.amountPaid,
          date: p.datePaid,
          status: p.status
        })),
        partiallyAllocatedInvoices: partialAllocations.map(inv => ({
          id: inv.id,
          number: inv.invoiceNumber || inv.billReferenceNumber || inv.id,
          totalDue: inv.totalDue ?? inv.grandTotal ?? 0,
          amountPaid: inv.amountPaid,
          balance: inv.balance,
          status: inv.status
        }))
      },
      reconciliationStatus: {
        fullyReconciled: paymentReports.filter(p =>
          p.invoices.length > 0 || p.billInvoices.length > 0
        ).length,
        needsReview: partialAllocations.length + unallocatedPayments.length
      }
    }, filters, propertyIds, {
      reconciliationVersion: '3.1'
    });
  }

  async getBillAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issuedAt = { gte: filters.start, lt: filters.endExclusive };
    }

    // `Bill` is the reading snapshot; it has no reference number.
    // `billReferenceNumber` lives on `BillInvoice`, so we fetch it through the
    // nested relation. See the schema for the model distinction.
    const bills = await this.prisma.bill.findMany({
      where: whereClause,
      select: {
        id: true,
        type: true,
        totalAmount: true,
        amountPaid: true,
        status: true,
        issuedAt: true,
        dueDate: true,
        billInvoices: {
          select: {
            id: true,
            status: true,
            grandTotal: true,
            amountPaid: true,
            billReferenceNumber: true
          }
        }
      },
      orderBy: { issuedAt: 'asc' }
    });

    const billsWithBalance = bills.map(bill => ({
      ...bill,
      balance: bill.totalAmount - bill.amountPaid
    }));

    const billAnalytics = calculateBillAnalytics(billsWithBalance);

    return envelope({
      summary: billAnalytics.summary,
      byType: billAnalytics.byType,
      byStatus: billAnalytics.byStatus,
      trend: trend(billsWithBalance, row => row.issuedAt, row => row.totalAmount, filters.grain),
      overdue: billsWithBalance.filter(b => b.status === 'OVERDUE').map(b => ({
        id: b.id,
        type: b.type,
        amount: rounded(b.balance),
        dueDate: b.dueDate
      }))
    }, filters, propertyIds, { billAnalyticsVersion: '3.1' });
  }

  async getTenantLifecycleAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const tenantWhereClause = {
      unit: { propertyId: { in: propertyIds } }
    };

    const invoiceDateFilter = {};
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceDateFilter.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const [activeTenants, formerTenants, units, openInvoices, openBillInvoices] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { ...tenantWhereClause, status: 'ACTIVE' },
        select: {
          id: true,
          fullName: true,
          rent: true,
          deposit: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          leftAt: true,
          leftReason: true,
          unit: { select: { status: true } },
          invoices: {
            where: invoiceDateFilter,
            select: { id: true, status: true, balance: true, totalDue: true, amountPaid: true, dueDate: true }
          },
          billInvoices: {
            where: invoiceDateFilter,
            select: { id: true, status: true, balance: true, grandTotal: true, amountPaid: true, dueDate: true }
          }
        }
      }),
      this.prisma.tenant.findMany({
        where: { ...tenantWhereClause, status: 'LEFT' },
        select: {
          id: true,
          fullName: true,
          rent: true,
          deposit: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          leftAt: true,
          leftReason: true,
          unit: { select: { status: true } },
          invoices: {
            where: invoiceDateFilter,
            select: { id: true, status: true, balance: true, totalDue: true, amountPaid: true, dueDate: true }
          },
          billInvoices: {
            where: invoiceDateFilter,
            select: { id: true, status: true, balance: true, grandTotal: true, amountPaid: true, dueDate: true }
          }
        }
      }),
      this.prisma.unit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: unitOccupancySelect
      }),
      this.prisma.invoice.findMany({
        where: {
          tenant: { unit: { propertyId: { in: propertyIds } } },
          status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
          balance: { gt: 0 }
        },
        select: { id: true, tenantId: true, status: true, balance: true, totalDue: true, amountPaid: true, dueDate: true }
      }),
      this.prisma.billInvoice.findMany({
        where: {
          tenant: { unit: { propertyId: { in: propertyIds } } },
          status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
          balance: { gt: 0 }
        },
        select: { id: true, tenantId: true, status: true, balance: true, grandTotal: true, amountPaid: true, dueDate: true }
      })
    ]);

    const activeTenantIds = new Set(activeTenants.map(t => t.id));
    const leftTenantIds = new Set(formerTenants.map(t => t.id));

    const activeTenantsWithArrears = new Set();
    const leftTenantsWithArrears = new Set();

    for (const inv of [...openInvoices, ...openBillInvoices]) {
      if (!inv.tenantId) continue;
      if (activeTenantIds.has(inv.tenantId)) activeTenantsWithArrears.add(inv.tenantId);
      else if (leftTenantIds.has(inv.tenantId)) leftTenantsWithArrears.add(inv.tenantId);
    }

    const allTenants = [...activeTenants, ...formerTenants];
    const lifecycleData = calculateTenantLifecycle(allTenants, units, filters);

    const payingTenants = activeTenants.filter(t =>
      t.invoices.some(i => i.status === 'PAID' || i.amountPaid > 0)
    );

    let newTenants = activeTenants;
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      newTenants = activeTenants.filter(t =>
        t.createdAt >= filters.start && t.createdAt < filters.endExclusive
      );
    }

    let totalBalance = 0;
    let tenantsWithBalance = 0;

    for (const tenant of activeTenants) {
      let tenantBalance = 0;
      for (const invoice of tenant.invoices) {
        if (invoice.status !== 'PAID' && invoice.status !== 'CANCELLED') {
          const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
          if (balance > 0) tenantBalance += balance;
        }
      }
      for (const billInvoice of tenant.billInvoices) {
        if (billInvoice.status !== 'PAID' && billInvoice.status !== 'CANCELLED') {
          const balance = billInvoice.balance || (billInvoice.grandTotal - billInvoice.amountPaid);
          if (balance > 0) tenantBalance += balance;
        }
      }
      if (tenantBalance > 0) {
        totalBalance += tenantBalance;
        tenantsWithBalance++;
      }
    }

    const churnedTenants = formerTenants.map(t => ({
      ...t,
      effectiveLeftAt: t.leftAt || t.updatedAt
    }));

    return envelope({
      summary: lifecycleData.summary,
      tenantsWithArrears: activeTenantsWithArrears.size,
      formerTenantsWithArrears: leftTenantsWithArrears.size,
      totalTenantsWithArrears: activeTenantsWithArrears.size + leftTenantsWithArrears.size,
      payingTenants: payingTenants.length,
      averageInvoiceBalance: tenantsWithBalance > 0
        ? rounded(totalBalance / tenantsWithBalance) : 0,
      newTenantsTrend: trend(newTenants, row => row.createdAt, () => 1, filters.grain),
      churnTrend: trend(churnedTenants, row => row.effectiveLeftAt, () => 1, filters.grain),
      churnByReason: formerTenants.reduce((acc, t) => {
        const reason = t.leftReason || 'UNSPECIFIED';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})
    }, filters, propertyIds, { tenantLifecycleVersion: '3.1' }, ['averageTenureDays', 'churnRate']);
  }

  async getTenantChurnAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    // Fetch ALL LEFT tenants — DO NOT filter by leftAt in the DB.
    // Legacy rows may have leftAt = null and would otherwise be silently dropped.
    const allLeftTenants = await this.prisma.tenant.findMany({
      where: {
        unit: { propertyId: { in: propertyIds } },
        status: 'LEFT'
      },
      select: {
        id: true,
        fullName: true,
        rent: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        leftAt: true,
        leftReason: true,
        unit: {
          select: {
            unitNo: true,
            property: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: [
        { leftAt: 'desc' },
        { updatedAt: 'desc' }
      ]
    });

    // Apply the date filter in JS using leftAt || updatedAt.
    let leftTenants = allLeftTenants;
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      leftTenants = allLeftTenants.filter((t) => {
        const effective = t.leftAt || t.updatedAt;
        if (!effective) return false;
        return effective >= filters.start && effective < filters.endExclusive;
      });
    }

    const tenures = leftTenants
      .map((t) => {
        const end = t.leftAt || t.updatedAt;
        if (!t.createdAt || !end) return null;
        return Math.max(
          0,
          Math.floor((new Date(end) - new Date(t.createdAt)) / 86400000)
        );
      })
      .filter((d) => d !== null);

    const activeCount = await this.prisma.tenant.count({
      where: {
        unit: { propertyId: { in: propertyIds } },
        status: 'ACTIVE'
      }
    });

    const totalEver = activeCount + leftTenants.length;

    const byReason = leftTenants.reduce((acc, t) => {
      const reason = t.leftReason || 'UNSPECIFIED';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

    const churnRows = leftTenants.map((t) => ({
      ...t,
      effectiveLeftAt: t.leftAt || t.updatedAt
    }));

    return envelope(
      {
        summary: {
          churnedTenants: leftTenants.length,
          activeTenants: activeCount,
          totalTenantsEver: totalEver,
          churnRate:
            totalEver > 0 ? rounded((leftTenants.length / totalEver) * 100) : null,
          averageTenureDays:
            tenures.length > 0
              ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length)
              : null,
          rentLostToChurn: rounded(
            leftTenants.reduce((sum, t) => sum + positive(t.rent), 0)
          )
        },
        byReason,
        trend: trend(churnRows, (row) => row.effectiveLeftAt, () => 1, filters.grain),
        byProperty: propertyBreakdown(
          leftTenants.map((t) => ({ ...t, property: t.unit?.property })),
          () => 1
        ),
        churnedTenants: leftTenants.map((t) => {
          const effectiveLeftAt = t.leftAt || t.updatedAt;
          return {
            id: t.id,
            name: t.fullName,
            property: t.unit?.property?.name || null,
            unitNo: t.unit?.unitNo || null,
            rent: t.rent,
            joinedAt: t.createdAt,
            leftAt: t.leftAt,             // raw value — may be null on legacy rows
            effectiveLeftAt,              // always populated
            leftReason: t.leftReason,
            tenureDays:
              t.createdAt && effectiveLeftAt
                ? Math.max(
                    0,
                    Math.floor(
                      (new Date(effectiveLeftAt) - new Date(t.createdAt)) / 86400000
                    )
                  )
                : null
          };
        })
      },
      filters,
      propertyIds,
      { churnVersion: '1.2' },
      ['churnRate', 'averageTenureDays']
    );
  }

  async getLeadAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const whereClause = {
      propertyId: { in: propertyIds }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.createdAt = { gte: filters.start, lt: filters.endExclusive };
    }

    const leads = await this.prisma.lead.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        natureOfLead: true,
        createdAt: true,
        property: { select: { id: true, name: true } },
        offerLetters: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            rentAmount: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const leadAnalytics = calculateLeadAnalytics(leads);

    const convertedValue = leads.reduce((sum, l) => {
      const acceptedOffer = l.offerLetters.find(o => o.status === 'ACCEPTED' || o.status === 'CONVERTED');
      return sum + (acceptedOffer?.rentAmount || 0);
    }, 0);

    return envelope({
      summary: {
        ...leadAnalytics.summary,
        conversionValue: rounded(convertedValue),
        averageConversionValue: leadAnalytics.summary.convertedLeads > 0 ?
          rounded(convertedValue / leadAnalytics.summary.convertedLeads) : null
      },
      bySource: leadAnalytics.bySource,
      byStatus: leadAnalytics.byStatus,
      trend: trend(leads, row => row.createdAt, () => 1, filters.grain),
      propertyBreakdown: propertyBreakdown(leads, () => 1)
    }, filters, propertyIds, { leadAnalyticsVersion: '3.1' });
  }

  async getDataQualityAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const baseWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } }
    };

    const invoiceDateFilter = {};
    const billInvoiceDateFilter = {};
    const paymentDateFilter = {};

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceDateFilter.issueDate = { gte: filters.start, lt: filters.endExclusive };
      billInvoiceDateFilter.issueDate = { gte: filters.start, lt: filters.endExclusive };
      paymentDateFilter.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }

    const [invoices, billInvoices, tenants, units, paymentReports] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          ...baseWhereClause,
          ...invoiceDateFilter
        },
        select: { id: true, status: true, balance: true, invoiceNumber: true }
      }),
      // Duplicate detection uses `billReferenceNumber`, which lives on
      // `BillInvoice`. `Bill` is only the reading snapshot and has no
      // reference number, so we count/check BillInvoices here.
      this.prisma.billInvoice.findMany({
        where: {
          ...baseWhereClause,
          ...billInvoiceDateFilter
        },
        select: {
          id: true,
          status: true,
          grandTotal: true,
          amountPaid: true,
          balance: true,
          billReferenceNumber: true,
          invoiceNumber: true
        }
      }),
      this.prisma.tenant.findMany({
        where: { unit: { propertyId: { in: propertyIds } } },
        select: {
          id: true,
          status: true,
          leftAt: true,
          leftReason: true,
          updatedAt: true,
          unit: { select: { status: true } }
        }
      }),
      this.prisma.unit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: unitOccupancySelect
      }),
      this.prisma.paymentReport.findMany({
        where: {
          ...baseWhereClause,
          ...paymentDateFilter
        },
        select: {
          id: true,
          invoices: { select: { id: true } },
          billInvoices: { select: { id: true } }
        }
      })
    ]);

    const dataQuality = calculateDataQuality({
      invoices,
      bills: billInvoices,
      tenants,
      units,
      paymentReports
    });

    return envelope({
      summary: {
        totalInvoices: invoices.length,
        totalBills: billInvoices.length,
        totalTenants: tenants.length,
        totalUnits: units.length,
        totalPayments: paymentReports.length
      },
      dataQuality,
      issues: {
        hasOrphanedInvoices: dataQuality.orphanedInvoices > 0,
        hasInconsistentTenants: dataQuality.inconsistentTenants > 0,
        hasOrphanedUnits: dataQuality.orphanedUnits > 0,
        hasMissingPaymentAllocations: dataQuality.missingPaymentAllocations > 0,
        hasDuplicateRecords:
          dataQuality.duplicateRecords.invoices.length > 0 ||
          dataQuality.duplicateRecords.bills.length > 0,
        hasMissingLeftAt: (dataQuality.leftTenantsMissingLeftAt || 0) > 0
      }
    }, filters, propertyIds, { dataQualityVersion: '3.1' });
  }

  async getPerformanceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const reportWhereClause = {
      propertyId: { in: propertyIds }
    };

    const todoWhereClause = {
      userId: user.id
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      reportWhereClause.reportDate = { gte: filters.start, lt: filters.endExclusive };
      todoWhereClause.createdAt = { gte: filters.start, lt: filters.endExclusive };
    }

    const [dailyReports, todos] = await Promise.all([
      this.prisma.dailyReport.findMany({
        where: reportWhereClause,
        select: { id: true, status: true, reportDate: true, createdAt: true }
      }),
      this.prisma.toDo.findMany({
        where: todoWhereClause,
        select: {
          id: true,
          status: true,
          priority: true,
          createdAt: true,
          completedAt: true,
          dueDate: true,
          title: true
        }
      })
    ]);

    const performanceData = calculatePerformanceAnalytics(dailyReports, todos);

    return envelope({
      summary: performanceData.summary,
      dailyReportTrend: trend(dailyReports, row => row.reportDate, row => row.status === 'SUBMITTED' ? 1 : 0, filters.grain),
      taskTrend: trend(todos, row => row.createdAt, row => row.status === 'COMPLETED' ? 1 : 0, filters.grain),
      byStatus: performanceData.byStatus,
      byPriority: performanceData.byPriority,
      overdueTasks: todos.filter(t => t.status === 'OVERDUE').map(t => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority
      }))
    }, filters, propertyIds, { performanceVersion: '3.1', userId: user.id });
  }

  async getVATAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const invoiceWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' }
    };

    const billInvoiceWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceWhereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
      billInvoiceWhereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const [invoices, billInvoices, tenants] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhereClause,
        select: { id: true, vat: true, totalDue: true, status: true }
      }),
      this.prisma.billInvoice.findMany({
        where: billInvoiceWhereClause,
        select: { id: true, vatAmount: true, grandTotal: true, status: true }
      }),
      this.prisma.tenant.findMany({
        where: {
          unit: { propertyId: { in: propertyIds } },
          status: 'ACTIVE'
        },
        select: { id: true, vatType: true, vatRate: true, withholdingTaxRate: true }
      })
    ]);

    const vatAnalytics = calculateVATAnalytics(invoices, billInvoices, tenants);

    return envelope({
      summary: vatAnalytics.summary,
      invoiceVAT: {
        totalVAT: rounded(invoices.reduce((sum, i) => sum + (i.vat || 0), 0)),
        vatInvoices: invoices.filter(i => i.vat > 0).length,
        vatCollected: rounded(invoices.filter(i => i.status === 'PAID').reduce((sum, i) => sum + (i.vat || 0), 0))
      },
      billVAT: {
        totalVAT: rounded(billInvoices.reduce((sum, b) => sum + (b.vatAmount || 0), 0)),
        vatBillInvoices: billInvoices.filter(b => b.vatAmount > 0).length,
        vatPaid: rounded(billInvoices.filter(b => b.status === 'PAID').reduce((sum, b) => sum + (b.vatAmount || 0), 0))
      },
      tenantVATStatus: {
        vatEligible: tenants.filter(t => t.vatType !== 'NOT_APPLICABLE').length,
        withholdingTaxEligible: tenants.filter(t => (t.withholdingTaxRate || 0) > 0).length,
        exemptTenants: tenants.filter(t => t.vatType === 'NOT_APPLICABLE').length
      }
    }, filters, propertyIds, { vatVersion: '3.1' });
  }

  // ========== DOMAIN METHODS ==========

  async getBillInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      status: { not: 'CANCELLED' },
      tenant: { unit: { propertyId: { in: propertyIds } } }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.billInvoice.findMany({
      where: whereClause,
      select: {
        id: true,
        grandTotal: true,
        amountPaid: true,
        balance: true,
        status: true,
        billType: true,
        issueDate: true,
        dueDate: true,
        tenant: {
          select: {
            unit: {
              select: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      }
    });
    const shaped = rows.map(row => ({ ...row, property: row.tenant?.unit?.property }));
    const billed = rows.reduce((sum, row) => sum + amount(row.grandTotal), 0);
    const paid = rows.reduce((sum, row) => sum + amount(row.amountPaid), 0);
    const outstanding = rows.reduce((sum, row) => sum + amount(row.balance), 0);
    const overdueBalance = rows
      .filter(row => amount(row.balance) > 0 && row.dueDate < filters.asOfExclusive)
      .reduce((sum, row) => sum + amount(row.balance), 0);

    return envelope({
      summary: {
        invoiceCount: rows.length,
        billed: rounded(billed),
        paid: rounded(paid),
        outstanding: rounded(outstanding),
        overdueBillBalance: rounded(overdueBalance),
        collectionRate: billed ? rounded(paid / billed * 100) : null
      },
      trend: trend(rows, row => row.issueDate, row => row.grandTotal, filters.grain),
      byProperty: propertyBreakdown(shaped, row => row.grandTotal),
      statusDistribution: group(rows, row => row.status, row => row.grandTotal),
      categoryDistribution: group(rows, row => row.billType, row => row.grandTotal)
    }, filters, propertyIds, {
      excludedCancelledInvoices: true,
      billOverdueIsNotRentArrears: true,
      currentArrearsSource: 'Invoice'
    });
  }

  async getServiceProviderAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.createdAt = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.serviceProvider.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        chargeAmount: true,
        chargeFrequency: true,
        createdAt: true,
        property: { select: { id: true, name: true } }
      }
    });
    const total = rows.reduce((sum, row) => sum + amount(row.chargeAmount), 0);
    return envelope({
      summary: {
        providerCount: rows.length,
        contractedCharges: rounded(total),
        averageContractedCharge: rows.length ? rounded(total / rows.length) : null
      },
      trend: trend(rows, row => row.createdAt, row => row.chargeAmount, filters.grain),
      byProperty: propertyBreakdown(rows, row => row.chargeAmount),
      statusDistribution: [],
      categoryDistribution: group(rows, row => row.chargeFrequency, row => row.chargeAmount)
    }, filters, propertyIds, {
      contractedChargesOnly: true,
      actualExpensesUnavailable: true
    });
  }

  async getCommissionAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.periodEnd = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.managerCommission.findMany({
      where: whereClause,
      select: {
        id: true,
        commissionAmount: true,
        incomeAmount: true,
        status: true,
        periodEnd: true,
        property: { select: { id: true, name: true } }
      }
    });
    const active = rows.filter(row => row.status !== 'CANCELLED');
    const total = active.reduce((sum, row) => sum + amount(row.commissionAmount), 0);
    return envelope({
      summary: {
        commissionCount: active.length,
        totalCommission: rounded(total),
        paidCommission: rounded(
          active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.commissionAmount), 0)
        ),
        pendingCommission: rounded(
          active.filter(row => ['PENDING', 'PROCESSING'].includes(row.status))
            .reduce((sum, row) => sum + amount(row.commissionAmount), 0)
        )
      },
      trend: trend(active, row => row.periodEnd, row => row.commissionAmount, filters.grain),
      byProperty: propertyBreakdown(active, row => row.commissionAmount),
      statusDistribution: group(rows, row => row.status, row => row.commissionAmount),
      categoryDistribution: []
    }, filters, propertyIds, { excludedCancelledFromFinancialTotals: true });
  }

  async getDemandLetterAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.demandLetter.findMany({
      where: whereClause,
      select: {
        id: true,
        outstandingAmount: true,
        partialPayment: true,
        status: true,
        issueDate: true,
        property: { select: { id: true, name: true } }
      }
    });
    const snapshots = rows.reduce((sum, row) => sum + amount(row.outstandingAmount), 0);
    return envelope({
      summary: {
        letterCount: rows.length,
        documentSnapshotAmount: rounded(snapshots),
        partialPaymentRecorded: rounded(rows.reduce((sum, row) => sum + amount(row.partialPayment), 0)),
        settledCount: rows.filter(row => row.status === 'SETTLED').length,
        escalatedCount: rows.filter(row => row.status === 'ESCALATED').length
      },
      trend: trend(rows, row => row.issueDate, row => row.outstandingAmount, filters.grain),
      byProperty: propertyBreakdown(rows, row => row.outstandingAmount),
      statusDistribution: group(rows, row => row.status, row => row.outstandingAmount),
      categoryDistribution: []
    }, filters, propertyIds, {
      amountsAreDocumentSnapshots: true,
      currentArrearsSource: 'Invoice'
    });
  }

  async getTenantAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);

    const [rows, formerTenantsCount] = await Promise.all([
      this.prisma.tenant.findMany({
        where: {
          unit: { propertyId: { in: propertyIds } },
          status: 'ACTIVE'
        },
        select: {
          id: true,
          rent: true,
          deposit: true,
          paymentPolicy: true,
          status: true,
          createdAt: true,
          leftAt: true,
          leftReason: true,
          unit: { select: { property: { select: { id: true, name: true } } } }
        }
      }),
      this.prisma.tenant.count({
        where: {
          unit: { propertyId: { in: propertyIds } },
          status: 'LEFT'
        }
      })
    ]);

    const shaped = rows.map(row => ({ ...row, property: row.unit?.property }));
    const rentRoll = rows.reduce((sum, row) => sum + amount(row.rent), 0);

    let additions = rows;
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      additions = rows.filter(row => row.createdAt >= filters.start && row.createdAt < filters.endExclusive);
    }

    return envelope({
      summary: {
        currentTenants: rows.length,
        formerTenants: formerTenantsCount,
        totalTenantsEver: rows.length + formerTenantsCount,
        currentRentRoll: rounded(rentRoll),
        averageRent: rows.length ? rounded(rentRoll / rows.length) : null,
        depositsHeld: rounded(rows.reduce((sum, row) => sum + amount(row.deposit), 0))
      },
      trend: trend(additions, row => row.createdAt, row => row.rent, filters.grain),
      byProperty: propertyBreakdown(shaped, row => row.rent),
      statusDistribution: [],
      categoryDistribution: group(rows, row => row.paymentPolicy, row => row.rent)
    }, filters, propertyIds, {
      currentRecordsSnapshot: true,
      lifecycleStatusAvailable: true
    });
  }

  async getOtherIncomeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) {
      throw new AnalyticsAccessError(
        'Other Income cannot be filtered by property or landlord because no reliable relationship exists'
      );
    }

    const whereClause = {
      ...(user.role === 'MANAGER' ? { managerId: user.id } : {})
    };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.otherIncome.findMany({
      where: whereClause,
      select: {
        id: true,
        totalAmount: true,
        vatAmount: true,
        status: true,
        category: true,
        currency: true,
        issueDate: true
      }
    });
    const active = rows.filter(row => row.status !== 'CANCELLED' && row.currency === 'KES');
    const total = active.reduce((sum, row) => sum + amount(row.totalAmount), 0);
    return envelope({
      scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER',
      summary: {
        invoiceCount: active.length,
        invoicedAmount: rounded(total),
        paidDocumentAmount: rounded(
          active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.totalAmount), 0)
        ),
        vatAmount: rounded(active.reduce((sum, row) => sum + amount(row.vatAmount), 0))
      },
      trend: trend(active, row => row.issueDate, row => row.totalAmount, filters.grain),
      byProperty: null,
      statusDistribution: group(rows.filter(row => row.currency === 'KES'), row => row.status, row => row.totalAmount),
      categoryDistribution: group(active, row => row.category, row => row.totalAmount)
    }, filters, [], {
      propertyAttributionUnavailable: true,
      paidAmountIsDocumentStatusValue: true,
      reportingCurrency: 'KES',
      excludedNonKesRecords: rows.filter(row => row.currency !== 'KES').length
    });
  }

  async getEmployeeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) {
      throw new AnalyticsAccessError(
        'Employees and salary payments cannot be filtered by property because no reliable assignment exists'
      );
    }
    const owner = user.role === 'MANAGER' ? { createdById: user.id } : {};

    const employeeWhereClause = { ...owner };
    const paymentWhereClause = { employee: owner };

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      paymentWhereClause.paymentDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const [employees, payments] = await Promise.all([
      this.prisma.employee.findMany({
        where: employeeWhereClause,
        select: {
          id: true,
          salaryAmount: true,
          status: true,
          jobTitle: true,
          paymentFrequency: true
        }
      }),
      this.prisma.salaryPayment.findMany({
        where: paymentWhereClause,
        select: {
          id: true,
          amount: true,
          status: true,
          paymentDate: true,
          paymentMethod: true
        }
      })
    ]);
    const salary = employees.reduce((sum, row) => sum + amount(row.salaryAmount), 0);
    return envelope({
      scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER',
      summary: {
        employeeCount: employees.length,
        activeEmployees: employees.filter(row => row.status === 'ACTIVE').length,
        configuredSalaryTotal: rounded(salary),
        averageConfiguredSalary: employees.length ? rounded(salary / employees.length) : null,
        salaryPaidInRange: rounded(
          payments.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.amount), 0)
        )
      },
      trend: trend(payments, row => row.paymentDate, row => row.amount, filters.grain),
      byProperty: null,
      statusDistribution: group(employees, row => row.status, row => row.salaryAmount),
      categoryDistribution: group(employees, row => row.jobTitle, row => row.salaryAmount),
      paymentDistribution: group(payments, row => row.paymentMethod, row => row.amount)
    }, filters, [], {
      propertyAttributionUnavailable: true,
      configuredSalaryNotNormalized: true
    });
  }
}

export default new AnalyticsService();