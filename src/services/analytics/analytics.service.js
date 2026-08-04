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
}

export default new AnalyticsService();
