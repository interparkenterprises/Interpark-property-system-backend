import prisma from '../lib/prisma.js';
import { uploadToStorage } from '../utils/storage.js';
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import sizeOf from 'image-size';
import {
  addBillingPeriod,
  calculateChargeByPolicy,
  calculateEscalatedRent,
  calculateTotalPaymentWithWithholding,
  getPolicyMonths
} from '../services/rentCalculation.js';
import permissionService from "../services/permissionService.js";
import { buildInvoiceHtml, buildInvoiceFooterTemplate } from '../services/pdf/invoicePdf.js';
import { generatePDF } from '../utils/pdfGenerator.js';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// PERMISSION HELPER FUNCTIONS
// ======================================================

// Helper to check if user can access an invoice based on property
async function canAccessInvoice(userId, userRole, invoiceId) {
  // ADMIN can access everything
  if (userRole === 'ADMIN') return true;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      tenant: {
        include: {
          unit: {
            include: {
              property: true
            }
          }
        }
      }
    }
  });

  if (!invoice) return false;

  const propertyId = invoice.tenant?.unit?.propertyId;

  if (!propertyId) return false;

  // MANAGER can access properties they own
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }

  // USER role needs explicit permission
  return permissionService.checkPropertyAccess(userId, propertyId, 'canView');
}

// Helper to check if user can manage invoices for a property
async function canManageInvoiceForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;

  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }

  return permissionService.checkPermission(userId, 'invoice', 'create', propertyId);
}

// Helper to check if user can view invoices for a property
async function canViewInvoicesForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;

  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }

  return permissionService.checkPermission(userId, 'invoice', 'view', propertyId);
}

// Helper function to convert enum to title case
function toTitleCase(enumValue) {
  if (!enumValue) return '';
  return enumValue.charAt(0).toUpperCase() + enumValue.slice(1).toLowerCase();
}

const VALID_PAYMENT_POLICIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

function normalizePaymentPolicy(paymentPolicy = 'MONTHLY') {
  const normalized = String(paymentPolicy || 'MONTHLY').toUpperCase();
  return VALID_PAYMENT_POLICIES.includes(normalized) ? normalized : 'MONTHLY';
}

function roundMoney(value) {
  return parseFloat(Number(value || 0).toFixed(2));
}

function toValidDate(dateLike, fallback = new Date()) {
  const date = new Date(dateLike);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

/**
 * Build a payment-period label using UTC arithmetic so that the label
 * is identical regardless of the server's timezone.
 */
function buildPaymentPeriodLabel(startDate, paymentPolicy = 'MONTHLY') {
  const policy = normalizePaymentPolicy(paymentPolicy);
  const start = toValidDate(startDate);

  // Snap to UTC 1st of month
  const startUtc = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    1
  ));

  // Compute end-of-period via UTC arithmetic
  const endExclusive = addBillingPeriod(startUtc, policy);
  const end = new Date(endExclusive);
  end.setUTCDate(end.getUTCDate() - 1);

  const shortDate = (date) =>
    date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });

  switch (policy) {
    case 'QUARTERLY':
    case 'ANNUAL':
      return `${shortDate(startUtc)} - ${shortDate(end)}`;

    case 'MONTHLY':
    default:
      return startUtc.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      });
  }
}

/**
 * Aligns a billing date to the tenant's policy cycle.
 * E.g. for a QUARTERLY tenant with rentStart = Jul 1, feeding any date
 * between Jul 1 and Sep 30 returns Jul 1; between Oct 1 and Dec 31 → Oct 1.
 * Operates entirely in UTC to avoid timezone drift.
 */
function alignBillingDateToCycle(billingDate, tenant) {
  const policy = normalizePaymentPolicy(tenant.paymentPolicy);
  const policyMonths = policy === 'QUARTERLY' ? 3 : policy === 'ANNUAL' ? 12 : 1;

  const anchor = toValidDate(tenant.rentStart, new Date());
  const anchorMonthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));

  const probe = toValidDate(billingDate, new Date());
  const probeMonthStart = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), 1));

  // How many whole policy-blocks have elapsed between anchor and probe?
  const monthsDiff =
    (probeMonthStart.getUTCFullYear() - anchorMonthStart.getUTCFullYear()) * 12 +
    (probeMonthStart.getUTCMonth() - anchorMonthStart.getUTCMonth());

  const blocks = Math.floor(monthsDiff / policyMonths);
  const aligned = new Date(Date.UTC(
    anchorMonthStart.getUTCFullYear(),
    anchorMonthStart.getUTCMonth() + blocks * policyMonths,
    1
  ));

  return aligned;
}

