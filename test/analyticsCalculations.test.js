import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCollectionsTrend,
  calculateOccupancy,
  calculateReceivables,
  calculateReceivablesTrend,
  calculateRevenueByProperty,
  calculateStatusDistribution,
  collectionRate,
  periodKey
} from '../src/services/analytics/analyticsCalculations.js';

const asOfExclusive = new Date('2026-08-05T21:00:00.000Z');

test('partial invoices use full due, actual paid, and remaining balance', () => {
  const partial = {
    status: 'PARTIAL', totalDue: 1000, amountPaid: 400, balance: 600,
    dueDate: new Date('2026-07-31T21:00:00.000Z')
  };
  const summary = calculateReceivables([partial], [partial], asOfExclusive);
  assert.deepEqual(summary, {
    billed: 1000,
    paid: 400,
    outstanding: 600,
    arrears: 600,
    collectionRate: 40,
    invoiceCount: 1,
    openInvoiceCount: 1
  });

  assert.deepEqual(calculateStatusDistribution([partial]).partial, {
    count: 1, paidAmount: 400, unpaidAmount: 600, totalDue: 1000
  });
});

test('zero denominator returns null and empty datasets remain valid', () => {
  assert.equal(collectionRate(0, 0), null);
  assert.deepEqual(calculateReceivables([], [], asOfExclusive), {
    billed: 0, paid: 0, outstanding: 0, arrears: 0,
    collectionRate: null, invoiceCount: 0, openInvoiceCount: 0
  });
  assert.deepEqual(calculateOccupancy([]), {
    totalUnits: 0, occupiedUnits: 0, vacantUnits: 0, occupancyRate: null
  });
});

test('outstanding includes future-due balances while arrears includes only past-due balances', () => {
  const overdue = { status: 'OVERDUE', balance: 300, dueDate: new Date('2026-08-01T00:00:00Z') };
  const future = { status: 'UNPAID', balance: 500, dueDate: new Date('2026-08-10T00:00:00Z') };
  const paid = { status: 'PAID', balance: 100, dueDate: new Date('2026-08-01T00:00:00Z') };
  const result = calculateReceivables([], [overdue, future, paid], asOfExclusive);
  assert.equal(result.outstanding, 800);
  assert.equal(result.arrears, 300);
});

test('credit and prepaid payment reports are excluded from collection trends', () => {
  const result = calculateCollectionsTrend([
    { status: 'PAID', amountPaid: 100, datePaid: '2026-08-01T08:00:00Z' },
    { status: 'PARTIAL', amountPaid: 50, datePaid: '2026-08-01T09:00:00Z' },
    { status: 'CREDIT', amountPaid: 75, datePaid: '2026-08-01T10:00:00Z' },
    { status: 'PREPAID', amountPaid: 80, datePaid: '2026-08-01T11:00:00Z' }
  ], 'day');
  assert.deepEqual(result.series, [{ period: '2026-08-01', collected: 150, transactionCount: 2 }]);
  assert.deepEqual(result.dataQuality, { excludedCreditCount: 1, excludedPrepaidCount: 1 });
});

test('Africa/Nairobi period keys respect the local date boundary', () => {
  assert.equal(periodKey('2026-07-31T21:30:00.000Z', 'day'), '2026-08-01');
  assert.equal(periodKey('2026-08-31T21:30:00.000Z', 'month'), '2026-09');
});

test('receivables trend and revenue use invoice values once', () => {
  const invoices = [
    {
      dueDate: '2026-08-01T00:00:00Z', totalDue: 1000, amountPaid: 400, balance: 600,
      tenant: { unit: { property: { id: 'p1', name: 'Property One' } } }
    },
    {
      dueDate: '2026-08-02T00:00:00Z', totalDue: 500, amountPaid: 500, balance: 0,
      tenant: { unit: { property: { id: 'p1', name: 'Property One' } } }
    }
  ];
  const trend = calculateReceivablesTrend(invoices, 'month');
  assert.equal(trend[0].billed, 1500);
  assert.equal(trend[0].paid, 900);
  assert.equal(trend[0].collectionRate, 60);
  const revenue = calculateRevenueByProperty(invoices);
  assert.equal(revenue[0].paid, 900);
  assert.equal(revenue[0].invoiceCount, 2);
});

test('current occupancy counts only OCCUPIED and VACANT snapshot states', () => {
  assert.deepEqual(calculateOccupancy([
    { status: 'OCCUPIED' }, { status: 'OCCUPIED' }, { status: 'VACANT' }
  ]), { totalUnits: 3, occupiedUnits: 2, vacantUnits: 1, occupancyRate: 66.67 });
});
