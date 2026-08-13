// analytics.service.js
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

const propertyBreakdown = (rows, value) => group(rows, row => row.property?.id, value).map(item => {
  const row = rows.find(candidate => candidate.property?.id === item.label);
  return { propertyId: item.label, propertyName: row?.property?.name || 'Unknown property', count: item.count, amount: item.amount };
}).sort((a, b) => b.amount - a.amount || a.propertyName.localeCompare(b.propertyName));

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

const envelope = (data, filters, propertyIds, dataQuality = {}) => ({
  success: true,
  data,
  meta: {
    generatedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    currency: 'KES',
    filters: publicFilters(filters),
    accessiblePropertyIds: propertyIds,
    freshness: 'live',
    definitionsVersion: '2.0',
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

  // Helper to build date filter
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

  // ========== HELPER METHODS FOR BILL INVOICES ==========
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

  // ========== EXISTING METHODS ==========
  
  async getReceivablesSummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const [periodInvoices, openInvoices] = await Promise.all([
      this.periodInvoices(propertyIds, filters),
      this.openInvoices(propertyIds, filters)
    ]);
    const data = calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive);
    return envelope(data, filters, propertyIds, { excludedCancelledInvoices: true });
  }

  async getStatusDistribution(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters);
    return envelope(calculateStatusDistribution(invoices), filters, propertyIds, { excludedCancelledInvoices: true });
  }

  async getReceivablesTrend(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters);
    return envelope({ series: calculateReceivablesTrend(invoices, filters.grain) }, filters, propertyIds, { excludedCancelledInvoices: true });
  }

  async getCollectionsTrend(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { in: ['PAID', 'PARTIAL', 'UNPAID', 'CREDIT', 'PREPAID'] }
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }

    const reports = await this.prisma.paymentReport.findMany({
      where: whereClause,
      select: { id: true, amountPaid: true, status: true, datePaid: true },
      orderBy: { datePaid: 'asc' }
    });
    const result = calculateCollectionsTrend(reports, filters.grain);
    return envelope({ series: result.series }, filters, propertyIds, result.dataQuality);
  }

  async getRevenueByProperty(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const invoices = await this.periodInvoices(propertyIds, filters, true);
    return envelope({ properties: calculateRevenueByProperty(invoices) }, filters, propertyIds, { excludedCancelledInvoices: true });
  }

  async getOccupancySummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const units = await this.prisma.unit.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, status: true, tenant: { select: { id: true } } }
    });
    const occupiedWithoutTenant = units.filter(unit => unit.status === 'OCCUPIED' && !unit.tenant).length;
    return envelope(calculateOccupancy(units), filters, propertyIds, { occupiedWithoutTenant });
  }

  async getTenantsSummary(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const currentTenants = await this.prisma.tenant.count({
      where: { unit: { propertyId: { in: propertyIds } } }
    });
    return envelope({ currentTenants }, filters, propertyIds, { lifecycleStatusUnavailable: true });
  }

  async getOverview(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const [periodInvoices, openInvoices, units, currentTenants] = await Promise.all([
      this.periodInvoices(propertyIds, filters),
      this.openInvoices(propertyIds, filters),
      this.prisma.unit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: { id: true, status: true, tenant: { select: { id: true } } }
      }),
      this.prisma.tenant.count({ where: { unit: { propertyId: { in: propertyIds } } } })
    ]);

    return envelope({
      receivables: calculateReceivables(periodInvoices, openInvoices, filters.asOfExclusive),
      occupancy: calculateOccupancy(units),
      tenants: { currentTenants }
    }, filters, propertyIds, {
      excludedCancelledInvoices: true,
      occupiedWithoutTenant: units.filter(unit => unit.status === 'OCCUPIED' && !unit.tenant).length,
      lifecycleStatusUnavailable: true
    });
  }

  // ========== NEW METHODS ==========

  // 1. COMPREHENSIVE INVOICE OVERVIEW (Rent + Bill Invoices)
  async getComprehensiveInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const [rentInvoices, billInvoices] = await Promise.all([
      this.periodInvoices(propertyIds, filters, true),
      this.periodBillInvoices(propertyIds, filters, true)
    ]);

    const comprehensive = calculateComprehensiveInvoiceAnalytics(rentInvoices, billInvoices);
    const performance = calculateInvoicePerformanceMetrics(rentInvoices, billInvoices);
    
    // Get aging for both types
    const rentAging = calculateAgingBuckets(rentInvoices);
    const billAging = calculateAgingBuckets(billInvoices.map(b => ({
      ...b,
      totalDue: b.grandTotal,
      amountPaid: b.amountPaid
    })));

    return envelope({
      summary: comprehensive.summary,
      performance,
      aging: {
        rentInvoices: rentAging,
        billInvoices: billAging,
        combined: calculateAgingBuckets([
          ...rentInvoices,
          ...billInvoices.map(b => ({
            ...b,
            totalDue: b.grandTotal,
            amountPaid: b.amountPaid
          }))
        ])
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
      comprehensiveInvoiceVersion: '2.0',
      includesRentInvoices: true,
      includesBillInvoices: true
    });
  }

  // 2. RENT INVOICE ANALYTICS (Detailed)
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
    const aging = calculateAgingBuckets(periodInvoices);
    
    // Payment performance
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
      rentInvoiceVersion: '2.0',
      excludedCancelledInvoices: true
    });
  }

  // 3. BILL INVOICE ANALYTICS (Detailed)
  async getBillInvoiceAnalyticsDetailed(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const [periodBillInvoices, openBillInvoices] = await Promise.all([
      this.periodBillInvoices(propertyIds, filters, true),
      this.openBillInvoices(propertyIds, filters)
    ]);

    const analytics = calculateBillInvoiceAnalytics(periodBillInvoices);
    const aging = calculateAgingBuckets(periodBillInvoices.map(b => ({
      ...b,
      totalDue: b.grandTotal,
      amountPaid: b.amountPaid
    })));
    
    // Detailed breakdown by bill type
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
      billInvoiceVersion: '2.0',
      excludedCancelledInvoices: true
    });
  }

  // 4. INVOICE AGING REPORT
  async getInvoiceAgingReport(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const [rentInvoices, billInvoices] = await Promise.all([
      this.openInvoices(propertyIds, filters),
      this.openBillInvoices(propertyIds, filters)
    ]);

    const rentAging = calculateAgingBuckets(rentInvoices);
    const billAging = calculateAgingBuckets(billInvoices.map(b => ({
      ...b,
      totalDue: b.grandTotal,
      amountPaid: b.amountPaid
    })));
    
    const combinedAging = calculateAgingBuckets([
      ...rentInvoices,
      ...billInvoices.map(b => ({
        ...b,
        totalDue: b.grandTotal,
        amountPaid: b.amountPaid
      }))
    ]);

    // Get aging details for each bucket
    const getAgingDetails = (invoices, bucket) => {
      const now = new Date();
      return invoices.filter(inv => {
        if (inv.status === 'PAID' || inv.status === 'CANCELLED') return false;
        if (positive(inv.balance) <= 0) return false;
        
        const dueDate = new Date(inv.dueDate);
        const daysOverdue = Math.max(0, Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)));
        
        if (bucket === 'current') return daysOverdue === 0;
        if (bucket === '1-30') return daysOverdue > 0 && daysOverdue <= 30;
        if (bucket === '31-60') return daysOverdue > 30 && daysOverdue <= 60;
        if (bucket === '61-90') return daysOverdue > 60 && daysOverdue <= 90;
        if (bucket === '90+') return daysOverdue > 90;
        return false;
      });
    };

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
        current: getAgingDetails([...rentInvoices, ...billInvoices], 'current'),
        '1-30': getAgingDetails([...rentInvoices, ...billInvoices], '1-30'),
        '31-60': getAgingDetails([...rentInvoices, ...billInvoices], '31-60'),
        '61-90': getAgingDetails([...rentInvoices, ...billInvoices], '61-90'),
        '90+': getAgingDetails([...rentInvoices, ...billInvoices], '90+')
      }
    }, filters, propertyIds, {
      agingReportVersion: '2.0',
      asOf: filters.asOf
    });
  }

  // 5. INVOICE RECONCILIATION REPORT
  async getInvoiceReconciliationReport(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const invoiceWhereClause = {
      ...this.invoicePropertyWhere(propertyIds),
      status: { not: 'CANCELLED' }
    };

    // Only apply date filter if provided
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

    // Find unallocated payments
    const unallocatedPayments = paymentReports.filter(p => 
      p.invoices.length === 0 && p.billInvoices.length === 0
    );

    // Find invoices with partial allocations
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
          number: inv.invoiceNumber || inv.invoiceNumber,
          totalDue: inv.totalDue || inv.grandTotal,
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
      reconciliationVersion: '2.0'
    });
  }

  // 6. BILL ANALYTICS - With optional date filter
  async getBillAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const whereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } },
      status: { not: 'CANCELLED' }
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issuedAt = { gte: filters.start, lt: filters.endExclusive };
    }

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
          select: { id: true, status: true, grandTotal: true, amountPaid: true }
        }
      },
      orderBy: { issuedAt: 'asc' }
    });

    // Calculate balance in JavaScript (Bill model doesn't have balance field)
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
    }, filters, propertyIds, { billAnalyticsVersion: '1.0' });
  }

  // 7. TENANT LIFECYCLE ANALYTICS - With optional date filter
  async getTenantLifecycleAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const tenantWhereClause = {
      unit: { propertyId: { in: propertyIds } }
    };

    // Build invoice date filter
    const invoiceDateFilter = {};
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceDateFilter.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }
    
    const [tenants, units, openInvoices, openBillInvoices] = await Promise.all([
      this.prisma.tenant.findMany({
        where: tenantWhereClause,
        select: {
          id: true,
          fullName: true,
          rent: true,
          deposit: true,
          createdAt: true,
          updatedAt: true,
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
        select: { id: true, status: true, tenant: { select: { id: true } } }
      }),
      // Get all open invoices (not date filtered) to check for arrears
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

    // Calculate tenants with arrears (based on open invoices with balance > 0)
    const tenantIdsWithArrears = new Set();
    
    // Add tenants with rent invoice arrears
    for (const invoice of openInvoices) {
      if (invoice.tenantId) {
        tenantIdsWithArrears.add(invoice.tenantId);
      }
    }
    
    // Add tenants with bill invoice arrears
    for (const billInvoice of openBillInvoices) {
      if (billInvoice.tenantId) {
        tenantIdsWithArrears.add(billInvoice.tenantId);
      }
    }
    
    const lifecycleData = calculateTenantLifecycle(tenants, units);
    
    // Calculate paying tenants (tenants who have made payments)
    const payingTenants = tenants.filter(t =>
      t.invoices.some(i => i.status === 'PAID' || i.amountPaid > 0)
    );

    // Filter new tenants by date if provided
    let newTenants = tenants;
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      newTenants = tenants.filter(t => 
        t.createdAt >= filters.start && t.createdAt < filters.endExclusive
      );
    }

    // Calculate average invoice balance correctly
    let totalBalance = 0;
    let tenantsWithBalance = 0;
    
    for (const tenant of tenants) {
      // Check rent invoices
      let tenantBalance = 0;
      for (const invoice of tenant.invoices) {
        if (invoice.status !== 'PAID' && invoice.status !== 'CANCELLED') {
          const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
          if (balance > 0) {
            tenantBalance += balance;
          }
        }
      }
      // Check bill invoices
      for (const billInvoice of tenant.billInvoices) {
        if (billInvoice.status !== 'PAID' && billInvoice.status !== 'CANCELLED') {
          const balance = billInvoice.balance || (billInvoice.grandTotal - billInvoice.amountPaid);
          if (balance > 0) {
            tenantBalance += balance;
          }
        }
      }
      if (tenantBalance > 0) {
        totalBalance += tenantBalance;
        tenantsWithBalance++;
      }
    }

    return envelope({
      summary: lifecycleData.summary,
      tenantsWithArrears: tenantIdsWithArrears.size,
      payingTenants: payingTenants.length,
      averageInvoiceBalance: tenantsWithBalance > 0 ? 
        rounded(totalBalance / tenantsWithBalance) : 0,
      newTenantsTrend: trend(
        newTenants,
        row => row.createdAt,
        row => 1,
        filters.grain
      )
    }, filters, propertyIds, { tenantLifecycleVersion: '1.0' });
  }

  // 8. LEAD ANALYTICS - With optional date filter
  async getLeadAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    // Only apply date filter if provided
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
      trend: trend(leads, row => row.createdAt, row => 1, filters.grain),
      propertyBreakdown: propertyBreakdown(leads, row => 1)
    }, filters, propertyIds, { leadAnalyticsVersion: '1.0' });
  }

  // 9. DATA QUALITY ANALYTICS - With optional date filter (FIXED)
  async getDataQualityAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const baseWhereClause = {
      tenant: { unit: { propertyId: { in: propertyIds } } }
    };

    // Build date filters for different models
    const invoiceDateFilter = {};
    const billDateFilter = {};
    const paymentDateFilter = {};

    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      invoiceDateFilter.issueDate = { gte: filters.start, lt: filters.endExclusive };
      billDateFilter.issuedAt = { gte: filters.start, lt: filters.endExclusive };
      paymentDateFilter.datePaid = { gte: filters.start, lt: filters.endExclusive };
    }

    const [invoices, bills, tenants, units, paymentReports] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { 
          ...baseWhereClause,
          ...invoiceDateFilter
        },
        select: { id: true, status: true, balance: true, invoiceNumber: true }
      }),
      this.prisma.bill.findMany({
        where: { 
          ...baseWhereClause,
          ...billDateFilter
        },
        // Remove billReferenceNumber - it doesn't exist on Bill model
        select: { id: true, status: true, totalAmount: true, amountPaid: true }
      }),
      this.prisma.tenant.findMany({
        where: { unit: { propertyId: { in: propertyIds } } },
        select: { id: true, unit: { select: { status: true } } }
      }),
      this.prisma.unit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: { id: true, status: true, tenant: { select: { id: true } } }
      }),
      this.prisma.paymentReport.findMany({
        where: { 
          ...baseWhereClause,
          ...paymentDateFilter
        },
        select: { id: true, invoices: { select: { id: true } }, billInvoices: { select: { id: true } } }
      })
    ]);

    // Calculate bill balance in JavaScript
    const billsWithBalance = bills.map(bill => ({
      ...bill,
      balance: bill.totalAmount - bill.amountPaid
    }));

    const dataQuality = calculateDataQuality({
      invoices,
      bills: billsWithBalance,
      tenants,
      units,
      paymentReports
    });

    return envelope({
      summary: {
        totalInvoices: invoices.length,
        totalBills: bills.length,
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
        hasDuplicateRecords: dataQuality.duplicateRecords.invoices.length > 0 || 
                          dataQuality.duplicateRecords.bills.length > 0
      }
    }, filters, propertyIds, { dataQualityVersion: '1.0' });
  }
  // 10. PERFORMANCE ANALYTICS - With optional date filter
  async getPerformanceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    
    const reportWhereClause = {
      propertyId: { in: propertyIds }
    };

    const todoWhereClause = {
      userId: user.id
    };

    // Only apply date filter if provided
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
    }, filters, propertyIds, { performanceVersion: '1.0', userId: user.id });
  }

  // 11. VAT ANALYTICS - With optional date filter
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

    // Only apply date filter if provided
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
        where: { unit: { propertyId: { in: propertyIds } } },
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
    }, filters, propertyIds, { vatVersion: '1.0' });
  }

  // ========== EXISTING METHODS (Keep these as they are) ==========
  
  async getBillInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      status: { not: 'CANCELLED' },
      tenant: { unit: { propertyId: { in: propertyIds } } }
    };

    // Only apply date filter if provided
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
    const overdueBalance = rows.filter(row => amount(row.balance) > 0 && row.dueDate < filters.asOfExclusive).reduce((sum, row) => sum + amount(row.balance), 0);
    return envelope({ summary: { invoiceCount: rows.length, billed: rounded(billed), paid: rounded(paid), outstanding: rounded(outstanding), overdueBillBalance: rounded(overdueBalance), collectionRate: billed ? rounded(paid / billed * 100) : null },
      trend: trend(rows, row => row.issueDate, row => row.grandTotal, filters.grain), byProperty: propertyBreakdown(shaped, row => row.grandTotal),
      statusDistribution: group(rows, row => row.status, row => row.grandTotal), categoryDistribution: group(rows, row => row.billType, row => row.grandTotal) }, filters, propertyIds, { excludedCancelledInvoices: true, billOverdueIsNotRentArrears: true, currentArrearsSource: 'Invoice' });
  }

  async getServiceProviderAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.createdAt = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.serviceProvider.findMany({
      where: whereClause,
      select: { id: true, name: true, chargeAmount: true, chargeFrequency: true, createdAt: true, property: { select: { id: true, name: true } } } 
    });
    const total = rows.reduce((sum, row) => sum + amount(row.chargeAmount), 0);
    return envelope({ summary: { providerCount: rows.length, contractedCharges: rounded(total), averageContractedCharge: rows.length ? rounded(total / rows.length) : null },
      trend: trend(rows, row => row.createdAt, row => row.chargeAmount, filters.grain), byProperty: propertyBreakdown(rows, row => row.chargeAmount),
      statusDistribution: [], categoryDistribution: group(rows, row => row.chargeFrequency, row => row.chargeAmount) }, filters, propertyIds, { contractedChargesOnly: true, actualExpensesUnavailable: true });
  }

  async getCommissionAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.periodEnd = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.managerCommission.findMany({
      where: whereClause,
      select: { id: true, commissionAmount: true, incomeAmount: true, status: true, periodEnd: true, property: { select: { id: true, name: true } } } 
    });
    const active = rows.filter(row => row.status !== 'CANCELLED');
    const total = active.reduce((sum, row) => sum + amount(row.commissionAmount), 0);
    return envelope({ summary: { commissionCount: active.length, totalCommission: rounded(total), paidCommission: rounded(active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.commissionAmount), 0)), pendingCommission: rounded(active.filter(row => ['PENDING', 'PROCESSING'].includes(row.status)).reduce((sum, row) => sum + amount(row.commissionAmount), 0)) },
      trend: trend(active, row => row.periodEnd, row => row.commissionAmount, filters.grain), byProperty: propertyBreakdown(active, row => row.commissionAmount), statusDistribution: group(rows, row => row.status, row => row.commissionAmount), categoryDistribution: [] }, filters, propertyIds, { excludedCancelledFromFinancialTotals: true });
  }

  async getDemandLetterAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const whereClause = {
      propertyId: { in: propertyIds }
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.demandLetter.findMany({
      where: whereClause,
      select: { id: true, outstandingAmount: true, partialPayment: true, status: true, issueDate: true, property: { select: { id: true, name: true } } } 
    });
    const snapshots = rows.reduce((sum, row) => sum + amount(row.outstandingAmount), 0);
    return envelope({ summary: { letterCount: rows.length, documentSnapshotAmount: rounded(snapshots), partialPaymentRecorded: rounded(rows.reduce((sum, row) => sum + amount(row.partialPayment), 0)), settledCount: rows.filter(row => row.status === 'SETTLED').length, escalatedCount: rows.filter(row => row.status === 'ESCALATED').length },
      trend: trend(rows, row => row.issueDate, row => row.outstandingAmount, filters.grain), byProperty: propertyBreakdown(rows, row => row.outstandingAmount), statusDistribution: group(rows, row => row.status, row => row.outstandingAmount), categoryDistribution: [] }, filters, propertyIds, { amountsAreDocumentSnapshots: true, currentArrearsSource: 'Invoice' });
  }

  async getTenantAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const rows = await this.prisma.tenant.findMany({ 
      where: { unit: { propertyId: { in: propertyIds } } }, 
      select: { id: true, rent: true, deposit: true, paymentPolicy: true, createdAt: true, unit: { select: { property: { select: { id: true, name: true } } } } } 
    });
    const shaped = rows.map(row => ({ ...row, property: row.unit?.property }));
    const rentRoll = rows.reduce((sum, row) => sum + amount(row.rent), 0);
    
    // Filter additions by date if provided
    let additions = rows;
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      additions = rows.filter(row => row.createdAt >= filters.start && row.createdAt < filters.endExclusive);
    }
    
    return envelope({ summary: { currentTenants: rows.length, currentRentRoll: rounded(rentRoll), averageRent: rows.length ? rounded(rentRoll / rows.length) : null, depositsHeld: rounded(rows.reduce((sum, row) => sum + amount(row.deposit), 0)) },
      trend: trend(additions, row => row.createdAt, row => row.rent, filters.grain), byProperty: propertyBreakdown(shaped, row => row.rent), statusDistribution: [], categoryDistribution: group(rows, row => row.paymentPolicy, row => row.rent) }, filters, propertyIds, { lifecycleStatusUnavailable: true, currentRecordsSnapshot: true });
  }

  async getOtherIncomeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) throw new AnalyticsAccessError('Other Income cannot be filtered by property or landlord because no reliable relationship exists');
    
    const whereClause = {
      ...(user.role === 'MANAGER' ? { managerId: user.id } : {})
    };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      whereClause.issueDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const rows = await this.prisma.otherIncome.findMany({ 
      where: whereClause, 
      select: { id: true, totalAmount: true, vatAmount: true, status: true, category: true, currency: true, issueDate: true } 
    });
    const active = rows.filter(row => row.status !== 'CANCELLED' && row.currency === 'KES');
    const total = active.reduce((sum, row) => sum + amount(row.totalAmount), 0);
    return envelope({ scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER', summary: { invoiceCount: active.length, invoicedAmount: rounded(total), paidDocumentAmount: rounded(active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.totalAmount), 0)), vatAmount: rounded(active.reduce((sum, row) => sum + amount(row.vatAmount), 0)) },
      trend: trend(active, row => row.issueDate, row => row.totalAmount, filters.grain), byProperty: null, statusDistribution: group(rows.filter(row => row.currency === 'KES'), row => row.status, row => row.totalAmount), categoryDistribution: group(active, row => row.category, row => row.totalAmount) }, filters, [], { propertyAttributionUnavailable: true, paidAmountIsDocumentStatusValue: true, reportingCurrency: 'KES', excludedNonKesRecords: rows.filter(row => row.currency !== 'KES').length });
  }

  async getEmployeeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) throw new AnalyticsAccessError('Employees and salary payments cannot be filtered by property because no reliable assignment exists');
    const owner = user.role === 'MANAGER' ? { createdById: user.id } : {};
    
    const employeeWhereClause = { ...owner };
    const paymentWhereClause = { employee: owner };

    // Only apply date filter if provided
    if (filters.hasDateFilter && filters.start && filters.endExclusive) {
      paymentWhereClause.paymentDate = { gte: filters.start, lt: filters.endExclusive };
    }

    const [employees, payments] = await Promise.all([
      this.prisma.employee.findMany({ where: employeeWhereClause, select: { id: true, salaryAmount: true, status: true, jobTitle: true, paymentFrequency: true } }),
      this.prisma.salaryPayment.findMany({ where: paymentWhereClause, select: { id: true, amount: true, status: true, paymentDate: true, paymentMethod: true } })
    ]);
    const salary = employees.reduce((sum, row) => sum + amount(row.salaryAmount), 0);
    return envelope({ scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER', summary: { employeeCount: employees.length, activeEmployees: employees.filter(row => row.status === 'ACTIVE').length, configuredSalaryTotal: rounded(salary), averageConfiguredSalary: employees.length ? rounded(salary / employees.length) : null, salaryPaidInRange: rounded(payments.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.amount), 0)) },
      trend: trend(payments, row => row.paymentDate, row => row.amount, filters.grain), byProperty: null, statusDistribution: group(employees, row => row.status, row => row.salaryAmount), categoryDistribution: group(employees, row => row.jobTitle, row => row.salaryAmount), paymentDistribution: group(payments, row => row.paymentMethod, row => row.amount) }, filters, [], { propertyAttributionUnavailable: true, configuredSalaryNotNormalized: true });
  }
}

export default new AnalyticsService();