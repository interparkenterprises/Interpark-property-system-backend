import prisma from '../lib/prisma.js';
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import { getPolicyMonths } from './rentCalculation.js';
import { isTenantFrozenOn } from './tenantFreeze.js';
import {
  APP_TIMEZONE, toDateKey, todayKeyInAppTimezone, hasPeriodStarted,
  resolvePeriodWindow, buildPeriodLabel, periodLabelCandidates, dateKeyToUtcNoon
} from './billingPeriodUtils.js';

const PREPAID = 'PREPAID';
const PAID = 'PAID';
const DEFAULT_BATCH_LIMIT = 200;

export class PrepaidTransitionDeferred extends Error {
  constructor(reason, details = {}) {
    super(`PREPAID transition deferred: ${reason}`);
    this.name = 'PrepaidTransitionDeferred';
    this.reason = reason;
    this.details = details;
  }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export function resolvePrepaidPolicy(notes, tenantPaymentPolicy) {
  const noteText = typeof notes === 'string' ? notes : '';
  const match = noteText.match(/Prepaid\s+([A-Z_]+)\s+period:/);
  if (match) {
    const candidate = match[1];
    if (candidate === 'MONTHLY' || candidate === 'QUARTERLY' || candidate === 'ANNUAL') {
      return { policy: candidate, source: 'NOTES' };
    }
  }
  const fallback = tenantPaymentPolicy === 'QUARTERLY' || tenantPaymentPolicy === 'ANNUAL'
    ? tenantPaymentPolicy : 'MONTHLY';
  return { policy: fallback, source: 'TENANT' };
}

export function resolveRecordedPeriodLabel(notes) {
  const noteText = typeof notes === 'string' ? notes : '';
  const match = noteText.match(/Prepaid\s+[A-Z_]+\s+period:\s*(.+?)\.\s*Original payment/i);
  return match ? match[1].trim() : null;
}

async function findExistingInvoiceForPeriod(tx, { tenantId, paymentReportId, periodLabels }) {
  const select = { id: true, invoiceNumber: true, status: true,
                   totalDue: true, amountPaid: true, balance: true, paymentPeriod: true };

  const linked = await tx.invoice.findFirst({
    where: { tenantId, paymentReportId, status: { not: 'CANCELLED' } }, select
  });
  if (linked) return { invoice: linked, matchedBy: 'PAYMENT_REPORT_LINK' };

  const byLabel = await tx.invoice.findFirst({
    where: { tenantId, paymentPeriod: { in: periodLabels }, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' }, select
  });
  if (byLabel) return { invoice: byLabel, matchedBy: 'PERIOD_LABEL' };

  return { invoice: null, matchedBy: null };
}

function buildInvoiceData({ report, tenantId, periodLabel, paymentPolicy, dueDate }) {
  let totalDue = round2(report.totalDue);
  let derivedTotalDue = false;
  if (totalDue <= 0) {
    const fallback = round2(num(report.rent) + num(report.serviceCharge) + num(report.vat));
    if (fallback > 0) { totalDue = fallback; derivedTotalDue = true; }
  }

  return {
    data: {
      invoiceNumber: null,
      tenantId,
      paymentReportId: report.id,
      issueDate: new Date(),
      dueDate,
      paymentPeriod: periodLabel,
      rent: round2(report.rent),
      serviceCharge: round2(report.serviceCharge),
      vat: round2(report.vat),
      totalDue,
      amountPaid: totalDue,
      balance: 0,
      status: 'PAID',
      paymentPolicy,
      notes:
        `Auto-generated ${paymentPolicy} rent invoice for prepaid period ${periodLabel}. ` +
        `Settled in advance by prepaid payment report ${report.id}; ` +
        `this invoice reflects the period becoming active and requires no further payment. ` +
        `No payment transaction or allocation was created by this process.`
    },
    totalDue,
    derivedTotalDue
  };
}

export async function transitionPrepaidReport(paymentReportId, options = {}) {
  const { generatePdf = false, generateReceipt = true } = options;

  const outcome = await prisma.$transaction(async (tx) => {
    // 1. Atomic claim — only one runner can win
    const claim = await tx.paymentReport.updateMany({
      where: { id: paymentReportId, status: PREPAID },
      data: { status: PAID }
    });
    if (claim.count !== 1) return { action: 'ALREADY_TRANSITIONED', paymentReportId };

    // 2. Fresh read inside the transaction
    const report = await tx.paymentReport.findUnique({
      where: { id: paymentReportId },
      select: { id: true, tenantId: true, paymentPeriod: true, rent: true,
                serviceCharge: true, vat: true, totalDue: true, amountPaid: true,
                notes: true, status: true }
    });
    if (!report) throw new PrepaidTransitionDeferred('REPORT_VANISHED', { paymentReportId });

    // CRITICAL FIX: Update amountPaid to totalDue so the receipt generator 
    // sees this as a fully paid report (PREPAID reports are originally created with amountPaid: 0)
    await tx.paymentReport.update({
      where: { id: paymentReportId },
      data: {
        amountPaid: report.totalDue,
        arrears: 0
      }
    });

    const tenant = await tx.tenant.findUnique({
      where: { id: report.tenantId },
      select: { id: true, fullName: true, paymentPolicy: true, status: true, isFrozen: true,
                freezePeriods: { select: { id: true, startDate: true, endDate: true, reason: true } } }
    });
    if (!tenant) throw new PrepaidTransitionDeferred('TENANT_NOT_FOUND',
      { paymentReportId, tenantId: report.tenantId });

    // 3. Period window from the recorded period start
    const { policy, source: policySource } = resolvePrepaidPolicy(report.notes, tenant.paymentPolicy);
    const policyMonths = getPolicyMonths(policy);
    const window = resolvePeriodWindow(report.paymentPeriod, policyMonths);
    const recordedLabel = resolveRecordedPeriodLabel(report.notes);
    const periodLabel = recordedLabel || buildPeriodLabel(window.startKey, window.endKeyInclusive, policy);
    const periodLabels = periodLabelCandidates(window.startKey, window.endKeyInclusive, policy, recordedLabel);

    // 4. Freeze guard
    if (isTenantFrozenOn(tenant, new Date(report.paymentPeriod))) {
      throw new PrepaidTransitionDeferred('TENANT_FROZEN',
        { paymentReportId, tenantId: tenant.id, periodLabel, periodStartKey: window.startKey });
    }

    // 5. Invoice already covering this period?
    const { invoice: existing, matchedBy } = await findExistingInvoiceForPeriod(tx, {
      tenantId: tenant.id, paymentReportId: report.id, periodLabels
    });

    if (existing) {
      const settled = existing.status === 'PAID' || num(existing.balance) <= 0.01;
      if (!settled) {
        throw new PrepaidTransitionDeferred('EXISTING_INVOICE_NOT_SETTLED', {
          paymentReportId, tenantId: tenant.id, periodLabel, matchedBy,
          invoiceId: existing.id, invoiceNumber: existing.invoiceNumber,
          invoiceStatus: existing.status, invoiceBalance: num(existing.balance)
        });
      }
      return { action: 'TRANSITIONED_INVOICE_ALREADY_EXISTS', paymentReportId,
               tenantId: tenant.id, tenantName: tenant.fullName, periodLabel, policy,
               matchedBy, invoiceId: existing.id, invoiceNumber: existing.invoiceNumber };
    }

    // 6. Create the PAID invoice from the prepaid snapshot
    const built = buildInvoiceData({
      report, tenantId: tenant.id, periodLabel, paymentPolicy: policy,
      dueDate: dateKeyToUtcNoon(window.endKeyInclusive)
    });
    const invoiceNumber = await generateInvoiceNumber();

    const created = await tx.invoice.create({
      data: { ...built.data, invoiceNumber },
      select: { id: true, invoiceNumber: true, totalDue: true, status: true,
                paymentPeriod: true, dueDate: true }
    });

    return { action: 'TRANSITIONED_INVOICE_CREATED', paymentReportId, tenantId: tenant.id,
             tenantName: tenant.fullName, periodLabel, policy, policySource,
             periodStartKey: window.startKey, periodEndKey: window.endKeyInclusive,
             invoiceId: created.id, invoiceNumber: created.invoiceNumber,
             totalDue: built.totalDue, derivedTotalDue: built.derivedTotalDue,
             reportAmountPaid: round2(report.amountPaid) };
  }, {
    timeout: 15000,
    maxWait: 5000,
  });

  // 7. PDF after commit
  if (generatePdf && outcome.action === 'TRANSITIONED_INVOICE_CREATED') {
    try {
      const { attachInvoicePdf } = await import('./prepaidInvoicePdf.js');
      const pdfUrl = await attachInvoicePdf(outcome.invoiceId);
      if (pdfUrl) outcome.pdfUrl = pdfUrl;
    } catch (pdfError) {
      outcome.pdfError = pdfError.message;
    }
  }

  //  8. Receipt generation after commit
  if (generateReceipt && outcome.action === 'TRANSITIONED_INVOICE_CREATED') {
    try {
      const { generateAndUploadReceipt } = await import('../controllers/paymentReport.controller.js');
      
      // Fetch full relational data required by the receipt template
      const reportWithDetails = await prisma.paymentReport.findUnique({
        where: { id: outcome.paymentReportId },
        include: {
          tenant: {
            include: {
              unit: { include: { property: true } },
              serviceCharge: true
            }
          },
          invoices: true
        }
      });

      if (reportWithDetails) {
        const receiptResult = await generateAndUploadReceipt(
          reportWithDetails,
          reportWithDetails.tenant,
          reportWithDetails.invoices,
          0, // overpaymentAmount (already handled in original transaction)
          0  // creditUsed (already handled in original transaction)
        );

        if (receiptResult && receiptResult.receiptUrl) {
          await prisma.paymentReport.update({
            where: { id: outcome.paymentReportId },
            data: { receiptUrl: receiptResult.receiptUrl }
          });
          outcome.receiptUrl = receiptResult.receiptUrl;
          outcome.receiptNumber = receiptResult.receiptNumber;
        }
      }
    } catch (receiptError) {
      outcome.receiptError = receiptError.message;
      console.error(`[prepaid-transition] Failed to generate receipt for report ${outcome.paymentReportId}:`, receiptError.message);
    }
  }

  return outcome;
}

export async function runPrepaidToPaidTransition(options = {}) {
  const { now = new Date(), limit = DEFAULT_BATCH_LIMIT, tenantId = null,
          dryRun = false, generatePdf = false, generateReceipt = true } = options;

  const startedAt = new Date();
  const todayKey = todayKeyInAppTimezone(now);

  const summary = {
    startedAt, finishedAt: null, durationMs: 0,
    timezone: APP_TIMEZONE, referenceDateKey: todayKey, dryRun,
    identified: 0, due: 0, notDue: 0,
    transitioned: 0, invoicesCreated: 0, skippedExistingInvoice: 0,
    deferred: 0, errors: 0, deferredReasons: {},
    errorDetails: [], transitions: [], pdfErrors: 0, receiptErrors: 0
  };

  const candidates = await prisma.paymentReport.findMany({
    where: { status: PREPAID, ...(tenantId ? { tenantId } : {}) },
    orderBy: { paymentPeriod: 'asc' },
    take: limit,
    select: { id: true, tenantId: true, paymentPeriod: true, totalDue: true, notes: true }
  });

  summary.identified = candidates.length;

  for (const candidate of candidates) {
    const startKey = toDateKey(candidate.paymentPeriod);

    if (!startKey || !hasPeriodStarted(startKey, todayKey)) { summary.notDue += 1; continue; }
    summary.due += 1;

    if (dryRun) {
      summary.transitions.push({ paymentReportId: candidate.id, tenantId: candidate.tenantId,
        periodStartKey: startKey, action: 'WOULD_TRANSITION',
        totalDue: round2(candidate.totalDue) });
      continue;
    }

    try {
      const outcome = await transitionPrepaidReport(candidate.id, { generatePdf, generateReceipt });
      summary.transitions.push(outcome);

      switch (outcome.action) {
        case 'TRANSITIONED_INVOICE_CREATED':
          summary.transitioned += 1; summary.invoicesCreated += 1; break;
        case 'TRANSITIONED_INVOICE_ALREADY_EXISTS':
          summary.transitioned += 1; summary.skippedExistingInvoice += 1; break;
        case 'ALREADY_TRANSITIONED':
          break;
        default: break;
      }
      if (outcome.pdfError) summary.pdfErrors += 1;
      if (outcome.receiptError) summary.receiptErrors += 1;
    } catch (error) {
      if (error instanceof PrepaidTransitionDeferred) {
        summary.deferred += 1;
        summary.deferredReasons[error.reason] = (summary.deferredReasons[error.reason] || 0) + 1;
        summary.transitions.push({ paymentReportId: candidate.id, tenantId: candidate.tenantId,
          periodStartKey: startKey, action: 'DEFERRED', reason: error.reason, details: error.details });
        console.warn(`[prepaid-transition] deferred report=${candidate.id} tenant=${candidate.tenantId} reason=${error.reason}`, error.details);
      } else {
        summary.errors += 1;
        summary.errorDetails.push({ paymentReportId: candidate.id, tenantId: candidate.tenantId,
          periodStartKey: startKey, message: error?.message || String(error) });
        console.error(`[prepaid-transition] error report=${candidate.id} tenant=${candidate.tenantId}`, error);
      }
    }
  }

  summary.finishedAt = new Date();
  summary.durationMs = summary.finishedAt - startedAt;

  console.log('[prepaid-transition] run complete ' + JSON.stringify({
    timezone: summary.timezone, referenceDateKey: summary.referenceDateKey,
    dryRun: summary.dryRun, identified: summary.identified, due: summary.due,
    notDue: summary.notDue, transitioned: summary.transitioned,
    invoicesGenerated: summary.invoicesCreated, skippedExistingInvoice: summary.skippedExistingInvoice,
    deferred: summary.deferred, errors: summary.errors, durationMs: summary.durationMs
  }));

  return summary;
}

export default { runPrepaidToPaidTransition, transitionPrepaidReport,
  resolvePrepaidPolicy, resolveRecordedPeriodLabel, PrepaidTransitionDeferred };