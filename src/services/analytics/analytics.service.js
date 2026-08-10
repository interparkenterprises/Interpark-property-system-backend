import prisma from '../../lib/prisma.js';
import permissionService from '../permissionService.js';
import {
  calculateCollectionsTrend,
  calculateOccupancy,
  calculateReceivables,
  calculateReceivablesTrend,
  calculateRevenueByProperty,
  calculateStatusDistribution
} from './analyticsCalculations.js';
import { publicFilters, TIMEZONE } from './analyticsFilter.service.js';

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
  totalDue: true,
  amountPaid: true,
  balance: true,
  status: true,
  issueDate: true,
  dueDate: true
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
    definitionsVersion: '1.0',
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

  async periodInvoices(propertyIds, filters, includeProperty = false) {
    return this.prisma.invoice.findMany({
      where: {
        ...this.invoicePropertyWhere(propertyIds),
        status: { not: 'CANCELLED' },
        dueDate: { gte: filters.start, lt: filters.endExclusive }
      },
      select: includeProperty ? {
        ...invoiceSelect,
        tenant: { select: { unit: { select: { property: { select: { id: true, name: true } } } } } }
      } : invoiceSelect,
      orderBy: { dueDate: 'asc' }
    });
  }

  async openInvoices(propertyIds, filters) {
    return this.prisma.invoice.findMany({
      where: {
        ...this.invoicePropertyWhere(propertyIds),
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
        issueDate: { lt: filters.asOfExclusive },
        balance: { gt: 0 }
      },
      select: invoiceSelect
    });
  }

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
    const reports = await this.prisma.paymentReport.findMany({
      where: {
        tenant: { unit: { propertyId: { in: propertyIds } } },
        datePaid: { gte: filters.start, lt: filters.endExclusive },
        status: { in: ['PAID', 'PARTIAL', 'UNPAID', 'CREDIT', 'PREPAID'] }
      },
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

  async getBillInvoiceAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const rows = await this.prisma.billInvoice.findMany({ where: {
      status: { not: 'CANCELLED' }, issueDate: { gte: filters.start, lt: filters.endExclusive },
      tenant: { unit: { propertyId: { in: propertyIds } } }
    }, select: { id: true, grandTotal: true, amountPaid: true, balance: true, status: true, billType: true, issueDate: true, dueDate: true,
      tenant: { select: { unit: { select: { property: { select: { id: true, name: true } } } } } } } });
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
    const rows = await this.prisma.serviceProvider.findMany({ where: { propertyId: { in: propertyIds }, createdAt: { gte: filters.start, lt: filters.endExclusive } },
      select: { id: true, name: true, chargeAmount: true, chargeFrequency: true, createdAt: true, property: { select: { id: true, name: true } } } });
    const total = rows.reduce((sum, row) => sum + amount(row.chargeAmount), 0);
    return envelope({ summary: { providerCount: rows.length, contractedCharges: rounded(total), averageContractedCharge: rows.length ? rounded(total / rows.length) : null },
      trend: trend(rows, row => row.createdAt, row => row.chargeAmount, filters.grain), byProperty: propertyBreakdown(rows, row => row.chargeAmount),
      statusDistribution: [], categoryDistribution: group(rows, row => row.chargeFrequency, row => row.chargeAmount) }, filters, propertyIds, { contractedChargesOnly: true, actualExpensesUnavailable: true });
  }

  async getCommissionAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const rows = await this.prisma.managerCommission.findMany({ where: { propertyId: { in: propertyIds }, periodEnd: { gte: filters.start, lt: filters.endExclusive } },
      select: { id: true, commissionAmount: true, incomeAmount: true, status: true, periodEnd: true, property: { select: { id: true, name: true } } } });
    const active = rows.filter(row => row.status !== 'CANCELLED');
    const total = active.reduce((sum, row) => sum + amount(row.commissionAmount), 0);
    return envelope({ summary: { commissionCount: active.length, totalCommission: rounded(total), paidCommission: rounded(active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.commissionAmount), 0)), pendingCommission: rounded(active.filter(row => ['PENDING', 'PROCESSING'].includes(row.status)).reduce((sum, row) => sum + amount(row.commissionAmount), 0)) },
      trend: trend(active, row => row.periodEnd, row => row.commissionAmount, filters.grain), byProperty: propertyBreakdown(active, row => row.commissionAmount), statusDistribution: group(rows, row => row.status, row => row.commissionAmount), categoryDistribution: [] }, filters, propertyIds, { excludedCancelledFromFinancialTotals: true });
  }

  async getDemandLetterAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const rows = await this.prisma.demandLetter.findMany({ where: { propertyId: { in: propertyIds }, issueDate: { gte: filters.start, lt: filters.endExclusive } },
      select: { id: true, outstandingAmount: true, partialPayment: true, status: true, issueDate: true, property: { select: { id: true, name: true } } } });
    const snapshots = rows.reduce((sum, row) => sum + amount(row.outstandingAmount), 0);
    return envelope({ summary: { letterCount: rows.length, documentSnapshotAmount: rounded(snapshots), partialPaymentRecorded: rounded(rows.reduce((sum, row) => sum + amount(row.partialPayment), 0)), settledCount: rows.filter(row => row.status === 'SETTLED').length, escalatedCount: rows.filter(row => row.status === 'ESCALATED').length },
      trend: trend(rows, row => row.issueDate, row => row.outstandingAmount, filters.grain), byProperty: propertyBreakdown(rows, row => row.outstandingAmount), statusDistribution: group(rows, row => row.status, row => row.outstandingAmount), categoryDistribution: [] }, filters, propertyIds, { amountsAreDocumentSnapshots: true, currentArrearsSource: 'Invoice' });
  }

  async getTenantAnalytics(user, filters) {
    const propertyIds = await this.resolveScope(user, filters);
    const rows = await this.prisma.tenant.findMany({ where: { unit: { propertyId: { in: propertyIds } } }, select: { id: true, rent: true, deposit: true, paymentPolicy: true, createdAt: true, unit: { select: { property: { select: { id: true, name: true } } } } } });
    const shaped = rows.map(row => ({ ...row, property: row.unit?.property }));
    const rentRoll = rows.reduce((sum, row) => sum + amount(row.rent), 0);
    const additions = rows.filter(row => row.createdAt >= filters.start && row.createdAt < filters.endExclusive);
    return envelope({ summary: { currentTenants: rows.length, currentRentRoll: rounded(rentRoll), averageRent: rows.length ? rounded(rentRoll / rows.length) : null, depositsHeld: rounded(rows.reduce((sum, row) => sum + amount(row.deposit), 0)) },
      trend: trend(additions, row => row.createdAt, row => row.rent, filters.grain), byProperty: propertyBreakdown(shaped, row => row.rent), statusDistribution: [], categoryDistribution: group(rows, row => row.paymentPolicy, row => row.rent) }, filters, propertyIds, { lifecycleStatusUnavailable: true, currentRecordsSnapshot: true });
  }

  async getOtherIncomeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) throw new AnalyticsAccessError('Other Income cannot be filtered by property or landlord because no reliable relationship exists');
    const where = { issueDate: { gte: filters.start, lt: filters.endExclusive }, ...(user.role === 'MANAGER' ? { managerId: user.id } : {}) };
    const rows = await this.prisma.otherIncome.findMany({ where, select: { id: true, totalAmount: true, vatAmount: true, status: true, category: true, currency: true, issueDate: true } });
    const active = rows.filter(row => row.status !== 'CANCELLED' && row.currency === 'KES');
    const total = active.reduce((sum, row) => sum + amount(row.totalAmount), 0);
    return envelope({ scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER', summary: { invoiceCount: active.length, invoicedAmount: rounded(total), paidDocumentAmount: rounded(active.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.totalAmount), 0)), vatAmount: rounded(active.reduce((sum, row) => sum + amount(row.vatAmount), 0)) },
      trend: trend(active, row => row.issueDate, row => row.totalAmount, filters.grain), byProperty: null, statusDistribution: group(rows.filter(row => row.currency === 'KES'), row => row.status, row => row.totalAmount), categoryDistribution: group(active, row => row.category, row => row.totalAmount) }, filters, [], { propertyAttributionUnavailable: true, paidAmountIsDocumentStatusValue: true, reportingCurrency: 'KES', excludedNonKesRecords: rows.filter(row => row.currency !== 'KES').length });
  }

  async getEmployeeAnalytics(user, filters) {
    if (filters.propertyId || filters.landlordId) throw new AnalyticsAccessError('Employees and salary payments cannot be filtered by property because no reliable assignment exists');
    const owner = user.role === 'MANAGER' ? { createdById: user.id } : {};
    const [employees, payments] = await Promise.all([
      this.prisma.employee.findMany({ where: owner, select: { id: true, salaryAmount: true, status: true, jobTitle: true, paymentFrequency: true } }),
      this.prisma.salaryPayment.findMany({ where: { paymentDate: { gte: filters.start, lt: filters.endExclusive }, employee: owner }, select: { id: true, amount: true, status: true, paymentDate: true, paymentMethod: true } })
    ]);
    const salary = employees.reduce((sum, row) => sum + amount(row.salaryAmount), 0);
    return envelope({ scope: user.role === 'ADMIN' ? 'ORGANIZATION' : 'MANAGER', summary: { employeeCount: employees.length, activeEmployees: employees.filter(row => row.status === 'ACTIVE').length, configuredSalaryTotal: rounded(salary), averageConfiguredSalary: employees.length ? rounded(salary / employees.length) : null, salaryPaidInRange: rounded(payments.filter(row => row.status === 'PAID').reduce((sum, row) => sum + amount(row.amount), 0)) },
      trend: trend(payments, row => row.paymentDate, row => row.amount, filters.grain), byProperty: null, statusDistribution: group(employees, row => row.status, row => row.salaryAmount), categoryDistribution: group(employees, row => row.jobTitle, row => row.salaryAmount), paymentDistribution: group(payments, row => row.paymentMethod, row => row.amount) }, filters, [], { propertyAttributionUnavailable: true, configuredSalaryNotNormalized: true });
  }
}

export default new AnalyticsService();