/**
 * Compute invoice line items and totals for a tenant, using the same
 * calculation pipeline the payment-report flow uses. This guarantees:
 *
 *   - Rent VAT is applied with the TENANT's vatType/vatRate.
 *   - Service charge VAT is applied with the SERVICE CHARGE's own
 *     vatType/vatRate (independent of the tenant's).
 *   - Withholding tax (if configured on the tenant) is deducted so
 *     invoice.totalDue matches what payment reports record.
 *
 * Returns the breakdown the PDF builder needs:
 *   { paymentPolicy, monthlyRent, monthlyServiceCharge,
 *     rent, serviceCharge, vat, subtotal, totalDue,
 *     totalDueWithoutWithholding, totalWithheld }
 */
function calculateInvoiceAmountsFromTenant(tenant, billingDate = new Date()) {
  const paymentPolicy = normalizePaymentPolicy(tenant.paymentPolicy);

  // Escalated monthly rent (base, before policy multiplication)
  const { currentRent } = calculateEscalatedRent(tenant, billingDate);
  const monthlyRent = roundMoney(currentRent || tenant.rent || 0);

  // Use the canonical payment pipeline. This handles:
  //   - rent × policy months
  //   - service charge × policy months (with its own VAT)
  //   - VAT on rent per the tenant's vatType/vatRate
  //   - withholding tax deductions
  const breakdown = calculateTotalPaymentWithWithholding(
    tenant,
    monthlyRent,
    paymentPolicy
  );

  // Rent component
  const rent = roundMoney(breakdown.rent?.paymentByPolicy || 0);

  // Service charge component (inclusive of its own VAT)
  const serviceCharge = roundMoney(
    breakdown.serviceCharge?.totalByPolicy ??
    breakdown.serviceCharge?.paymentByPolicy ??
    0
  );

  // Monthly service charge (base, pre-policy, pre-VAT)
  const monthlyServiceCharge = roundMoney(
    breakdown.serviceCharge?.monthly ?? 0
  );

  // VAT total on the invoice = VAT on rent + VAT on service charge.
  const vatOnRent = roundMoney(breakdown.rent?.vatAmount || 0);
  const vatOnServiceCharge = roundMoney(breakdown.serviceCharge?.vatAmount || 0);
  const vat = roundMoney(vatOnRent + vatOnServiceCharge);

  // Subtotal = everything before VAT. Because service charge already
  // includes its own VAT, we back that out for a clean "subtotal".
  const serviceChargeExclusiveOfVat = roundMoney(
    serviceCharge - vatOnServiceCharge
  );
  const subtotal = roundMoney(rent + serviceChargeExclusiveOfVat);

  // Withholding tax (if the tenant has any configured)
  const totalWithheld = roundMoney(
    breakdown.withholdingTax?.totalWithheld || 0
  );
  const totalDueWithoutWithholding = roundMoney(
    breakdown.total?.paymentByPolicy || (subtotal + vat)
  );

  // Net payable = what actually goes on the invoice as `totalDue`.
  const totalDue = roundMoney(
    breakdown.withholdingTax?.netPayable || totalDueWithoutWithholding
  );

  return {
    paymentPolicy,
    monthlyRent,
    monthlyServiceCharge,
    rent,
    serviceCharge,          // inclusive of its own VAT
    vat,
    subtotal,               // rent + serviceChargeExclusiveOfVat
    totalDue,
    totalDueWithoutWithholding,
    totalWithheld
  };
}

// Helper function to delete file from storage
async function deleteFromStorage(fileUrl) {
  if (!fileUrl) return;

  try {
    const filename = fileUrl.split('/').pop();
    const filePath = path.join(process.cwd(), 'uploads', filename);

    // Use the imported existsSync
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
      console.log(`Deleted file: ${filename}`);
    }

  } catch (error) {
    console.error('Error deleting file from storage:', error);
    throw error;
  }
}

