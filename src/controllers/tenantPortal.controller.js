import path from 'path';
import fs from 'fs';
import { createReadStream } from 'fs';
import prisma from '../lib/prisma.js';
import {
  calculateEscalatedRent,
  calculatePaymentByPolicy,
  calculateServiceCharge,
  calculateVAT,
  calculateTotalPayment,
  getPolicyMonths,
} from '../services/rentCalculation.js';
import { getPaymentSummary } from '../services/paymentScheduling.js';
import {
  isTenantFrozenNow,
} from '../services/tenantFreeze.js';

// ======================================================
// HELPERS
// ======================================================

// Same as staff tenant controller: compute tenure in days.
const daysBetween = (from, to) => {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

// Build lifecycle + freeze metadata from the tenant profile. This
// mirrors buildLifecycleMetadata in the staff tenant controller so
// the tenant portal shows exactly what staff see for the same tenant.
const buildLifecycleMetadata = (tenant) => {
  const leftTimestamp = tenant.leftAt || (tenant.status === 'LEFT' ? tenant.updatedAt : null);

  const periods = tenant.freezePeriods || [];
  const activePeriod = periods.find(
    (p) => !p.endDate || new Date(p.endDate) >= new Date()
  );
  const isFrozen = isTenantFrozenNow(tenant);

  return {
    status: tenant.status,
    isActive: tenant.status === 'ACTIVE',
    leftAt: leftTimestamp,
    leftReason: tenant.leftReason || null,
    tenureDays:
      tenant.status === 'LEFT'
        ? daysBetween(tenant.createdAt, leftTimestamp)
        : daysBetween(tenant.createdAt, new Date()),
    isFrozen,
    frozenAt: activePeriod?.startDate || null,
    freezeReason: activePeriod?.reason || null,
    freezeEndDate: activePeriod?.endDate || null,
    freezePeriodsCount: periods.length,
    frozenPeriods: periods.map((p) => ({
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate,
      reason: p.reason,
      durationDays: daysBetween(p.startDate, p.endDate || new Date()),
    })),
  };
};

// Resolve a file path from an Attachment row the same way the staff
// tenant controller does, including the `attachments/` fallback for
// older uploads that predate the current layout.
const resolveAttachmentPath = (attachment) => {
  let fileName = attachment.fileName || attachment.url || '';
  fileName = String(fileName).replace(/^\/+/, '').replace(/^uploads\//i, '');

  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  let fullPath = path.resolve(uploadDir, fileName);

  if (!fs.existsSync(fullPath) && !fileName.includes('attachments/')) {
    const fallbackPath = path.resolve(uploadDir, 'attachments', fileName);
    if (fs.existsSync(fallbackPath)) fullPath = fallbackPath;
  }

  return fullPath;
};

const getContentType = (extension) => {
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
  };
  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
};

// ======================================================
// PROFILE
// ======================================================

// @desc    Get own tenant profile (identity, unit, property, lifecycle)
// @route   GET /api/portal/tenant/profile
// @access  Private (TENANT)
export const getProfile = async (req, res) => {
  try {
    // requireTenantScope already loaded the tenant with unit + property
    // + freezePeriods. Reuse it instead of re-querying.
    const tenant = req.tenantProfile;

    // Safe subset of tenant fields the tenant is allowed to see.
    const tenantSafe = {
      id: tenant.id,
      fullName: tenant.fullName,
      email: tenant.email,
      contact: tenant.contact,
      KRAPin: tenant.KRAPin,
      POBox: tenant.POBox,
      leaseTerm: tenant.leaseTerm,
      rent: tenant.rent,
      deposit: tenant.deposit,
      termStart: tenant.termStart,
      rentStart: tenant.rentStart,
      paymentPolicy: tenant.paymentPolicy,
      escalationRate: tenant.escalationRate,
      escalationFrequency: tenant.escalationFrequency,
      vatRate: tenant.vatRate,
      vatType: tenant.vatType,
      withholdingTaxRate: tenant.withholdingTaxRate,
      withholdingVatRate: tenant.withholdingVatRate,
      isWithholdingTaxExempt: tenant.isWithholdingTaxExempt,
      status: tenant.status,
      leftAt: tenant.leftAt,
      leftReason: tenant.leftReason,
      isFrozen: tenant.isFrozen,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };

    // Safe subset of unit + property fields. NO bank details on property.
    const unitSafe = tenant.unit ? {
      id: tenant.unit.id,
      unitNo: tenant.unit.unitNo,
      type: tenant.unit.type,
      unitType: tenant.unit.unitType,
      floor: tenant.unit.floor,
      sizeSqFt: tenant.unit.sizeSqFt,
      bedrooms: tenant.unit.bedrooms,
      bathrooms: tenant.unit.bathrooms,
    } : null;

    const propertySafe = tenant.unit?.property ? {
      id: tenant.unit.property.id,
      name: tenant.unit.property.name,
      address: tenant.unit.property.address,
      form: tenant.unit.property.form,
      usage: tenant.unit.property.usage,
      lrNumber: tenant.unit.property.lrNumber,
      image: tenant.unit.property.image,
    } : null;

    res.json({
      success: true,
      data: {
        tenant: tenantSafe,
        unit: unitSafe,
        property: propertySafe,
        lifecycle: buildLifecycleMetadata(tenant),
      }
    });
  } catch (error) {
    console.error('Tenant portal getProfile error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// STATEMENT (reuses staff-side financial math)
// ======================================================

// @desc    Computed financial statement for the authenticated tenant
// @route   GET /api/portal/tenant/statement
// @access  Private (TENANT)
//
// The amounts below are IDENTICAL to what the staff tenant controller
// returns for the same tenant because both call the same pure functions
// in rentCalculation.js and paymentScheduling.js with the same inputs.
export const getStatement = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    // Re-load with the relations the calculators need. This is the same
    // set the staff controller's getTenant uses.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: {
              select: {
                id: true, name: true, address: true, form: true, usage: true, lrNumber: true,
                // Bank details intentionally NOT selected.
              }
            }
          }
        },
        paymentReports: { orderBy: { datePaid: 'desc' } },
        serviceCharge: true,
        invoices: { orderBy: { createdAt: 'desc' } },
        billInvoices: { orderBy: { createdAt: 'desc' } },
        bills: { orderBy: { createdAt: 'desc' } },
        freezePeriods: { orderBy: { startDate: 'desc' } },
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant profile not found' });
    }

    // Same math as staff getTenant.
    const rentInfo = calculateEscalatedRent(tenant);
    const monthlyRent = rentInfo.currentRent;

    const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
    const paymentSummary = getPaymentSummary(tenant);
    const paymentBreakdown = calculateTotalPayment(tenant, monthlyRent, tenant.paymentPolicy);

    const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
    const serviceChargeByPolicy =
      serviceChargeDetails.amount * getPolicyMonths(tenant.paymentPolicy);

    const vatOnRent = calculateVAT(paymentAmount, tenant.vatType, tenant.vatRate);
    const vatOnServiceCharge =
      serviceChargeDetails.vatAmount * getPolicyMonths(tenant.paymentPolicy);

    const totalPayment =
      paymentAmount + vatOnRent + serviceChargeByPolicy + vatOnServiceCharge;

    const lifecycle = buildLifecycleMetadata(tenant);

    res.json({
      success: true,
      data: {
        rentInfo: {
          ...rentInfo,
          monthlyRent,
          paymentAmount,
          serviceCharge: {
            monthly: serviceChargeDetails.amount,
            byPolicy: serviceChargeByPolicy,
            vatType: serviceChargeDetails.vatType,
            vatRate: serviceChargeDetails.vatRate,
            vatAmount: vatOnServiceCharge,
            totalByPolicy: serviceChargeByPolicy + vatOnServiceCharge,
          },
          vatOnRent,
          totalPayment,
          paymentPolicy: tenant.paymentPolicy,
          paymentBreakdown,
        },
        paymentSummary,
        lifecycle,
        freezeWarning: lifecycle.isFrozen
          ? `Rent accrual is paused${
              lifecycle.frozenAt
                ? ` since ${new Date(lifecycle.frozenAt).toISOString().split('T')[0]}`
                : ''
            }${
              lifecycle.freezeEndDate
                ? ` until ${new Date(lifecycle.freezeEndDate).toISOString().split('T')[0]}`
                : ''
            }.`
          : null,
      }
    });
  } catch (error) {
    console.error('Tenant portal getStatement error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// PAYMENTS
// ======================================================

// @desc    List own payment reports
// @route   GET /api/portal/tenant/payments
// @access  Private (TENANT)
export const getPayments = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    const payments = await prisma.paymentReport.findMany({
      where: { tenantId },
      select: {
        id: true,
        datePaid: true,
        paymentPeriod: true,
        amountPaid: true,
        totalDue: true,
        arrears: true,
        rent: true,
        serviceCharge: true,
        vat: true,
        status: true,
        notes: true,
        receiptUrl: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { datePaid: 'desc' },
    });

    res.json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error('Tenant portal getPayments error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// INVOICES
// ======================================================

// @desc    List own invoices
// @route   GET /api/portal/tenant/invoices
// @access  Private (TENANT)
export const getInvoices = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        paymentPeriod: true,
        rent: true,
        serviceCharge: true,
        vat: true,
        totalDue: true,
        amountPaid: true,
        balance: true,
        status: true,
        pdfUrl: true,
        notes: true,
        paymentPolicy: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: invoices.length,
      data: invoices,
    });
  } catch (error) {
    console.error('Tenant portal getInvoices error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// BILLS (utility) + BILL INVOICES
// ======================================================

// @desc    List own bills and bill invoices
// @route   GET /api/portal/tenant/bills
// @access  Private (TENANT)
export const getBills = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    const [bills, billInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: { tenantId },
        select: {
          id: true,
          type: true,
          description: true,
          previousReading: true,
          currentReading: true,
          units: true,
          chargePerUnit: true,
          totalAmount: true,
          vatRate: true,
          vatAmount: true,
          grandTotal: true,
          amountPaid: true,
          status: true,
          issuedAt: true,
          dueDate: true,
          paidAt: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.billInvoice.findMany({
        where: { tenantId },
        select: {
          id: true,
          invoiceNumber: true,
          billReferenceNumber: true,
          billReferenceDate: true,
          issueDate: true,
          dueDate: true,
          billType: true,
          previousReading: true,
          currentReading: true,
          units: true,
          chargePerUnit: true,
          totalAmount: true,
          vatRate: true,
          vatAmount: true,
          grandTotal: true,
          amountPaid: true,
          balance: true,
          status: true,
          pdfUrl: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { issueDate: 'desc' },
      }),
    ]);

    res.json({
      success: true,
      bills: { count: bills.length, data: bills },
      billInvoices: { count: billInvoices.length, data: billInvoices },
    });
  } catch (error) {
    console.error('Tenant portal getBills error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// DEMAND LETTERS
// ======================================================

// @desc    List own demand letters
// @route   GET /api/portal/tenant/demand-letters
// @access  Private (TENANT)
export const getDemandLetters = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    const letters = await prisma.demandLetter.findMany({
      where: { tenantId },
      select: {
        id: true,
        letterNumber: true,
        issueDate: true,
        dueDate: true,
        rentalPeriod: true,
        outstandingAmount: true,
        partialPayment: true,
        partialPaymentDate: true,
        demandPeriod: true,
        referenceNumber: true,
        previousInvoiceRef: true,
        status: true,
        documentUrl: true,
        notes: true,
        property: { select: { id: true, name: true, address: true } },
        unit: { select: { id: true, unitNo: true } },
      },
      orderBy: { issueDate: 'desc' },
    });

    res.json({
      success: true,
      count: letters.length,
      data: letters,
    });
  } catch (error) {
    console.error('Tenant portal getDemandLetters error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS
// ======================================================

// @desc    List own attachments
// @route   GET /api/portal/tenant/attachments
// @access  Private (TENANT)
export const getAttachments = async (req, res) => {
  try {
    const tenantId = req.tenantProfileId;

    const attachments = await prisma.attachment.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        fileName: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        updatedAt: true,
        // Do not leak the raw storage URL; the preview/download
        // endpoints are the only supported access paths.
      },
      orderBy: { uploadedAt: 'desc' },
    });

    const withLinks = attachments.map((a) => ({
      ...a,
      previewUrl: `/api/portal/tenant/attachments/${a.id}/preview`,
      downloadUrl: `/api/portal/tenant/attachments/${a.id}/download`,
    }));

    res.json({
      success: true,
      count: withLinks.length,
      data: withLinks,
    });
  } catch (error) {
    console.error('Tenant portal getAttachments error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Preview own attachment inline
// @route   GET /api/portal/tenant/attachments/:attachmentId/preview
// @access  Private (TENANT)
export const previewAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const tenantId = req.tenantProfileId;

    // Anti-IDOR: fetch by id AND tenantId in the same query. If the
    // attachment belongs to a different tenant, this returns null and
    // we respond 404 (not 403).
    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, tenantId },
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const fullPath = resolveAttachmentPath(attachment);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = getContentType(ext);
    const fileName = path.basename(fullPath);

    res.setHeader('Content-Type', attachment.mimeType || contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');

    const stream = createReadStream(fullPath);
    stream.pipe(res);
  } catch (error) {
    console.error('Tenant portal previewAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Download own attachment
// @route   GET /api/portal/tenant/attachments/:attachmentId/download
// @access  Private (TENANT)
export const downloadAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const tenantId = req.tenantProfileId;

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, tenantId },
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const fullPath = resolveAttachmentPath(attachment);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.download(fullPath, attachment.name || path.basename(fullPath));
  } catch (error) {
    console.error('Tenant portal downloadAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};