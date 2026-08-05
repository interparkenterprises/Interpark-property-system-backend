import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsAccessError, AnalyticsService } from '../src/services/analytics/analytics.service.js';
import { AnalyticsFilterError, normalizeAnalyticsFilters } from '../src/services/analytics/analyticsFilter.service.js';

const PROPERTY_ONE = '11111111-1111-4111-8111-111111111111';
const PROPERTY_TWO = '22222222-2222-4222-8222-222222222222';
const LANDLORD = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'user-1', role: 'USER' };
const NOW = new Date('2026-08-04T12:00:00.000Z');

const filters = overrides => normalizeAnalyticsFilters({
  dateFrom: '2026-08-01',
  dateTo: '2026-08-04',
  asOf: '2026-08-04',
  grain: 'day',
  ...overrides
}, NOW);

const createMock = ({ invoices = [], openInvoices = [], reports = [], units = [], tenantCount = 0 } = {}) => {
  const calls = { invoice: [], paymentReport: [], income: 0, unit: [], tenant: [] };
  const database = {
    property: { findMany: async () => [] },
    invoice: {
      findMany: async args => {
        calls.invoice.push(args);
        return args.where.status?.in ? openInvoices : invoices;
      }
    },
    paymentReport: {
      findMany: async args => { calls.paymentReport.push(args); return reports; }
    },
    income: {
      findMany: async () => { calls.income += 1; return []; }
    },
    unit: {
      findMany: async args => { calls.unit.push(args); return units; }
    },
    tenant: {
      count: async args => { calls.tenant.push(args); return tenantCount; }
    }
  };
  const permissions = { getAccessiblePropertyIds: async () => [PROPERTY_ONE] };
  return { service: new AnalyticsService(database, permissions), calls, database };
};

test('filter validation rejects invalid IDs, grains, dates, and incomplete ranges', () => {
  assert.throws(() => filters({ propertyId: 'not-a-uuid' }), AnalyticsFilterError);
  assert.throws(() => filters({ grain: 'year' }), AnalyticsFilterError);
  assert.throws(() => filters({ dateFrom: '2026-02-30', dateTo: '2026-03-01' }), AnalyticsFilterError);
  assert.throws(() => normalizeAnalyticsFilters({ dateFrom: '2026-08-01' }, NOW), AnalyticsFilterError);
  assert.throws(() => filters({ dateFrom: '2026-08-05', dateTo: '2026-08-04' }), AnalyticsFilterError);
});

test('date filters use Nairobi start and exclusive next-day boundaries', () => {
  const value = filters();
  assert.equal(value.start.toISOString(), '2026-07-31T21:00:00.000Z');
  assert.equal(value.endExclusive.toISOString(), '2026-08-04T21:00:00.000Z');
  assert.equal(value.asOfExclusive.toISOString(), '2026-08-04T21:00:00.000Z');
});

test('property isolation rejects an inaccessible requested property', async () => {
  const { service } = createMock();
  await assert.rejects(
    service.getReceivablesSummary(USER, filters({ propertyId: PROPERTY_TWO })),
    AnalyticsAccessError
  );
});

test('property and landlord scope are applied before analytics queries', async () => {
  const { service, calls, database } = createMock();
  database.property.findMany = async args => {
    assert.deepEqual(args.where.id.in, [PROPERTY_ONE]);
    assert.equal(args.where.landlordId, LANDLORD);
    return [{ id: PROPERTY_ONE }];
  };
  await service.getReceivablesSummary(USER, filters({ landlordId: LANDLORD }));
  assert.deepEqual(calls.invoice[0].where.tenant.unit.propertyId.in, [PROPERTY_ONE]);
  assert.deepEqual(calls.invoice[1].where.tenant.unit.propertyId.in, [PROPERTY_ONE]);
});

test('cancelled invoices are excluded by every invoice query', async () => {
  const { service, calls } = createMock();
  await service.getStatusDistribution(USER, filters());
  assert.deepEqual(calls.invoice[0].where.status, { not: 'CANCELLED' });
});

test('overview response has stable structure and never queries payment reports or income', async () => {
  const invoice = {
    status: 'PARTIAL', totalDue: 1000, amountPaid: 400, balance: 600,
    dueDate: new Date('2026-08-01T00:00:00Z')
  };
  const { service, calls } = createMock({
    invoices: [invoice], openInvoices: [invoice],
    units: [{ status: 'OCCUPIED', tenant: { id: 'tenant-1' } }], tenantCount: 1
  });
  const response = await service.getOverview(USER, filters());
  assert.equal(response.success, true);
  assert.equal(response.data.receivables.billed, 1000);
  assert.equal(response.data.receivables.paid, 400);
  assert.equal(response.data.occupancy.occupancyRate, 100);
  assert.equal(response.data.tenants.currentTenants, 1);
  assert.equal(response.meta.timezone, 'Africa/Nairobi');
  assert.equal(response.meta.definitionsVersion, '1.0');
  assert.equal(calls.paymentReport.length, 0);
  assert.equal(calls.income, 0);
});

test('collections trend alone uses PaymentReport and excludes credit/prepaid values', async () => {
  const { service, calls } = createMock({ reports: [
    { status: 'PAID', amountPaid: 100, datePaid: new Date('2026-08-01T00:00:00Z') },
    { status: 'CREDIT', amountPaid: 40, datePaid: new Date('2026-08-01T00:00:00Z') },
    { status: 'PREPAID', amountPaid: 30, datePaid: new Date('2026-08-01T00:00:00Z') }
  ] });
  const response = await service.getCollectionsTrend(USER, filters());
  assert.equal(response.data.series[0].collected, 100);
  assert.equal(response.meta.dataQuality.excludedCreditCount, 1);
  assert.equal(response.meta.dataQuality.excludedPrepaidCount, 1);
  assert.equal(calls.invoice.length, 0);
  assert.equal(calls.paymentReport.length, 1);
  assert.equal(calls.income, 0);
});

test('empty service datasets return zeros and null rates, not errors', async () => {
  const { service } = createMock();
  const response = await service.getReceivablesSummary(USER, filters());
  assert.deepEqual(response.data, {
    billed: 0, paid: 0, outstanding: 0, arrears: 0,
    collectionRate: null, invoiceCount: 0, openInvoiceCount: 0
  });
});