// @desc    Generate invoice for tenant
// @route   POST /api/invoices/generate
// @access  Private (requires CREATE_INVOICES permission)
export const generateInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId, paymentReportId, dueDate, notes, billingStartDate } = req.body;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: true
          }
        },
        serviceCharge: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const propertyId = tenant.unit?.propertyId;

    // Check permission to generate invoice
    if (userRole !== 'ADMIN') {
      const canManage = await canManageInvoiceForProperty(userId, userRole, propertyId);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to generate invoices for this property'
        });
      }

      const hasCreatePermission = await permissionService.hasPermission(
        userId,
        'CREATE_INVOICES',
        propertyId
      );

      if (!hasCreatePermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create invoices'
        });
      }
    }

    let paymentReport = null;
    if (paymentReportId) {
      paymentReport = await prisma.paymentReport.findUnique({
        where: { id: paymentReportId }
      });
    }

    const paymentPolicy = normalizePaymentPolicy(tenant.paymentPolicy);

    const requestedBillingDate = billingStartDate
      ? toValidDate(billingStartDate)
      : paymentReport?.paymentPeriod
        ? toValidDate(paymentReport.paymentPeriod, new Date())
        : new Date();

    //  Anchor the billing date to the tenant's quarterly/annual cycle,
    // so an invoice generated mid-cycle still points at the correct period.
    const billingDate = alignBillingDateToCycle(requestedBillingDate, tenant);

    const calculated = calculateInvoiceAmountsFromTenant(tenant, billingDate);
    const amountPaid = roundMoney(paymentReport?.amountPaid || 0);
    const balance = roundMoney(calculated.totalDue - amountPaid);
    const invoiceNumber = await generateInvoiceNumber();
    const paymentPeriod = buildPaymentPeriodLabel(billingDate, paymentPolicy);

    // Append withholding info to notes for auditability, if applicable.
    const withholdingNote = calculated.totalWithheld > 0
      ? `Withholding tax withheld: ${calculated.totalWithheld.toFixed(2)}. `
        + `Amount before withholding: ${calculated.totalDueWithoutWithholding.toFixed(2)}.`
      : null;

    const effectiveNotes = [notes, withholdingNote].filter(Boolean).join(' ') || null;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        tenantId,
        paymentReportId: paymentReportId || null,
        issueDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        paymentPeriod,
        rent: calculated.rent,
        serviceCharge: calculated.serviceCharge,
        vat: calculated.vat,
        totalDue: calculated.totalDue,
        amountPaid,
        balance,
        status: amountPaid >= calculated.totalDue ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID',
        notes: effectiveNotes,
        paymentPolicy
      },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true    // needed by the PDF builder for VAT split
          }
        },
        paymentReport: true
      }
    });

    // Generate PDF using the new HTML-based template
    const pdfBuffer = await generatePDF(buildInvoiceHtml(invoice), {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });

    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice generated successfully'
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all invoices for a tenant
// @route   GET /api/invoices/tenant/:tenantId
// @access  Private (requires VIEW_INVOICES permission)
export const getInvoicesByTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;
    const { page = 1, limit = 10, status, paymentPolicy } = req.query;
    const skip = (page - 1) * limit;

    // Get tenant to check property access
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: { property: true }
        }
      }
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const propertyId = tenant.unit?.propertyId;

    // Check permission to view invoices for this tenant
    if (userRole !== 'ADMIN') {
      const canView = await canViewInvoicesForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view invoices for this tenant'
        });
      }

      const hasViewPermission = await permissionService.hasPermission(
        userId,
        'VIEW_INVOICES',
        propertyId
      );

      if (!hasViewPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view invoices'
        });
      }
    }

    const where = { tenantId };
    if (status) {
      where.status = status;
    }
    if (paymentPolicy) {
      where.paymentPolicy = paymentPolicy;
    }

    const total = await prisma.invoice.count({ where });

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            vatRate: true,
            vatType: true,
            unit: {
              include: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      },
      orderBy: { issueDate: 'desc' },
      skip,
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all invoices with filters
// @route   GET /api/invoices
// @access  Private (requires VIEW_INVOICES permission)
export const getAllInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      page = 1,
      limit = 10,
      status,
      paymentPolicy,
      propertyId,
      startDate,
      endDate
    } = req.query;

    const skip = (page - 1) * limit;

    // Check base permission
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      const hasViewPermission = await permissionService.hasPermission(
        userId,
        'VIEW_INVOICES'
      );
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view invoices'
        });
      }
    }

    const where = {};

    if (status) {
      where.status = status;
    }
    if (paymentPolicy) {
      where.paymentPolicy = paymentPolicy;
    }

    // Filter by property with permission check
    if (propertyId) {
      if (userRole !== 'ADMIN') {
        const canView = await canViewInvoicesForProperty(userId, userRole, propertyId);
        if (!canView) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view invoices for this property'
          });
        }
      }
      where.tenant = {
        unit: {
          propertyId
        }
      };
    } else if (userRole === 'MANAGER') {
      // MANAGER can only see their own properties
      const managedProperties = await prisma.property.findMany({
        where: { managerId: userId },
        select: { id: true }
      });
      const managedPropertyIds = managedProperties.map(p => p.id);

      where.tenant = {
        unit: {
          propertyId: { in: managedPropertyIds }
        }
      };
    } else if (userRole !== 'ADMIN') {
      // USER role - only properties they have access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      where.tenant = {
        unit: {
          propertyId: { in: accessiblePropertyIds }
        }
      };
    }

    if (startDate || endDate) {
      where.issueDate = {};
      if (startDate) {
        where.issueDate.gte = new Date(startDate);
      }
      if (endDate) {
        where.issueDate.lte = new Date(endDate);
      }
    }

    const total = await prisma.invoice.count({ where });

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            vatRate: true,
            vatType: true,
            paymentPolicy: true,
            unit: {
              include: {
                property: {
                  select: { id: true, name: true, address: true }
                }
              }
            }
          }
        }
      },
      orderBy: { issueDate: 'desc' },
      skip,
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private (requires VIEW_INVOICES permission)
export const getInvoiceById = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true
          }
        },
        paymentReport: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Check permission to view this invoice
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this invoice'
        });
      }

      const hasViewPermission = await permissionService.hasPermission(
        userId,
        'VIEW_INVOICES'
      );

      if (!hasViewPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view invoices'
        });
      }
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update invoice status
// @route   PATCH /api/invoices/:id/status
// @access  Private (requires EDIT_INVOICES permission)
export const updateInvoiceStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { status, amountPaid } = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const propertyId = invoice.tenant?.unit?.propertyId;

    // Check permission to update invoice
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this invoice'
        });
      }

      const hasEditPermission = await permissionService.hasPermission(
        userId,
        'EDIT_INVOICES',
        propertyId
      );

      if (!hasEditPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to edit invoices'
        });
      }
    }

    const updateData = { status };

    if (amountPaid !== undefined) {
      updateData.amountPaid = amountPaid;
      updateData.balance = invoice.totalDue - amountPaid;

      if (amountPaid >= invoice.totalDue) {
        updateData.status = 'PAID';
      } else if (amountPaid > 0) {
        updateData.status = 'PARTIAL';
      }
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData
    });

    // =============================================
    // SIBLING RECONCILIATION (HYBRID MODEL)
    // ---------------------------------------------------------------
    // CRITICAL RULES:
    //   - amountPaid is IMMUTABLE (actual money received).
    //   - arrears is IMMUTABLE (historical snapshot right after payment).
    //   - Only STATUS is updated to reflect the live invoice state.
    //
    // IMPORTANT: We reconcile by TENANT + PAYMENT PERIOD, not just by
    // linked invoices, because an invoice can only point to ONE report
    // via paymentReportId. Earlier partial reports for the same period
    // would otherwise be orphaned and stuck at PARTIAL forever.
    // =============================================
    const affectedInvoice = await prisma.invoice.findUnique({
      where: { id: updatedInvoice.id },
      select: { id: true, tenantId: true, paymentPeriod: true }
    });

    if (affectedInvoice) {
      // Collect all invoice IDs linked to the same tenant + period
      // (so we catch siblings that share a ledger with this invoice),
      // PLUS any invoices directly linked to the same payment report.
      const periodLabelCandidates = new Set();
      if (affectedInvoice.paymentPeriod) {
        periodLabelCandidates.add(affectedInvoice.paymentPeriod);
        const parsed = new Date(affectedInvoice.paymentPeriod);
        if (!isNaN(parsed.getTime())) {
          periodLabelCandidates.add(
            parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          );
        }
        // Also try "Month YYYY" parse via invoice.controller's own helper
        const m = String(affectedInvoice.paymentPeriod).match(/^([A-Za-z]+)\s+(\d{4})/);
        if (m) {
          periodLabelCandidates.add(
            `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`
          );
        }
      }

      const siblingInvoices = await prisma.invoice.findMany({
        where: {
          OR: [
            { tenantId: affectedInvoice.tenantId, id: affectedInvoice.id },
            ...(periodLabelCandidates.size > 0
              ? [{
                  tenantId: affectedInvoice.tenantId,
                  paymentPeriod: { in: Array.from(periodLabelCandidates) }
                }]
              : []),
            ...(updatedInvoice.paymentReportId
              ? [{ paymentReportId: updatedInvoice.paymentReportId }]
              : [])
          ]
        },
        select: {
          id: true,
          tenantId: true,
          paymentPeriod: true,
          totalDue: true,
          amountPaid: true,
          balance: true,
          status: true,
          paymentReportId: true
        }
      });

      const siblingInvoiceIds = siblingInvoices.map(i => i.id);

      // Find every report that references any of those invoices
      // OR shares the same tenant + period.
      const linkedReports = await prisma.paymentReport.findMany({
        where: {
          tenantId: affectedInvoice.tenantId,
          status: { notIn: ['PREPAID', 'CREDIT'] },
          OR: [
            { invoices: { some: { id: { in: siblingInvoiceIds } } } },
            ...(periodLabelCandidates.size > 0
              ? [{ paymentPeriod: { in: Array.from(periodLabelCandidates) } }]
              : [])
          ]
        },
        include: {
          invoices: {
            select: {
              id: true,
              totalDue: true,
              amountPaid: true,
              balance: true,
              status: true,
              paymentPeriod: true
            }
          }
        }
      });

      // Build a per-period live invoice state map so orphaned reports
      // (those with no linked invoices) can be reconciled too.
      const liveInvoiceState = new Map();
      for (const inv of siblingInvoices) {
        const key = inv.paymentPeriod || '__no_period__';
        if (!liveInvoiceState.has(key)) {
          liveInvoiceState.set(key, []);
        }
        liveInvoiceState.get(key).push(inv);
      }

      for (const linkedReport of linkedReports) {
        // Never touch PREPAID / CREDIT reports
        if (linkedReport.status === 'PREPAID' || linkedReport.status === 'CREDIT') {
          continue;
        }

        let liveArrears = 0;
        let totalPaid = 0;

        if (linkedReport.invoices.length > 0) {
          liveArrears = linkedReport.invoices.reduce(
            (sum, inv) => sum + Math.max(0, Number(inv.balance) || 0), 0
          );
          totalPaid = linkedReport.invoices.reduce(
            (sum, inv) => sum + Math.min(
              Number(inv.amountPaid) || 0,
              Number(inv.totalDue) || 0
            ), 0
          );
        } else {
          // Orphaned: reconcile by tenant + period
          const candidates = new Set();
          if (linkedReport.paymentPeriod) {
            candidates.add(linkedReport.paymentPeriod);
            const parsed = new Date(linkedReport.paymentPeriod);
            if (!isNaN(parsed.getTime())) {
              candidates.add(
                parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              );
            }
          }
          // Add the affected invoice's period variants
          for (const p of periodLabelCandidates) candidates.add(p);

          for (const periodKey of candidates) {
            const invs = liveInvoiceState.get(periodKey) || [];
            for (const inv of invs) {
              liveArrears += Math.max(0, Number(inv.balance) || 0);
              totalPaid += Math.min(
                Number(inv.amountPaid) || 0,
                Number(inv.totalDue) || 0
              );
            }
          }

          // Final fallback: use the affected invoice itself
          if (liveArrears === 0 && totalPaid === 0) {
            const inv = siblingInvoices.find(i => i.id === affectedInvoice.id);
            if (inv) {
              liveArrears = Math.max(0, Number(inv.balance) || 0);
              totalPaid = Math.min(
                Number(inv.amountPaid) || 0,
                Number(inv.totalDue) || 0
              );
            }
          }
        }

        let correctStatus = linkedReport.status;
        if (liveArrears <= 0.01) {
          correctStatus = 'PAID';
        } else if (totalPaid > 0) {
          correctStatus = 'PARTIAL';
        } else {
          correctStatus = 'UNPAID';
        }

        // ONLY update status. amountPaid and arrears are IMMUTABLE.
        if (correctStatus !== linkedReport.status) {
          await prisma.paymentReport.update({
            where: { id: linkedReport.id },
            data: {
              status: correctStatus,
              updatedAt: new Date()
            }
          });

          console.log(
            `Reconciled report ${linkedReport.id}: ` +
            `status ${linkedReport.status} -> ${correctStatus} ` +
            `(amountPaid preserved: ${linkedReport.amountPaid}, ` +
            `arrears snapshot preserved: ${linkedReport.arrears})`
          );
        }
      }
    }

    res.json({
      success: true,
      data: {
        ...updatedInvoice,
        reconciliation: updatedInvoice.paymentReportId ? {
          paymentReportId: updatedInvoice.paymentReportId,
          reconciled: true,
          status: updatedInvoice.status
        } : null
      },
      message: 'Invoice updated successfully' +
        (updatedInvoice.paymentReportId ? ' (Linked payment reports reconciled)' : '')
    });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
