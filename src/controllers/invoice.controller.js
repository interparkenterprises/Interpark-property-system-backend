import prisma from '../lib/prisma.js';
import { uploadToStorage } from '../utils/storage.js';
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import sizeOf from 'image-size';
import { addBillingPeriod, calculateChargeByPolicy, calculateEscalatedRent } from '../services/rentCalculation.js';
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

function calculateMonthlyServiceCharge(tenant, monthlyRent) {
  if (!tenant?.serviceCharge) return 0;

  switch (tenant.serviceCharge.type) {
    case 'FIXED':
      return roundMoney(tenant.serviceCharge.fixedAmount || 0);

    case 'PERCENTAGE':
      return roundMoney((monthlyRent * (tenant.serviceCharge.percentage || 0)) / 100);

    case 'PER_SQ_FT':
      return roundMoney((tenant.serviceCharge.perSqFtRate || 0) * (tenant.unit?.sizeSqFt || 0));

    default:
      return 0;
  }
}

function buildPaymentPeriodLabel(startDate, paymentPolicy = 'MONTHLY') {
  const policy = normalizePaymentPolicy(paymentPolicy);
  const start = toValidDate(startDate);
  const endExclusive = addBillingPeriod(start, policy);
  const end = new Date(endExclusive);
  end.setDate(end.getDate() - 1);

  const shortDate = (date) =>
    date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

  switch (policy) {
    case 'QUARTERLY':
    case 'ANNUAL':
      return `${shortDate(start)} - ${shortDate(end)}`;

    case 'MONTHLY':
    default:
      return start.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });
  }
}

function calculateInvoiceAmountsFromTenant(tenant, billingDate = new Date()) {
  const paymentPolicy = normalizePaymentPolicy(tenant.paymentPolicy);
  const { currentRent } = calculateEscalatedRent(tenant, billingDate);
  const monthlyRent = roundMoney(currentRent || tenant.rent || 0);
  const monthlyServiceCharge = calculateMonthlyServiceCharge(tenant, monthlyRent);

  const rent = roundMoney(calculateChargeByPolicy(monthlyRent, paymentPolicy));
  const serviceCharge = roundMoney(calculateChargeByPolicy(monthlyServiceCharge, paymentPolicy));
  const subtotal = roundMoney(rent + serviceCharge);

  const vatRate = Number(tenant.vatRate ?? 16);
  let vat = 0;

  if (tenant.vatType === 'INCLUSIVE') {
    vat = subtotal - subtotal / (1 + vatRate / 100);
  } else if (tenant.vatType === 'EXCLUSIVE') {
    vat = (subtotal * vatRate) / 100;
  }

  vat = roundMoney(vat);

  const totalDue = tenant.vatType === 'INCLUSIVE'
    ? subtotal
    : roundMoney(subtotal + vat);

  return {
    paymentPolicy,
    monthlyRent,
    monthlyServiceCharge,
    rent,
    serviceCharge,
    vat,
    subtotal,
    totalDue
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

    const billingDate = billingStartDate
      ? toValidDate(billingStartDate)
      : paymentReport?.paymentPeriod
        ? toValidDate(paymentReport.paymentPeriod, new Date())
        : new Date();

    const calculated = calculateInvoiceAmountsFromTenant(tenant, billingDate);
    const amountPaid = roundMoney(paymentReport?.amountPaid || 0);
    const balance = roundMoney(calculated.totalDue - amountPaid);
    const invoiceNumber = await generateInvoiceNumber();
    const paymentPeriod = buildPaymentPeriodLabel(billingDate, paymentPolicy);

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
        notes,
        paymentPolicy
      },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
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
            }
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
    // FIXED: Update linked payment reports when invoice status changes
    // =============================================
    if (updatedInvoice.paymentReportId) {
      console.log(`Reconciling payment report for invoice ${updatedInvoice.invoiceNumber}`);
      
      // Get all invoices linked to this payment report
      const reportInvoices = await prisma.invoice.findMany({
        where: {
          paymentReportId: updatedInvoice.paymentReportId
        }
      });
      
      // Check if all invoices are fully paid
      const allFullyPaid = reportInvoices.every(inv => inv.status === 'PAID');
      
      // Calculate actual totals
      const totalDue = reportInvoices.reduce((sum, inv) => sum + inv.totalDue, 0);
      const totalPaid = reportInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
      const actualArrears = Math.max(0, totalDue - totalPaid);
      
      // Determine correct status
      let correctStatus = 'UNPAID';
      if (allFullyPaid || actualArrears === 0) {
        correctStatus = 'PAID';
      } else if (actualArrears > 0 && totalPaid > 0) {
        correctStatus = 'PARTIAL';
      } else if (actualArrears > 0 && totalPaid === 0) {
        correctStatus = 'UNPAID';
      }
      
      // Get the payment report to check if it needs updating
      const paymentReport = await prisma.paymentReport.findUnique({
        where: { id: updatedInvoice.paymentReportId }
      });
      
      if (paymentReport) {
        // Update if status changed or arrears changed significantly
        if (correctStatus !== paymentReport.status || 
            Math.abs(paymentReport.arrears - actualArrears) > 0.01) {
          
          await prisma.paymentReport.update({
            where: { id: updatedInvoice.paymentReportId },
            data: {
              status: correctStatus,
              arrears: actualArrears,
              amountPaid: totalPaid,
              rent: reportInvoices.reduce((sum, inv) => sum + (inv.rent || 0), 0),
              serviceCharge: reportInvoices.reduce((sum, inv) => sum + (inv.serviceCharge || 0), 0),
              vat: reportInvoices.reduce((sum, inv) => sum + (inv.vat || 0), 0),
              totalDue: totalDue,
              updatedAt: new Date()
            }
          });
          
          console.log(`Reconciled payment report ${paymentReport.id}: ${paymentReport.status} -> ${correctStatus}`);
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
        (updatedInvoice.paymentReportId ? ' (Linked payment report reconciled)' : '')
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
            }
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
            }
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
    const { paymentPolicy, billingStartDate } = req.body;

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
    const status = amountPaid >= calculated.totalDue ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID';

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        paymentPolicy: normalizedPolicy,
        paymentPeriod: buildPaymentPeriodLabel(billingDate, normalizedPolicy),
        rent: calculated.rent,
        serviceCharge: calculated.serviceCharge,
        vat: calculated.vat,
        totalDue: calculated.totalDue,
        balance,
        status
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