// @desc    Download invoice PDF
// @route   GET /api/invoices/:id/download
// @access  Private (requires VIEW_INVOICES permission)
export const downloadInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true    // needed by PDF builder for VAT split
          }
        },
        paymentReport: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Check permission to download invoice
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download this invoice'
        });
      }

      const hasViewPermission = await permissionService.hasPermission(
        userId,
        'DOWNLOAD_INVOICES'
      );

      if (!hasViewPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download invoices'
        });
      }
    }

    // Generate PDF using the new HTML-based template
    const pdfBuffer = await generatePDF(buildInvoiceHtml(invoice), {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Generate invoice for partial payment balance
// @route   POST /api/invoices/generate-from-partial
// @access  Private (requires CREATE_INVOICES permission)
export const generateInvoiceFromPartialPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { paymentReportId, dueDate, notes } = req.body;

    if (!paymentReportId) {
      return res.status(400).json({
        success: false,
        message: 'paymentReportId is required'
      });
    }

    // Fetch payment report with tenant details
    const paymentReport = await prisma.paymentReport.findUnique({
      where: { id: paymentReportId },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true
          }
        },
        invoices: true
      }
    });

    if (!paymentReport) {
      return res.status(404).json({
        success: false,
        message: 'Payment report not found'
      });
    }

    const propertyId = paymentReport.tenant?.unit?.propertyId;

    // Check permission to generate invoice
    if (userRole !== 'ADMIN') {
      const canManage = await canManageInvoiceForProperty(userId, userRole, propertyId);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to generate invoices for this property'
        });
      }

      const hasCreatePermission = await permissionService.hasPermission(
        userId,
        'CREATE_INVOICES',
        propertyId
      );

      if (!hasCreatePermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create invoices'
        });
      }
    }

    // Check if payment status is PARTIAL
    if (paymentReport.status !== 'PARTIAL') {
      return res.status(400).json({
        success: false,
        message: 'Can only generate invoices for partial payments. Current status: ' + paymentReport.status
      });
    }

    // Check if balance exists
    if (paymentReport.arrears <= 0) {
      return res.status(400).json({
        success: false,
        message: 'No outstanding balance to invoice'
      });
    }

    const tenant = paymentReport.tenant;

    // Use values from the payment report
    const rent = paymentReport.rent;
    const serviceCharge = paymentReport.serviceCharge || 0;
    const vat = paymentReport.vat || 0;
    const balance = paymentReport.arrears;

    // Generate unique invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // FIX: Convert paymentPeriod to a string
    // If paymentReport.paymentPeriod is a Date, format it to a readable string
    let paymentPeriod;
    if (paymentReport.paymentPeriod) {
      // Convert Date to string format (e.g., "June 2026" or "June 1, 2026 - June 30, 2026")
      const paymentDate = new Date(paymentReport.paymentPeriod);

      // Use the existing buildPaymentPeriodLabel function to get a consistent format
      // Pass the tenant's payment policy to get the correct period label
      paymentPeriod = buildPaymentPeriodLabel(paymentDate, tenant.paymentPolicy || 'MONTHLY');
    } else {
      // Fallback to current month if no payment period
      paymentPeriod = buildPaymentPeriodLabel(new Date(), tenant.paymentPolicy || 'MONTHLY');
    }

    // Create invoice record for the balance with paymentPolicy
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        tenantId: tenant.id,
        paymentReportId: paymentReportId,
        issueDate: new Date(),
        dueDate: new Date(dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        paymentPeriod: paymentPeriod, // Now this is a String, not a Date
        rent,
        serviceCharge,
        vat,
        totalDue: balance,
        amountPaid: 0,
        balance: balance,
        status: 'UNPAID',
        notes: notes || `Balance invoice for ${paymentPeriod}`,
        paymentPolicy: tenant.paymentPolicy || 'MONTHLY'
      },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true    // needed by PDF builder for VAT split
          }
        },
        paymentReport: true
      }
    });

    // Generate PDF using the new HTML-based template
    const pdfBuffer = await generatePDF(buildInvoiceHtml(invoice), {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });

    // Upload PDF to storage
    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    // Update invoice with PDF URL
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Balance invoice generated successfully for partial payment'
    });
  } catch (error) {
    console.error('Error generating balance invoice:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all partial payment reports (status = PARTIAL with balance > 0)
// @route   GET /api/invoices/partial-payments
// @access  Private (requires VIEW_INVOICES permission)
export const getPartialPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Check base permission
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      const hasViewPermission = await permissionService.hasPermission(
        userId,
        'VIEW_INVOICES'
      );
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view partial payments'
        });
      }
    }

    const where = {
      status: 'PARTIAL',
      arrears: {
        gt: 0
      }
    };

    // Filter by property if provided
    if (propertyId) {
      if (userRole !== 'ADMIN') {
        const canView = await canViewInvoicesForProperty(userId, userRole, propertyId);
        if (!canView) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view partial payments for this property'
          });
        }
      }
      where.tenant = {
        unit: {
          propertyId
        }
      };
    } else if (userRole === 'MANAGER') {
      const managedProperties = await prisma.property.findMany({
        where: { managerId: userId },
        select: { id: true }
      });
      const managedPropertyIds = managedProperties.map(p => p.id);

      where.tenant = {
        unit: {
          propertyId: { in: managedPropertyIds }
        }
      };
    } else if (userRole !== 'ADMIN') {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      where.tenant = {
        unit: {
          propertyId: { in: accessiblePropertyIds }
        }
      };
    }

    const total = await prisma.paymentReport.count({ where });

    const partialPayments = await prisma.paymentReport.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            vatRate: true,
            vatType: true,
            paymentPolicy: true,
            unit: {
              include: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            totalDue: true,
            amountPaid: true,
            balance: true,
            status: true,
            issueDate: true,
            paymentPolicy: true
          }
        }
      },
      orderBy: { paymentPeriod: 'desc' },
      skip,
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: partialPayments,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching partial payments:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update invoice with payment policy (for existing invoices)
// @route   PATCH /api/invoices/:id/payment-policy
// @access  Private (requires EDIT_INVOICES permission)
export const updateInvoicePaymentPolicy = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const {
      paymentPolicy,
      billingStartDate,
      paymentPeriod: explicitPeriod,   // NEW: allow direct period label override
      dueDate: explicitDueDate,        // NEW: allow direct dueDate override
      issueDate: explicitIssueDate     // NEW (optional): allow issueDate override
    } = req.body;

    const normalizedPolicy = normalizePaymentPolicy(paymentPolicy);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: true,
            serviceCharge: true
          }
        },
        paymentReport: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const propertyId = invoice.tenant?.unit?.propertyId;

    // Check permission to update invoice
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this invoice'
        });
      }

      const hasEditPermission = await permissionService.hasPermission(
        userId,
        'EDIT_INVOICES',
        propertyId
      );

      if (!hasEditPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to edit invoices'
        });
      }
    }

    // Determine the billing date used for recalculation:
    //  1. explicit billingStartDate from body
    //  2. the linked payment report's period (if any)
    //  3. the invoice's existing issueDate
    const billingDate = billingStartDate
      ? toValidDate(billingStartDate)
      : invoice.paymentReport?.paymentPeriod
        ? toValidDate(invoice.paymentReport.paymentPeriod, invoice.issueDate)
        : toValidDate(invoice.issueDate);

    const tenantForCalculation = {
      ...invoice.tenant,
      paymentPolicy: normalizedPolicy
    };

    const calculated = calculateInvoiceAmountsFromTenant(tenantForCalculation, billingDate);
    const amountPaid = roundMoney(invoice.amountPaid || 0);
    const balance = roundMoney(calculated.totalDue - amountPaid);
    const status =
      amountPaid >= calculated.totalDue ? 'PAID'
      : amountPaid > 0 ? 'PARTIAL'
      : 'UNPAID';

    // NEW: allow explicit label override; otherwise derive from billingDate + policy
    const finalPeriod = explicitPeriod
      ? String(explicitPeriod).trim()
      : buildPaymentPeriodLabel(billingDate, normalizedPolicy);

    // NEW: allow explicit dueDate override; otherwise preserve existing
    const finalDueDate = explicitDueDate
      ? toValidDate(explicitDueDate, invoice.dueDate)
      : invoice.dueDate;

    // NEW (optional): allow explicit issueDate override; otherwise preserve existing
    const finalIssueDate = explicitIssueDate
      ? toValidDate(explicitIssueDate, invoice.issueDate)
      : invoice.issueDate;

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        paymentPolicy: normalizedPolicy,
        paymentPeriod: finalPeriod,
        issueDate: finalIssueDate,
        dueDate: finalDueDate,
        rent: calculated.rent,
        serviceCharge: calculated.serviceCharge,
        vat: calculated.vat,
        totalDue: calculated.totalDue,
        balance,
        status
      },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true
          }
        },
        paymentReport: true
      }
    });

    res.json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice payment policy updated successfully'
    });
  } catch (error) {
    console.error('Error updating invoice payment policy:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete invoice with all related data (comprehensive cleanup)
// @route   DELETE /api/invoices/:id
// @access  Private (requires DELETE_INVOICES permission)
export const deleteInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const {
      deletePaymentReport = true,
      deleteRelatedInvoices = true,
      deleteBillInvoices = true,
      deleteIncome = true,
      deleteCommissions = true,
      cascadeDelete = true,
      force = false
    } = req.body;

    // Find invoice with comprehensive related data
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        paymentReport: {
          include: {
            invoices: {
              select: {
                id: true,
                invoiceNumber: true,
                totalDue: true,
                amountPaid: true,
                balance: true,
                status: true,
                createdAt: true,
                tenantId: true,
                paymentPeriod: true,
                paymentPolicy: true,
                pdfUrl: true
              }
            },
            billInvoices: true,
            tenant: {
              select: {
                id: true,
                fullName: true
              }
            }
          }
        },
        tenant: {
          select: {
            id: true,
            fullName: true,
            unit: {
              select: {
                property: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const propertyId = invoice.tenant?.unit?.property?.id;

    // Check permission to delete invoice
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this invoice'
        });
      }

      const hasDeletePermission = await permissionService.hasPermission(
        userId,
        'DELETE_INVOICES',
        propertyId
      );

      if (!hasDeletePermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete invoices'
        });
      }
    }

    // Check age for safety
    const invoiceAge = Date.now() - new Date(invoice.createdAt).getTime();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 60 days

    if (!force && invoiceAge > maxAge && userRole !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: `Invoice is older than 60 days. Use force=true to delete.`,
        ageInDays: Math.floor(invoiceAge / (24 * 60 * 60 * 1000))
      });
    }

    const result = {
      deletedInvoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalDue: invoice.totalDue,
        amountPaid: invoice.amountPaid,
        status: invoice.status
      },
      deletedRelatedInvoices: [],
      deletedBillInvoices: [],
      deletedPaymentReport: null,
      deletedIncome: null,
      deletedCommissions: [],
      adjustedCreditBalance: false,
      adjustedOverpayment: false,
      deletedPdfs: 0,
      cascadedDeletions: 0,
      receiptDeleted: false,
      unlinkedRecords: 0
    };

    // Start transaction for comprehensive cleanup
    await prisma.$transaction(async (tx) => {
      // 1. Delete the main invoice PDF
      if (invoice.pdfUrl) {
        try {
          const fileName = invoice.pdfUrl.split('/').pop();
          const filePath = path.join(process.cwd(), 'uploads', 'invoices', fileName);

          if (existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            result.deletedPdfs++;
            console.log(`Deleted invoice PDF: ${filePath}`);
          }
        } catch (fileError) {
          console.warn(`PDF delete failed for ${invoice.invoiceNumber}:`, fileError.message);
        }
      }

      // 2. Handle payment report and related data
      if (invoice.paymentReportId && invoice.paymentReport && (deletePaymentReport || cascadeDelete)) {
        const paymentReport = invoice.paymentReport;

        // 2a. Delete receipt PDF
        if (paymentReport.receiptUrl) {
          try {
            await deleteFromStorage(paymentReport.receiptUrl);
            result.deletedPdfs++;
            result.receiptDeleted = true;
          } catch (error) {
            console.warn('Failed to delete receipt PDF:', error.message);
          }
        }

        // 2b. Delete related income records
        if (deleteIncome || cascadeDelete) {
          const incomeRecords = await tx.income.findMany({
            where: {
              tenantId: invoice.tenantId,
              createdAt: {
                gte: new Date(invoice.createdAt.getTime() - 24 * 60 * 60 * 1000),
                lte: new Date(invoice.createdAt.getTime() + 24 * 60 * 60 * 1000)
              }
            }
          });

          if (incomeRecords.length > 0) {
            let incomeToDelete = incomeRecords.find(inc =>
              inc.amount === invoice.amountPaid ||
              Math.abs(inc.amount - invoice.amountPaid) < 0.01
            ) || incomeRecords[0];

            if (incomeToDelete) {
              await tx.income.delete({
                where: { id: incomeToDelete.id }
              });

              result.deletedIncome = {
                id: incomeToDelete.id,
                amount: incomeToDelete.amount
              };
            }
          }
        }

        // 2c. Delete commission records
        if (deleteCommissions || cascadeDelete) {
          await tx.managerCommission.deleteMany({
            where: {
              OR: [
                { notes: { contains: invoice.invoiceNumber } },
                { notes: { contains: paymentReport.id } }
              ]
            }
          });
        }

        // 2d. Delete related bill invoices
        if ((deleteBillInvoices || cascadeDelete) && paymentReport.billInvoices.length > 0) {
          for (const billInvoice of paymentReport.billInvoices) {
            if (billInvoice.pdfUrl) {
              try {
                const fileName = billInvoice.pdfUrl.split('/').pop();
                const filePath = path.join(process.cwd(), 'uploads', fileName);
                if (existsSync(filePath)) {
                  await fs.promises.unlink(filePath);
                  result.deletedPdfs++;
                }
              } catch (fileError) {
                console.warn(`PDF delete failed for bill invoice:`, fileError.message);
              }
            }

            await tx.billInvoice.delete({
              where: { id: billInvoice.id }
            });

            result.deletedBillInvoices.push({
              id: billInvoice.id,
              invoiceNumber: billInvoice.invoiceNumber
            });
          }
        }

        // 2e. Delete related invoices
        if ((deleteRelatedInvoices || cascadeDelete) && paymentReport.invoices.length > 0) {
          for (const relatedInvoice of paymentReport.invoices) {
            if (relatedInvoice.id !== invoice.id) {
              if (relatedInvoice.pdfUrl) {
                try {
                  const fileName = relatedInvoice.pdfUrl.split('/').pop();
                  const filePath = path.join(process.cwd(), 'uploads', 'invoices', fileName);
                  if (existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                    result.deletedPdfs++;
                  }
                } catch (fileError) {
                  console.warn(`PDF delete failed for related invoice:`, fileError.message);
                }
              }

              await tx.invoice.delete({
                where: { id: relatedInvoice.id }
              });

              result.deletedRelatedInvoices.push({
                id: relatedInvoice.id,
                invoiceNumber: relatedInvoice.invoiceNumber
              });
            }
          }
        }

        // 2f. Delete payment report
        await tx.paymentReport.delete({
          where: { id: paymentReport.id }
        });

        result.deletedPaymentReport = {
          id: paymentReport.id,
          amountPaid: paymentReport.amountPaid,
          status: paymentReport.status
        };
      }

      // 3. Delete the main invoice
      await tx.invoice.delete({
        where: { id }
      });
    });

    res.json({
      success: true,
      data: result,
      message: `Invoice ${invoice.invoiceNumber} deleted successfully`
    });

  } catch (error) {
    console.error('Error in comprehensive invoice deletion:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete invoice'
    });
  }
};

// @desc    Delete invoice PDF only (keep database record)
// @route   DELETE /api/invoices/:id/pdf
// @access  Private (requires EDIT_INVOICES permission)
export const deleteInvoicePDF = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const propertyId = invoice.tenant?.unit?.propertyId;

    // Check permission to delete PDF
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessInvoice(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to modify this invoice'
        });
      }

      const hasEditPermission = await permissionService.hasPermission(
        userId,
        'EDIT_INVOICES',
        propertyId
      );

      if (!hasEditPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete invoice PDFs'
        });
      }
    }

    if (!invoice.pdfUrl) {
      return res.status(400).json({
        success: false,
        message: 'No PDF associated with this invoice'
      });
    }

    // Delete PDF file from storage
    const filePath = path.join(
      process.cwd(),
      'uploads',
      'invoices',
      path.basename(invoice.pdfUrl)
    );

    if (existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    // Update invoice to remove PDF URL
    await prisma.invoice.update({
      where: { id },
      data: { pdfUrl: null }
    });

    res.json({
      success: true,
      message: 'Invoice PDF deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting invoice PDF:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};