import prisma from "../lib/prisma.js";
import { generatePDF } from '../utils/pdfGenerator.js';
import { processCommissionForIncome } from '../services/commissionService.js';
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import { generateReceiptHTML } from '../utils/receiptTemplate.js';
import { uploadToStorage } from '../utils/storage.js';
import { getPolicyMonths, addBillingPeriod, getBaseRent } from '../services/rentCalculation.js';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import permissionService from "../services/permissionService.js";

// Helper: Compute expected rent & service charge for a tenant at a given period
async function computeExpectedCharges(tenantId, periodStart = null) {
  const now = periodStart ? new Date(periodStart) : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const periodStartOfMonth = new Date(year, month, 1);
  const periodEndOfMonth = new Date(year, month + 1, 0);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      unit: {
        include: { property: true }
      },
      serviceCharge: true
    }
  });

  if (!tenant) throw new Error('Tenant not found');

  // Determine expected rent (account for escalation if needed)
  let expectedRent = tenant.rent;
  
  // Check for escalation
  if (tenant.escalationRate && tenant.escalationFrequency && new Date(tenant.rentStart) <= periodStartOfMonth) {
    const monthsElapsed = Math.floor(
      (periodStartOfMonth - new Date(tenant.rentStart)) / (30.44 * 24 * 60 * 60 * 1000)
    );
    
    let escalationIntervalMonths = 12;
    if (tenant.escalationFrequency === 'BI_ANNUALLY') {
      escalationIntervalMonths = 6;
    } else if (tenant.escalationFrequency === 'BI_ENNIAL') {
      escalationIntervalMonths = 24;
    }
    
    const escalationsApplied = Math.floor(monthsElapsed / escalationIntervalMonths);
    
    if (escalationsApplied > 0) {
      expectedRent = tenant.rent * Math.pow(1 + tenant.escalationRate / 100, escalationsApplied);
    }
  }

  // =============================================
  // Get base rent (excluding VAT) for service charge calculation
  // For EXCLUSIVE VAT: base rent = expectedRent (already exclusive)
  // For INCLUSIVE VAT: base rent = expectedRent / (1 + VAT rate)
  // =============================================
  const baseRent = getBaseRent(expectedRent, tenant.vatType, tenant.vatRate);

  // =============================================
  // Compute service charge based on BASE RENT
  // =============================================
  let serviceCharge = 0;
  const sc = tenant.serviceCharge;
  if (sc) {
    switch (sc.type) {
      case 'FIXED':
        serviceCharge = sc.fixedAmount || 0;
        break;
      case 'PERCENTAGE':
        serviceCharge = baseRent * (sc.percentage || 0) / 100;
        break;
      case 'PER_SQ_FT':
        const sqFt = tenant.unit?.sizeSqFt || 0;
        serviceCharge = sqFt * (sc.perSqFtRate || 0);
        break;
      default:
        serviceCharge = 0;
    }
  }

  // =============================================
  // Calculate VAT on Rent
  // =============================================
  let vatOnRent = 0;
  const vatRate = tenant.vatRate || 16;

  if (tenant.vatType === 'EXCLUSIVE') {
    vatOnRent = expectedRent * vatRate / 100;
  } else if (tenant.vatType === 'INCLUSIVE') {
    vatOnRent = (expectedRent * vatRate) / (100 + vatRate);
  }

  // =============================================
  // Calculate Service Charge VAT based on its own settings
  // =============================================
  let serviceChargeVat = 0;
  let serviceChargeInclusive = serviceCharge; // The amount the tenant pays (may include VAT)

  if (sc) {
    const scVatType = sc.vatType || 'NOT_APPLICABLE';
    const scVatRate = sc.vatRate || 0;

    if (scVatType === 'EXCLUSIVE') {
      // Service charge is exclusive of VAT, add VAT on top
      serviceChargeVat = (serviceCharge * scVatRate) / 100;
      // The total service charge the tenant pays is serviceCharge + VAT
      serviceChargeInclusive = serviceCharge + serviceChargeVat;
    } else if (scVatType === 'INCLUSIVE') {
      // Service charge already includes VAT
      // The serviceCharge amount already includes VAT, so we extract the VAT portion
      serviceChargeVat = (serviceCharge * scVatRate) / (100 + scVatRate);
      // The total service charge the tenant pays is the serviceCharge (already inclusive)
      serviceChargeInclusive = serviceCharge;
    } else {
      // NOT_APPLICABLE - no VAT on service charge
      serviceChargeVat = 0;
      serviceChargeInclusive = serviceCharge;
    }
  }

  // =============================================
  // Calculate Total Due
  // =============================================
  let totalDue;

  if (tenant.vatType === 'EXCLUSIVE') {
    // Rent (exclusive) + VAT on Rent + Service Charge (inclusive of its VAT)
    totalDue = expectedRent + vatOnRent + serviceChargeInclusive;
  } else if (tenant.vatType === 'INCLUSIVE') {
    // Rent (inclusive) + Service Charge (inclusive of its VAT)
    totalDue = expectedRent + serviceChargeInclusive;
  } else {
    // NOT_APPLICABLE: rent + service charge
    totalDue = expectedRent + serviceCharge;
  }

  // Total VAT (for reporting)
  const totalVat = vatOnRent + serviceChargeVat;

  return {
    rent: parseFloat(expectedRent.toFixed(2)),
    serviceCharge: parseFloat(serviceCharge.toFixed(2)), // Base service charge (before VAT)
    serviceChargeInclusive: parseFloat(serviceChargeInclusive.toFixed(2)), // Service charge with VAT included
    serviceChargeVat: parseFloat(serviceChargeVat.toFixed(2)), // VAT on service charge
    vatOnRent: parseFloat(vatOnRent.toFixed(2)),
    vat: parseFloat(totalVat.toFixed(2)),
    vatType: tenant.vatType,
    vatRate: tenant.vatRate || 0,
    totalDue: parseFloat(totalDue.toFixed(2)),
    periodStart: periodStartOfMonth,
    periodEnd: periodEndOfMonth
  };
}

function formatMonthYear(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });
}

function formatPaymentPeriodLabel(periodStart, periodEnd, paymentPolicy) {
  if (paymentPolicy === 'MONTHLY') {
    return formatMonthYear(periodStart);
  }

  return `${formatMonthYear(periodStart)} - ${formatMonthYear(periodEnd)}`;
}

// Helper: Compute expected charges for the tenant's billing policy
async function computeExpectedChargesForPolicy(tenantId, periodStart = null, paymentPolicy = 'MONTHLY') {
  const start = periodStart ? new Date(periodStart) : new Date();
  const normalizedStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const periodMonths = getPolicyMonths(paymentPolicy);

  let rent = 0;
  let serviceCharge = 0;
  let vat = 0;
  let totalDue = 0;
  const monthlyBreakdown = [];

  for (let i = 0; i < periodMonths; i++) {
    const monthDate = new Date(normalizedStart.getFullYear(), normalizedStart.getMonth() + i, 1);
    const monthly = await computeExpectedCharges(tenantId, monthDate);

    rent += monthly.rent;
    serviceCharge += monthly.serviceCharge;
    vat += monthly.vat;
    totalDue += monthly.totalDue;

    monthlyBreakdown.push({
      month: formatMonthYear(monthDate),
      rent: monthly.rent,
      serviceCharge: monthly.serviceCharge,
      vat: monthly.vat,
      totalDue: monthly.totalDue
    });
  }

  const periodEnd = new Date(normalizedStart.getFullYear(), normalizedStart.getMonth() + periodMonths, 0);

  return {
    paymentPolicy,
    periodMonths,
    periodStart: normalizedStart,
    periodEnd,
    paymentPeriodLabel: formatPaymentPeriodLabel(normalizedStart, periodEnd, paymentPolicy),
    monthlyEquivalent: parseFloat((totalDue / periodMonths).toFixed(2)),
    rent: parseFloat(rent.toFixed(2)),
    serviceCharge: parseFloat(serviceCharge.toFixed(2)),
    vat: parseFloat(vat.toFixed(2)),
    totalDue: parseFloat(totalDue.toFixed(2)),
    monthlyBreakdown
  };
}

// Helper: Infer period month span from invoice/payment policy data
function getInvoicePeriodMonths(invoice, tenantPaymentPolicy = 'MONTHLY') {
  if (invoice?.paymentPolicy) {
    return getPolicyMonths(invoice.paymentPolicy);
  }

  return getPolicyMonths(tenantPaymentPolicy);
}

// Utility: Parse & validate pagination params
function getPaginationParams(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Helper: Get or create tenant credit balance for overpayments
async function getTenantCreditBalance(tx, tenantId) {
  const creditBalance = await tx.paymentReport.findFirst({
    where: {
      tenantId,
      status: 'CREDIT'
    },
    orderBy: { createdAt: 'desc' }
  });

  if (creditBalance) {
    return parseFloat(creditBalance.amountPaid);
  }
  return 0;
}

// Helper: Update or create tenant credit balance
async function updateTenantCreditBalance(tx, tenantId, amount) {
  const existingCredit = await tx.paymentReport.findFirst({
    where: {
      tenantId,
      status: 'CREDIT'
    }
  });

  if (existingCredit) {
    return await tx.paymentReport.update({
      where: { id: existingCredit.id },
      data: {
        amountPaid: amount,
        updatedAt: new Date()
      }
    });
  } else {
    return await tx.paymentReport.create({
      data: {
        tenantId,
        amountPaid: amount,
        status: 'CREDIT',
        paymentPeriod: new Date(),
        datePaid: new Date(),
        rent: 0,
        serviceCharge: 0,
        vat: 0,
        totalDue: 0,
        arrears: 0,
        notes: 'Credit balance for overpayment'
      }
    });
  }
}

// Helper: Calculate how many billing periods are covered by overpayment
function calculateCoveredBillingPeriods(overpaymentAmount, billingPeriodTotal) {
  if (billingPeriodTotal <= 0) {
    return { periods: 0, remainder: 0 };
  }

  const periods = Math.floor(overpaymentAmount / billingPeriodTotal);
  const remainder = overpaymentAmount % billingPeriodTotal;

  return {
    periods,
    remainder: parseFloat(remainder.toFixed(2))
  };
}

// Helper: Generate and upload receipt PDF
async function generateAndUploadReceipt(paymentReport, tenant, invoices, overpaymentAmount = 0, creditUsed = 0) {
  try {
    // Get fresh invoices with their current state to ensure accuracy
    const freshInvoices = await prisma.invoice.findMany({
      where: { 
        id: { in: invoices.map(i => i.id) }
      }
    });

    // SOURCE OF TRUTH: Use paymentReport values
    const totalRent = paymentReport.rent;
    const totalServiceCharge = paymentReport.serviceCharge;
    const totalVat = paymentReport.vat;
    const totalDue = paymentReport.totalDue;
    const actualAmountReceived = paymentReport.amountPaid;
    
    // Get payment policy
    const paymentPolicy = freshInvoices[0]?.paymentPolicy || tenant.paymentPolicy || 'MONTHLY';
    const policyMonths = getPolicyMonths(paymentPolicy);
    
    // Calculate monthly equivalent based on total due
    const monthlyEquivalent = policyMonths > 0 && totalDue > 0 
      ? parseFloat((totalDue / policyMonths).toFixed(2)) 
      : totalDue;

    // Calculate monthly rent (base amount before multiplication)
    const monthlyRentAmount = tenant.rent;
    
    // Calculate monthly service charge and VAT
    let monthlyServiceCharge = 0;
    let monthlyVat = 0;
    
    if (totalServiceCharge > 0 && policyMonths > 0) {
      monthlyServiceCharge = parseFloat((totalServiceCharge / policyMonths).toFixed(2));
    }
    if (totalVat > 0 && policyMonths > 0) {
      monthlyVat = parseFloat((totalVat / policyMonths).toFixed(2));
    }

    // Build corrected invoice data for receipt display
    const invoicesForReceipt = freshInvoices.map(inv => {
      // CRITICAL FIX: Calculate the monthly amount for this invoice
      // For a QUARTERLY invoice: totalDue = monthlyRent × 3
      // Monthly amount = totalDue ÷ policyMonths
      const monthlyAmount = policyMonths > 0 
        ? parseFloat((inv.totalDue / policyMonths).toFixed(2))
        : inv.totalDue;
      
      //  CRITICAL FIX: Use the invoice's total amount paid, not just this payment
      // This gives us the COMPLETE picture of what's been paid for this invoice
      const totalAmountPaidForInvoice = inv.amountPaid;
      const totalInvoiceBalance = inv.balance;
      const invoiceTotalDue = inv.totalDue;
      
      // Calculate the remaining balance on a monthly basis
      const monthlyBalance = Math.max(0, invoiceTotalDue - totalAmountPaidForInvoice);
      
      //  CRITICAL FIX: Determine status based on TOTAL amount paid vs TOTAL invoice amount
      // This correctly shows PAID if the invoice is fully paid (including previous payments)
      let displayStatus = 'UNPAID';
      if (totalAmountPaidForInvoice >= invoiceTotalDue) {
        displayStatus = 'PAID';
      } else if (totalAmountPaidForInvoice > 0) {
        displayStatus = 'PARTIAL';
      }
      
      //  CRITICAL FIX: Calculate the amount paid in this specific transaction for display
      // This is the incremental amount added to the invoice in this payment
      const paymentAppliedInThisTransaction = Math.min(
        paymentReport.amountPaid,
        invoiceTotalDue - (inv.amountPaid - paymentReport.amountPaid) // This is tricky, let's use a simpler approach
      );
      
      // Simpler: Calculate how much of THIS payment went to this invoice
      // Since we're allocating payments proportionally or FIFO, we need to track it
      // For now, use a reasonable approach: if invoice is now paid and was previously unpaid,
      // the full payment applied is the invoice total
      const wasPreviouslyUnpaid = inv.amountPaid === 0;
      const paymentApplied = wasPreviouslyUnpaid 
        ? Math.min(inv.totalDue, actualAmountReceived)
        : actualAmountReceived;
      
      return {
        invoiceNumber: inv.invoiceNumber,
        paymentPeriod: inv.paymentPeriod,
        // For display: Show the MONTHLY amount
        previousBalance: monthlyAmount,
        paymentApplied: totalAmountPaidForInvoice > 0 ? totalAmountPaidForInvoice : actualAmountReceived,
        newAmountPaid: totalAmountPaidForInvoice,
        newBalance: monthlyBalance,
        newStatus: displayStatus,
        previousStatus: inv.status,
        paymentPolicy: inv.paymentPolicy || paymentPolicy,
        monthlyAmount: monthlyAmount,
        fullInvoiceAmount: invoiceTotalDue,
        policyMonths: policyMonths,
        totalPaidForInvoice: totalAmountPaidForInvoice, // New field for total paid
        // Individual invoice breakdown (monthly basis)
        rent: monthlyRentAmount,
        serviceCharge: monthlyServiceCharge,
        vat: monthlyVat
      };
    });

    // Determine payment period label (should be a single month)
    let paymentPeriodLabel = freshInvoices[0]?.paymentPeriod;
    if (!paymentPeriodLabel && paymentReport.paymentPeriod) {
      paymentPeriodLabel = new Date(paymentReport.paymentPeriod).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });
    }

    // Generate receipt number
    const receiptNumber = `RCP-${Date.now()}-${paymentReport.id.slice(-6).toUpperCase()}`;

    // Prepare complete receipt data with corrected monthly amounts
    const receiptData = {
      receiptNumber,
      paymentDate: paymentReport.datePaid,
      tenantName: tenant.fullName,
      tenantContact: tenant.contact,
      propertyName: tenant.unit?.property?.name || 'N/A',
      unitType: tenant.unit?.type || 'Unit',
      unitNo: tenant.unit?.unitNo || '',
      paymentPeriod: paymentPeriodLabel,
      paymentPolicy: paymentPolicy,
      monthlyEquivalent: monthlyEquivalent,
      billedRent: parseFloat(monthlyRentAmount.toFixed(2)),
      billedServiceCharge: parseFloat(monthlyServiceCharge.toFixed(2)),
      billedVat: parseFloat(monthlyVat.toFixed(2)),
      billedTotalDue: parseFloat(monthlyEquivalent.toFixed(2)),
      amountPaid: parseFloat(actualAmountReceived.toFixed(2)),
      invoicesPaid: invoicesForReceipt,
      overpaymentAmount: parseFloat((overpaymentAmount || 0).toFixed(2)),
      creditUsed: parseFloat((creditUsed || 0).toFixed(2)),
      totalAllocated: parseFloat(actualAmountReceived.toFixed(2)),
      paymentReportId: paymentReport.id,
      notes: paymentReport.notes,
      paymentMethod: 'Bank Transfer'
    };

    // Debug log to verify the calculation
    console.log('Receipt generation - Invoice status calculation:', {
      invoiceStatuses: invoicesForReceipt.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        totalDue: inv.fullInvoiceAmount,
        totalPaidForInvoice: inv.totalPaidForInvoice,
        displayStatus: inv.newStatus,
        monthlyBalance: inv.newBalance
      }))
    });

    // Generate receipt
    const receiptHTML = generateReceiptHTML(receiptData);
    const pdfBuffer = await generatePDF(receiptHTML);

    // Upload to storage
    const receiptFileName = `${receiptNumber}.pdf`;
    const receiptUrl = await uploadToStorage(pdfBuffer, receiptFileName, 'receipts');
    
    return {
      receiptUrl,
      receiptNumber: receiptData.receiptNumber,
      pdfBuffer
    };
  } catch (error) {
    console.error('Error generating receipt:', error);
    return {
      receiptUrl: null,
      receiptNumber: null,
      pdfBuffer: null,
      error: error.message
    };
  }
}
// Helper function to update existing invoices when payment is made
async function updateExistingInvoicesForPayment(tx, tenantId, paymentPeriodStr, parsedAmountPaid, paymentReportId, periodStartDate, paymentStatus) {
  try {
    const existingInvoices = await tx.invoice.findMany({
      where: {
        tenantId,
        paymentPeriod: paymentPeriodStr,
        status: {
          in: ['UNPAID', 'PARTIAL', 'OVERDUE']
        },
        paymentReportId: null
      },
      orderBy: {
        dueDate: 'asc'
      }
    });

    if (existingInvoices.length === 0) {
      return {
        updatedInvoices: [],
        remainingPayment: parsedAmountPaid,
        totalApplied: 0
      };
    }

    let remainingPayment = parsedAmountPaid;
    const updatedInvoices = [];

    for (const invoice of existingInvoices) {
      if (remainingPayment <= 0) break;

      if (invoice.paymentPeriod === paymentPeriodStr) {
        if (invoice.balance > 0) {
          const paymentToApply = Math.min(invoice.balance, remainingPayment);
          const newAmountPaid = invoice.amountPaid + paymentToApply;
          const newBalance = invoice.balance - paymentToApply;
          
          let newStatus = invoice.status;
          if (newBalance <= 0) {
            newStatus = 'PAID';
          } else if (paymentToApply > 0 && invoice.status === 'UNPAID') {
            newStatus = 'PARTIAL';
          }

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              amountPaid: newAmountPaid,
              balance: newBalance,
              status: newStatus,
              paymentReportId: paymentReportId,
              updatedAt: new Date()
            }
          });

          remainingPayment -= paymentToApply;
          updatedInvoices.push({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            previousBalance: invoice.balance,
            previousAmountPaid: invoice.amountPaid,
            paymentApplied: paymentToApply,
            newAmountPaid,
            newBalance,
            newStatus,
            previousStatus: invoice.status,
            paymentPolicy: invoice.paymentPolicy,
            wasAutoPaid: true
          });
        }
      }
    }

    if (paymentStatus === 'PAID' && updatedInvoices.length > 0 && remainingPayment > 0) {
      const remainingUnpaidInvoices = await tx.invoice.findMany({
        where: {
          tenantId,
          paymentPeriod: paymentPeriodStr,
          status: {
            in: ['UNPAID', 'PARTIAL', 'OVERDUE']
          },
          id: {
            notIn: updatedInvoices.map(i => i.id)
          },
          paymentReportId: null
        }
      });

      for (const invoice of remainingUnpaidInvoices) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: invoice.totalDue,
            balance: 0,
            status: 'PAID',
            paymentReportId: paymentReportId,
            updatedAt: new Date()
          }
        });

        updatedInvoices.push({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          previousBalance: invoice.balance,
          previousAmountPaid: invoice.amountPaid,
          paymentApplied: invoice.balance,
          newAmountPaid: invoice.totalDue,
          newBalance: 0,
          newStatus: 'PAID',
          previousStatus: invoice.status,
          paymentPolicy: invoice.paymentPolicy,
          wasAutoPaid: true
        });
      }
    }

    return {
      updatedInvoices,
      remainingPayment,
      totalApplied: parsedAmountPaid - remainingPayment
    };
  } catch (error) {
    console.error('Error in updateExistingInvoicesForPayment:', error);
    throw error;
  }
}

// ======================================================
// PERMISSION MIDDLEWARE HELPERS
// ======================================================

// Helper to check if user can access a payment report based on property
async function canAccessPaymentReport(userId, userRole, paymentReportId) {
  if (userRole === 'ADMIN') return true;
  
  const paymentReport = await prisma.paymentReport.findUnique({
    where: { id: paymentReportId },
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
  
  if (!paymentReport) return false;
  
  const propertyId = paymentReport.tenant?.unit?.propertyId;
  
  if (!propertyId) return false;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  return permissionService.checkPropertyAccess(userId, propertyId, 'canView');
}

// Helper to check if user can manage payments for a property
async function canManagePaymentForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  return permissionService.checkPermission(userId, 'paymentReport', 'create', propertyId);
}

// Helper to check if user can view payments for a property
async function canViewPaymentsForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  return permissionService.checkPermission(userId, 'paymentReport', 'view', propertyId);
}

// ======================================================
// PAYMENT REPORT CRUD OPERATIONS WITH PERMISSIONS
// ======================================================

// @desc    Get all payment reports (with pagination & filtering)
// @route   GET /api/payments
// @access  Private (ADMIN, MANAGER, USER with VIEW_PAYMENT_REPORTS)
export const getPaymentReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { 
      status, 
      propertyId, 
      dateFrom, 
      dateTo,
      page = 1,
      limit = 10 
    } = req.query;

    const { skip, limit: take } = getPaginationParams(req.query);

    // Check permission
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      const hasPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_PAYMENT_REPORTS'
      );
      if (!hasPermission) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view payment reports' 
        });
      }
    }

    // Build dynamic WHERE clause
    const where = {};

    if (status && ['PAID', 'PARTIAL', 'UNPAID'].includes(status)) {
      where.status = status;
    }

    if (propertyId) {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view payments for this property' 
        });
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

    if (dateFrom || dateTo) {
      where.paymentPeriod = {};
      if (dateFrom) where.paymentPeriod.gte = new Date(dateFrom);
      if (dateTo) where.paymentPeriod.lte = new Date(dateTo);
    }

    const total = await prisma.paymentReport.count({ where });

    const payments = await prisma.paymentReport.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            vatType: true,
            vatRate: true,
            escalationRate: true,
            escalationFrequency: true,
            unit: {
              include: {
                property: {
                  select: { id: true, name: true, address: true }
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
            status: true,
            issueDate: true,
            dueDate: true
          }
        }
      },
      orderBy: { paymentPeriod: 'desc' },
      skip,
      take: parseInt(take)
    });

    res.json({
      success: true,
      data: payments,
      meta: {
        page: parseInt(page),
        limit: parseInt(take),
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Error fetching payment reports:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get payments by tenant
// @route   GET /api/payments/tenant/:tenantId
// @access  Private
export const getPaymentsByTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const { skip, limit: take } = getPaginationParams(req.query);

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
    
    if (userRole !== 'ADMIN') {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view payments for this tenant' 
        });
      }
    }

    const total = await prisma.paymentReport.count({
      where: { tenantId }
    });

    const payments = await prisma.paymentReport.findMany({
      where: { tenantId },
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            vatType: true,
            vatRate: true,
            escalationRate: true,
            escalationFrequency: true,
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
            status: true,
            issueDate: true,
            dueDate: true
          }
        }
      },
      orderBy: { paymentPeriod: 'desc' },
      skip,
      take: parseInt(take)
    });

    res.json({
      success: true,
      data: payments,
      meta: {
        page: parseInt(page),
        limit: parseInt(take),
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Error fetching tenant payments:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get payment report for a whole property (Rent only)
// @route   GET /api/payments/property/:propertyId/rent-report
// @access  Private
export const getPropertyRentPaymentReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;
    const { 
      dateFrom, 
      dateTo,
      status,
      page = 1,
      limit = 50
    } = req.query;

    const { skip, limit: take } = getPaginationParams({ page, limit });

    const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
    if (!canView) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to view payments for this property' 
      });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, address: true, managerId: true }
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    const where = {
      tenant: {
        unit: {
          propertyId: propertyId
        }
      }
    };

    if (status && ['PAID', 'PARTIAL', 'UNPAID', 'PREPAID', 'CREDIT'].includes(status)) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.paymentPeriod = {};
      if (dateFrom) where.paymentPeriod.gte = new Date(dateFrom);
      if (dateTo) where.paymentPeriod.lte = new Date(dateTo);
    }

    const tenants = await prisma.tenant.findMany({
      where: {
        unit: {
          propertyId: propertyId
        }
      },
      include: {
        unit: {
          select: {
            id: true,
            type: true,
            unitNo: true,
            floor: true,
            sizeSqFt: true
          }
        },
        paymentReports: {
          where: {
            status: { notIn: ['CREDIT', 'PREPAID'] }
          },
          select: {
            amountPaid: true,
            totalDue: true,
            arrears: true,
            status: true,
            paymentPeriod: true
          }
        }
      }
    });

    const total = await prisma.paymentReport.count({ where });

    const paymentReports = await prisma.paymentReport.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            email: true,
            vatType: true,
            paymentPolicy: true,
            rent: true,
            unit: {
              select: {
                id: true,
                type: true,
                unitNo: true,
                floor: true,
                sizeSqFt: true
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
            dueDate: true
          }
        }
      },
      orderBy: { paymentPeriod: 'desc' },
      skip,
      take: parseInt(take)
    });

    let totalRentCollected = 0;
    let totalRentExpected = 0;
    let totalArrears = 0;
    let totalOverdueCount = 0;
    let fullyPaidCount = 0;
    let partialPaidCount = 0;
    let unpaidCount = 0;

    for (const tenant of tenants) {
      const tenantReports = tenant.paymentReports;
      
      const tenantPaid = tenantReports.reduce((sum, report) => sum + report.amountPaid, 0);
      const tenantExpected = tenantReports.reduce((sum, report) => sum + report.totalDue, 0);
      const tenantArrears = tenantReports.reduce((sum, report) => sum + report.arrears, 0);
      
      totalRentCollected += tenantPaid;
      totalRentExpected += tenantExpected;
      totalArrears += tenantArrears;
      
      const latestReport = tenantReports[0];
      if (latestReport) {
        if (latestReport.status === 'PAID') fullyPaidCount++;
        else if (latestReport.status === 'PARTIAL') partialPaidCount++;
        else if (latestReport.status === 'UNPAID') unpaidCount++;
      }
      
      const hasOverdue = tenantReports.some(report => 
        report.status === 'UNPAID' && new Date(report.paymentPeriod) < new Date()
      );
      if (hasOverdue) totalOverdueCount++;
    }

    const collectionRate = totalRentExpected > 0 
      ? (totalRentCollected / totalRentExpected) * 100 
      : 0;

    const monthlyTrends = {};
    paymentReports.forEach(report => {
      const monthKey = new Date(report.paymentPeriod).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short' 
      });
      
      if (!monthlyTrends[monthKey]) {
        monthlyTrends[monthKey] = {
          month: monthKey,
          expected: 0,
          collected: 0,
          arrears: 0,
          reportCount: 0
        };
      }
      
      monthlyTrends[monthKey].expected += report.totalDue;
      monthlyTrends[monthKey].collected += report.amountPaid;
      monthlyTrends[monthKey].arrears += report.arrears;
      monthlyTrends[monthKey].reportCount++;
    });

    const tenantOutstanding = tenants.map(tenant => {
      const totalDue = tenant.paymentReports.reduce((sum, r) => sum + r.totalDue, 0);
      const totalPaid = tenant.paymentReports.reduce((sum, r) => sum + r.amountPaid, 0);
      const tenantArrears = tenant.paymentReports.reduce((sum, r) => sum + r.arrears, 0);
      
      return {
        tenantId: tenant.id,
        tenantName: tenant.fullName,
        unitNo: tenant.unit?.unitNo || 'N/A',
        unitType: tenant.unit?.type || 'N/A',
        expectedTotal: totalDue,
        paidTotal: totalPaid,
        outstandingBalance: totalDue - totalPaid,
        arrears: tenantArrears,
        lastPaymentDate: tenant.paymentReports[0]?.paymentPeriod || null,
        paymentStatus: tenant.paymentReports[0]?.status || 'UNPAID'
      };
    }).filter(t => t.outstandingBalance > 0 || t.arrears > 0);

    res.json({
      success: true,
      data: {
        property: {
          id: property.id,
          name: property.name,
          address: property.address
        },
        summary: {
          totalTenants: tenants.length,
          totalRentCollected,
          totalRentExpected,
          totalArrears,
          collectionRate: parseFloat(collectionRate.toFixed(2)),
          collectionRateStatus: collectionRate >= 90 ? 'EXCELLENT' : collectionRate >= 75 ? 'GOOD' : collectionRate >= 50 ? 'AVERAGE' : 'POOR',
          paymentBreakdown: {
            fullyPaid: fullyPaidCount,
            partiallyPaid: partialPaidCount,
            unpaid: unpaidCount,
            overdue: totalOverdueCount
          }
        },
        monthlyTrends: Object.values(monthlyTrends),
        tenantOutstanding,
        paymentReports: paymentReports.map(report => ({
          id: report.id,
          tenantName: report.tenant.fullName,
          unitNo: report.tenant.unit?.unitNo || 'N/A',
          paymentPeriod: report.paymentPeriod,
          expectedAmount: report.totalDue,
          amountPaid: report.amountPaid,
          arrears: report.arrears,
          status: report.status,
          invoiceCount: report.invoices.length,
          datePaid: report.datePaid
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(take),
          total,
          totalPages: Math.ceil(total / take)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching property rent payment report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate property rent payment report',
      error: error.message
    });
  }
};

// @desc    Get payment report for a whole property (Bills - Water & Electricity)
// @route   GET /api/payments/property/:propertyId/bills-report
// @access  Private
export const getPropertyBillsPaymentReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;
    const { 
      dateFrom, 
      dateTo,
      billType,
      status,
      page = 1,
      limit = 50
    } = req.query;

    const { skip, limit: take } = getPaginationParams({ page, limit });

    const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
    if (!canView) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to view bills for this property' 
      });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, address: true }
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    const where = {
      tenant: {
        unit: {
          propertyId: propertyId
        }
      }
    };

    if (billType && ['WATER', 'ELECTRICITY'].includes(billType.toUpperCase())) {
      where.billType = billType.toUpperCase();
    }

    if (status && ['PAID', 'PARTIAL', 'UNPAID', 'OVERDUE', 'CANCELLED'].includes(status)) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const tenants = await prisma.tenant.findMany({
      where: {
        unit: {
          propertyId: propertyId
        }
      },
      include: {
        unit: {
          select: {
            id: true,
            type: true,
            unitNo: true,
            floor: true,
            sizeSqFt: true
          }
        },
        billInvoices: {
          where: {
            ...(billType ? { billType: billType.toUpperCase() } : {}),
            ...(status ? { status } : {}),
            ...(dateFrom || dateTo ? {
              issueDate: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {})
              }
            } : {})
          },
          orderBy: { issueDate: 'desc' }
        }
      }
    });

    const total = await prisma.billInvoice.count({ where });

    const billInvoices = await prisma.billInvoice.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            email: true,
            unit: {
              select: {
                id: true,
                type: true,
                unitNo: true,
                floor: true
              }
            }
          }
        }
      },
      orderBy: { issueDate: 'desc' },
      skip,
      take: parseInt(take)
    });

    let totalWaterBills = 0;
    let totalWaterCollected = 0;
    let totalWaterArrears = 0;
    let totalElectricityBills = 0;
    let totalElectricityCollected = 0;
    let totalElectricityArrears = 0;
    let totalBillsExpected = 0;
    let totalBillsCollected = 0;
    let totalBillsArrears = 0;
    let paidBillsCount = 0;
    let partialBillsCount = 0;
    let unpaidBillsCount = 0;
    let overdueBillsCount = 0;

    for (const tenant of tenants) {
      for (const invoice of tenant.billInvoices) {
        const grandTotal = invoice.grandTotal || invoice.totalAmount || 0;
        const amountPaid = invoice.amountPaid || 0;
        const balance = invoice.balance || (grandTotal - amountPaid);
        
        if (invoice.billType === 'WATER') {
          totalWaterBills += grandTotal;
          totalWaterCollected += amountPaid;
          totalWaterArrears += balance;
        } else if (invoice.billType === 'ELECTRICITY') {
          totalElectricityBills += grandTotal;
          totalElectricityCollected += amountPaid;
          totalElectricityArrears += balance;
        }
        
        totalBillsExpected += grandTotal;
        totalBillsCollected += amountPaid;
        totalBillsArrears += balance;
        
        if (invoice.status === 'PAID') paidBillsCount++;
        else if (invoice.status === 'PARTIAL') partialBillsCount++;
        else if (invoice.status === 'UNPAID') unpaidBillsCount++;
        else if (invoice.status === 'OVERDUE') overdueBillsCount++;
      }
    }

    const waterCollectionRate = totalWaterBills > 0 ? (totalWaterCollected / totalWaterBills) * 100 : 0;
    const electricityCollectionRate = totalElectricityBills > 0 ? (totalElectricityCollected / totalElectricityBills) * 100 : 0;
    const overallCollectionRate = totalBillsExpected > 0 ? (totalBillsCollected / totalBillsExpected) * 100 : 0;

    const monthlyTrends = {};
    billInvoices.forEach(invoice => {
      const monthKey = new Date(invoice.issueDate).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short' 
      });
      const billType = invoice.billType;
      
      if (!monthlyTrends[monthKey]) {
        monthlyTrends[monthKey] = {
          month: monthKey,
          water: { expected: 0, collected: 0, arrears: 0 },
          electricity: { expected: 0, collected: 0, arrears: 0 },
          total: { expected: 0, collected: 0, arrears: 0 }
        };
      }
      
      const grandTotal = invoice.grandTotal || invoice.totalAmount || 0;
      const amountPaid = invoice.amountPaid || 0;
      const balance = invoice.balance || (grandTotal - amountPaid);
      
      if (billType === 'WATER') {
        monthlyTrends[monthKey].water.expected += grandTotal;
        monthlyTrends[monthKey].water.collected += amountPaid;
        monthlyTrends[monthKey].water.arrears += balance;
      } else if (billType === 'ELECTRICITY') {
        monthlyTrends[monthKey].electricity.expected += grandTotal;
        monthlyTrends[monthKey].electricity.collected += amountPaid;
        monthlyTrends[monthKey].electricity.arrears += balance;
      }
      
      monthlyTrends[monthKey].total.expected += grandTotal;
      monthlyTrends[monthKey].total.collected += amountPaid;
      monthlyTrends[monthKey].total.arrears += balance;
    });

    const tenantBillSummary = tenants.map(tenant => {
      let waterTotal = 0, waterPaid = 0, waterBalance = 0;
      let electricityTotal = 0, electricityPaid = 0, electricityBalance = 0;
      
      tenant.billInvoices.forEach(invoice => {
        const grandTotal = invoice.grandTotal || invoice.totalAmount || 0;
        const amountPaid = invoice.amountPaid || 0;
        const balance = invoice.balance || (grandTotal - amountPaid);
        
        if (invoice.billType === 'WATER') {
          waterTotal += grandTotal;
          waterPaid += amountPaid;
          waterBalance += balance;
        } else if (invoice.billType === 'ELECTRICITY') {
          electricityTotal += grandTotal;
          electricityPaid += amountPaid;
          electricityBalance += balance;
        }
      });
      
      return {
        tenantId: tenant.id,
        tenantName: tenant.fullName,
        unitNo: tenant.unit?.unitNo || 'N/A',
        unitType: tenant.unit?.type || 'N/A',
        water: {
          total: waterTotal,
          paid: waterPaid,
          outstanding: waterBalance,
          status: waterBalance === 0 ? 'PAID' : waterPaid > 0 ? 'PARTIAL' : 'UNPAID'
        },
        electricity: {
          total: electricityTotal,
          paid: electricityPaid,
          outstanding: electricityBalance,
          status: electricityBalance === 0 ? 'PAID' : electricityPaid > 0 ? 'PARTIAL' : 'UNPAID'
        },
        totalOutstanding: waterBalance + electricityBalance
      };
    }).filter(t => t.totalOutstanding > 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const delinquentBills = billInvoices.filter(invoice => 
      invoice.status === 'OVERDUE' || 
      (invoice.status === 'UNPAID' && new Date(invoice.dueDate) < thirtyDaysAgo)
    );

    res.json({
      success: true,
      data: {
        property: {
          id: property.id,
          name: property.name,
          address: property.address
        },
        summary: {
          totalTenants: tenants.length,
          totalBillInvoices: billInvoices.length,
          water: {
            totalBilled: totalWaterBills,
            totalCollected: totalWaterCollected,
            totalArrears: totalWaterArrears,
            collectionRate: parseFloat(waterCollectionRate.toFixed(2)),
            status: waterCollectionRate >= 90 ? 'EXCELLENT' : waterCollectionRate >= 75 ? 'GOOD' : waterCollectionRate >= 50 ? 'AVERAGE' : 'POOR'
          },
          electricity: {
            totalBilled: totalElectricityBills,
            totalCollected: totalElectricityCollected,
            totalArrears: totalElectricityArrears,
            collectionRate: parseFloat(electricityCollectionRate.toFixed(2)),
            status: electricityCollectionRate >= 90 ? 'EXCELLENT' : electricityCollectionRate >= 75 ? 'GOOD' : electricityCollectionRate >= 50 ? 'AVERAGE' : 'POOR'
          },
          overall: {
            totalBilled: totalBillsExpected,
            totalCollected: totalBillsCollected,
            totalArrears: totalBillsArrears,
            collectionRate: parseFloat(overallCollectionRate.toFixed(2)),
            delinquentBillsCount: delinquentBills.length,
            paymentBreakdown: {
              paid: paidBillsCount,
              partial: partialBillsCount,
              unpaid: unpaidBillsCount,
              overdue: overdueBillsCount
            }
          }
        },
        monthlyTrends: Object.values(monthlyTrends),
        tenantOutstanding: tenantBillSummary,
        delinquentBills: delinquentBills.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          tenantName: invoice.tenant.fullName,
          unitNo: invoice.tenant.unit?.unitNo || 'N/A',
          billType: invoice.billType,
          amount: invoice.grandTotal || invoice.totalAmount,
          amountPaid: invoice.amountPaid || 0,
          balance: invoice.balance || ((invoice.grandTotal || invoice.totalAmount) - (invoice.amountPaid || 0)),
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          daysOverdue: Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24)),
          status: invoice.status
        })),
        billInvoices: billInvoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          tenantName: invoice.tenant.fullName,
          unitNo: invoice.tenant.unit?.unitNo || 'N/A',
          billType: invoice.billType,
          billReferenceNumber: invoice.billReferenceNumber,
          billReferenceDate: invoice.billReferenceDate,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          totalAmount: invoice.grandTotal || invoice.totalAmount,
          amountPaid: invoice.amountPaid || 0,
          balance: invoice.balance || ((invoice.grandTotal || invoice.totalAmount) - (invoice.amountPaid || 0)),
          status: invoice.status,
          unitsConsumed: invoice.units,
          chargePerUnit: invoice.chargePerUnit,
          previousReading: invoice.previousReading,
          currentReading: invoice.currentReading,
          vatRate: invoice.vatRate,
          vatAmount: invoice.vatAmount
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(take),
          total,
          totalPages: Math.ceil(total / take)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching property bills payment report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate property bills payment report',
      error: error.message
    });
  }
};

// @desc    Get outstanding invoices for a tenant
// @route   GET /api/payments/outstanding/:tenantId
// @access  Private
export const getOutstandingInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;

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
    
    if (userRole !== 'ADMIN') {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view outstanding invoices for this tenant' 
        });
      }
    }

    const hasPreviewPermission = userRole === 'ADMIN' || 
      await permissionService.hasPermission(userId, 'PREVIEW_PAYMENTS');

    const rentInvoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        status: {
          in: ['UNPAID', 'PARTIAL', 'OVERDUE']
        }
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        paymentPeriod: true,
        paymentPolicy: true,
        rent: hasPreviewPermission,
        serviceCharge: hasPreviewPermission,
        vat: hasPreviewPermission,
        totalDue: true,
        amountPaid: true,
        balance: true,
        status: true,
        pdfUrl: true
      }
    });

    const totalRentBalance = rentInvoices.reduce((sum, inv) => sum + inv.balance, 0);

    res.json({
      success: true,
      data: {
        rentInvoices,
        totals: {
          totalRentBalance,
          totalOutstanding: totalRentBalance,
          invoiceCount: rentInvoices.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching outstanding invoices:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch outstanding invoices' 
    });
  }
};

// @desc    Create payment report (Invoice-based, RENT ONLY)
// @route   POST /api/payments
// @access  Private (ADMIN, MANAGER, or USER with RECORD_PAYMENTS permission)
export const createPaymentReport = async (req, res) => {
  let transactionResult = null;
  
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { 
      tenantId, 
      amountPaid,
      invoiceIds = [],
      notes,
      paymentPeriod,
      createMissingInvoices = false,
      updateExistingInvoices = true,
      handleOverpayment = true
    } = req.body;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        message: 'tenantId is required' 
      });
    }

    if (amountPaid == null || isNaN(amountPaid) || parseFloat(amountPaid) < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid non-negative amountPaid is required' 
      });
    }

    const parsedAmountPaid = parseFloat(amountPaid);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: {
              select: { 
                id: true, 
                name: true, 
                managerId: true,
                commissionFee: true 
              }
            }
          }
        },
        serviceCharge: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tenant not found' 
      });
    }

    const propertyId = tenant.unit?.propertyId;

    if (userRole !== 'ADMIN') {
      const canRecordPayment = await canManagePaymentForProperty(userId, userRole, propertyId);
      if (!canRecordPayment) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to record payments for this property' 
        });
      }
      
      const hasRecordPermission = await permissionService.hasPermission(
        userId, 
        'RECORD_PAYMENTS', 
        propertyId
      );
      
      if (!hasRecordPermission && userRole !== 'MANAGER') {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to record payments' 
        });
      }
    }

    let paymentPeriodDate = null;
    if (paymentPeriod) {
      paymentPeriodDate = new Date(paymentPeriod);
      if (isNaN(paymentPeriodDate.getTime())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid paymentPeriod date format' 
        });
      }
    }

    let existingCredit = 0;
    if (handleOverpayment) {
      existingCredit = await getTenantCreditBalance(prisma, tenantId);
      if (existingCredit > 0) {
        console.log(`Found existing credit balance for tenant: ${existingCredit}`);
      }
    }

    let invoicesToProcess = [];
    let totalInvoiceBalance = 0;
    let paymentPolicy = tenant.paymentPolicy;
    let paymentPeriodStr = paymentPeriodDate ? 
      paymentPeriodDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 
      new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    if (invoiceIds && invoiceIds.length > 0) {
      invoicesToProcess = await prisma.invoice.findMany({
        where: {
          id: { in: invoiceIds },
          tenantId: tenantId,
          status: {
            in: ['UNPAID', 'PARTIAL', 'OVERDUE']
          }
        },
        orderBy: { dueDate: 'asc' }
      });

      if (invoicesToProcess.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No unpaid/partial invoices found for the provided IDs'
        });
      }

      totalInvoiceBalance = invoicesToProcess.reduce((sum, inv) => sum + inv.balance, 0);
      paymentPolicy = invoicesToProcess[0].paymentPolicy || tenant.paymentPolicy;
      paymentPeriodStr = invoicesToProcess[0].paymentPeriod || paymentPeriodStr;
      
      console.log(`Processing ${invoicesToProcess.length} selected invoices with total balance: ${totalInvoiceBalance}`);
    } else {
      invoicesToProcess = await prisma.invoice.findMany({
        where: {
          tenantId: tenantId,
          status: {
            in: ['UNPAID', 'PARTIAL', 'OVERDUE']
          }
        },
        orderBy: { dueDate: 'asc' }
      });

      totalInvoiceBalance = invoicesToProcess.reduce((sum, inv) => sum + inv.balance, 0);
      
      if (invoicesToProcess.length === 0) {
        if (createMissingInvoices) {
          const expected = await computeExpectedChargesForPolicy(
            tenantId,
            paymentPeriodDate,
            tenant.paymentPolicy || 'MONTHLY'
          );
          
          const invoiceNumber = await generateInvoiceNumber();
          const newInvoice = await prisma.invoice.create({
            data: {
              invoiceNumber,
              tenantId,
              issueDate: new Date(),
              dueDate: expected.periodEnd,
              paymentPeriod: expected.paymentPeriodLabel,
              rent: expected.rent,
              serviceCharge: expected.serviceCharge,
              vat: expected.vat,
              totalDue: expected.totalDue,
              amountPaid: 0,
              balance: expected.totalDue,
              status: 'UNPAID',
              paymentPolicy: tenant.paymentPolicy || 'MONTHLY',
              notes: `Auto-generated ${(tenant.paymentPolicy || 'MONTHLY')} invoice for payment recording. Monthly equivalent: Ksh ${expected.monthlyEquivalent.toFixed(2)}`
            }
          });
          
          invoicesToProcess = [newInvoice];
          totalInvoiceBalance = expected.totalDue;
          paymentPeriodStr = newInvoice.paymentPeriod;
          console.log(`Created new ${tenant.paymentPolicy || 'MONTHLY'} invoice for payment: ${newInvoice.invoiceNumber}`);
        } else {
          return res.status(400).json({
            success: false,
            message: 'No invoices found for this tenant. Either create an invoice first, set createMissingInvoices to true, or provide specific invoiceIds.',
            data: {
              tenantId,
              createMissingInvoices,
              invoiceIdsProvided: invoiceIds.length
            }
          });
        }
      } else {
        paymentPolicy = invoicesToProcess[0].paymentPolicy || tenant.paymentPolicy;
        paymentPeriodStr = invoicesToProcess[0].paymentPeriod || paymentPeriodStr;
        console.log(`Using FIFO: Processing ${invoicesToProcess.length} oldest invoices with total balance: ${totalInvoiceBalance}`);
      }
    }

    const totalAvailable = parsedAmountPaid + existingCredit;
    
    let overpaymentAmount = 0;
    let commissionBaseAmount = 0;
    let actualPaymentForCurrentPeriod = parsedAmountPaid;

    if (totalAvailable > totalInvoiceBalance) {
      overpaymentAmount = totalAvailable - totalInvoiceBalance;
      commissionBaseAmount = Math.min(totalInvoiceBalance, parsedAmountPaid);
      actualPaymentForCurrentPeriod = Math.max(0, totalInvoiceBalance - existingCredit);
      
      console.log(`Overpayment detected: ${overpaymentAmount}`);
      console.log(`Commission base amount: ${commissionBaseAmount}`);
    } else {
      commissionBaseAmount = parsedAmountPaid;
    }

    if (!handleOverpayment && totalAvailable > totalInvoiceBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (${parsedAmountPaid}) plus existing credit (${existingCredit}) exceeds total invoice balance (${totalInvoiceBalance}). Enable handleOverpayment to accept overpayments.`,
        data: {
          totalInvoiceBalance,
          paymentAmount: parsedAmountPaid,
          existingCredit,
          totalAvailable,
          difference: totalAvailable - totalInvoiceBalance
        }
      });
    }

    let frequency = 'MONTHLY';
    switch (paymentPolicy) {
      case 'QUARTERLY':
        frequency = 'QUARTERLY';
        break;
      case 'ANNUAL':
        frequency = 'ANNUAL';
        break;
      case 'MONTHLY':
      default:
        frequency = 'MONTHLY';
    }

    transactionResult = await prisma.$transaction(async (tx) => {
      let creditUsed = 0;
      if (existingCredit > 0) {
        creditUsed = Math.min(existingCredit, totalInvoiceBalance);
        const remainingCredit = existingCredit - creditUsed;
        await updateTenantCreditBalance(tx, tenantId, Math.max(0, remainingCredit));
        console.log(`Applied ${creditUsed} from existing credit, remaining: ${Math.max(0, remainingCredit)}`);
      }

      const paymentNotes = [];
      if (notes) paymentNotes.push(notes);
      if (creditUsed > 0) paymentNotes.push(`Applied Ksh ${creditUsed.toFixed(2)} from credit balance`);
      if (overpaymentAmount > 0) paymentNotes.push(`Overpayment: Ksh ${overpaymentAmount.toFixed(2)}`);

      const report = await tx.paymentReport.create({
        data: {
          tenantId,
          rent: invoicesToProcess.reduce((sum, inv) => sum + inv.rent, 0),
          serviceCharge: invoicesToProcess.reduce((sum, inv) => sum + (inv.serviceCharge || 0), 0),
          vat: invoicesToProcess.reduce((sum, inv) => sum + (inv.vat || 0), 0),
          totalDue: invoicesToProcess.reduce((sum, inv) => sum + inv.totalDue, 0),
          amountPaid: totalAvailable,
          arrears: Math.max(0, totalInvoiceBalance - totalAvailable),
          status: totalAvailable >= totalInvoiceBalance ? 'PAID' : 
                  totalAvailable > 0 ? 'PARTIAL' : 'UNPAID',
          paymentPeriod: paymentPeriodDate || new Date(),
          datePaid: new Date(),
          notes: paymentNotes.join('. ') || null,
          receiptUrl: null
        }
      });

      let invoiceUpdateResult = null;
      let remainingPayment = totalAvailable;
      const updatedInvoices = [];

      if (updateExistingInvoices && invoiceIds.length === 0 && totalAvailable > 0) {
        invoiceUpdateResult = await updateExistingInvoicesForPayment(
          tx,
          tenantId,
          paymentPeriodStr,
          totalAvailable,
          report.id,
          paymentPeriodDate || new Date(),
          totalAvailable >= totalInvoiceBalance ? 'PAID' : 
            totalAvailable > 0 ? 'PARTIAL' : 'UNPAID'
        );
        
        if (invoiceUpdateResult.updatedInvoices.length > 0) {
          updatedInvoices.push(...invoiceUpdateResult.updatedInvoices.map(inv => ({
            ...inv,
            wasAutoPaid: true,
            selectionType: 'AUTO_PERIOD_MATCH'
          })));
        }
        
        remainingPayment = invoiceUpdateResult.remainingPayment;
        
        console.log(`Auto-updated ${invoiceUpdateResult.updatedInvoices.length} invoices for period ${paymentPeriodStr}, applied ${invoiceUpdateResult.totalApplied}`);
      } else {
        remainingPayment = totalAvailable;
      }

      let overpaymentRecords = [];
      let remainingOverpayment = overpaymentAmount;
      
      if (overpaymentAmount > 0 && handleOverpayment) {
        console.log(`Handling overpayment of ${overpaymentAmount} with FIFO allocation`);
        
        const otherUnpaidInvoices = await tx.invoice.findMany({
          where: {
            tenantId: tenantId,
            status: {
              in: ['UNPAID', 'PARTIAL', 'OVERDUE']
            },
            id: {
              notIn: invoicesToProcess.map(inv => inv.id)
            }
          },
          orderBy: { dueDate: 'asc' }
        });

        for (const invoice of otherUnpaidInvoices) {
          if (remainingOverpayment <= 0) break;
          
          const paymentToApply = Math.min(invoice.balance, remainingOverpayment);
          if (paymentToApply > 0) {
            const newAmountPaid = invoice.amountPaid + paymentToApply;
            const newBalance = invoice.balance - paymentToApply;
            let newStatus = invoice.status;
            
            if (newBalance <= 0) {
              newStatus = 'PAID';
            } else if (paymentToApply > 0) {
              newStatus = 'PARTIAL';
            }

            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                amountPaid: newAmountPaid,
                balance: newBalance,
                status: newStatus,
                paymentReportId: report.id,
                updatedAt: new Date(),
                notes: `Paid from overpayment of transaction #${report.id}`
              }
            });

            overpaymentRecords.push({
              type: 'FUTURE_INVOICE',
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              period: invoice.paymentPeriod,
              amountApplied: paymentToApply,
              commissionApplicable: false
            });

            updatedInvoices.push({
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              previousBalance: invoice.balance,
              previousAmountPaid: invoice.amountPaid,
              paymentApplied: paymentToApply,
              newAmountPaid: newAmountPaid,
              newBalance: newBalance,
              newStatus: newStatus,
              previousStatus: invoice.status,
              wasAutoPaid: true,
              paymentPolicy: invoice.paymentPolicy,
              selectionType: 'AUTO_FIFO_OVERPAYMENT'
            });

            remainingOverpayment -= paymentToApply;
            console.log(`Allocated ${paymentToApply} to future invoice ${invoice.invoiceNumber}`);
          }
        }

        if (remainingOverpayment > 0) {
          const currentPolicyCharges = await computeExpectedChargesForPolicy(
            tenantId,
            paymentPeriodDate || new Date(),
            paymentPolicy
          );

          const { periods, remainder } = calculateCoveredBillingPeriods(
            remainingOverpayment,
            currentPolicyCharges.totalDue
          );
          
          let futureDate = new Date(
            currentPolicyCharges.periodStart.getFullYear(),
            currentPolicyCharges.periodStart.getMonth(),
            1
          );
          
          for (let i = 1; i <= periods; i++) {
            futureDate = addBillingPeriod(futureDate, paymentPolicy);
            const expected = await computeExpectedChargesForPolicy(tenantId, futureDate, paymentPolicy);
            
            const futureReport = await tx.paymentReport.create({
              data: {
                tenantId,
                rent: expected.rent,
                serviceCharge: expected.serviceCharge,
                vat: expected.vat,
                totalDue: expected.totalDue,
                amountPaid: 0,
                arrears: 0,
                status: 'PREPAID',
                paymentPeriod: expected.periodStart,
                datePaid: new Date(),
                notes: `Covered by overpayment from ${paymentPeriodStr}. Prepaid ${paymentPolicy} period: ${expected.paymentPeriodLabel}. Original payment: ${parsedAmountPaid}`
              }
            });
            
            overpaymentRecords.push({
              type: 'PREPAID_PERIOD',
              period: expected.paymentPeriodLabel,
              reportId: futureReport.id,
              amountCovered: expected.totalDue,
              commissionApplicable: false
            });
          }
          
          if (remainder > 0) {
            await updateTenantCreditBalance(tx, tenantId, remainder);
            overpaymentRecords.push({
              type: 'CREDIT_BALANCE',
              amount: remainder,
              commissionApplicable: false
            });
          }
          
          console.log(`Created ${periods} prepaid ${paymentPolicy} records, credit balance: ${remainder}`);
        }
      }

      for (const invoice of invoicesToProcess) {
        if (remainingPayment <= 0) break;
        
        const alreadyUpdated = invoiceUpdateResult?.updatedInvoices?.find(
          ui => ui.id === invoice.id
        );
        
        if (alreadyUpdated) {
          continue;
        }
        
        const paymentToApply = Math.min(invoice.balance, remainingPayment);
        const newAmountPaid = invoice.amountPaid + paymentToApply;
        const newBalance = invoice.balance - paymentToApply;
        
        let newStatus = invoice.status;
        if (newBalance <= 0) {
          newStatus = 'PAID';
        } else if (paymentToApply > 0) {
          newStatus = 'PARTIAL';
        }

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: newAmountPaid,
            balance: newBalance,
            status: newStatus,
            paymentReportId: report.id,
            updatedAt: new Date()
          }
        });

        updatedInvoices.push({
          id: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          previousBalance: invoice.balance,
          previousAmountPaid: invoice.amountPaid,
          paymentApplied: paymentToApply,
          newAmountPaid: updatedInvoice.amountPaid,
          newBalance: updatedInvoice.balance,
          newStatus: updatedInvoice.status,
          previousStatus: invoice.status,
          wasAutoPaid: false,
          paymentPolicy: updatedInvoice.paymentPolicy,
          selectionType: invoiceIds.length > 0 ? 'USER_SELECTED' : 'FIFO_ALLOCATION'
        });

        remainingPayment -= paymentToApply;
      }

      const income = await tx.income.create({
        data: {
          property: {
            connect: { id: tenant.unit.propertyId }
          },
          tenant: {
            connect: { id: tenantId }
          },
          amount: parsedAmountPaid,
          frequency: frequency
        }
      });

      // =============================================
      // COMMISSION CREATION WITH PROPER MANAGER HANDLING
      // =============================================
      let commission = null;
      if (tenant.unit?.property?.commissionFee && 
          tenant.unit?.property?.commissionFee > 0 && 
          commissionBaseAmount > 0) {
        
        // Get the property's manager (could be ADMIN or MANAGER)
        const propertyManagerId = tenant.unit?.property?.managerId;
        
        // Only create commission if the property has a manager assigned
        if (propertyManagerId) {
          // Verify the manager exists and has appropriate role
          const manager = await tx.user.findUnique({
            where: { id: propertyManagerId },
            select: { id: true, role: true, name: true, email: true }
          });
          
          if (!manager) {
            console.log(`Warning: Property ${tenant.unit.propertyId} has managerId ${propertyManagerId} but user not found`);
            // Don't create commission if manager doesn't exist
          } else if (!['ADMIN', 'MANAGER'].includes(manager.role)) {
            console.log(`Warning: User ${manager.name} (${manager.id}) is not ADMIN or MANAGER, cannot receive commission`);
            // Don't create commission for non-ADMIN/non-MANAGER users
          } else {
            // Calculate commission
            let vatExclusiveCommissionBase = commissionBaseAmount;
            const tenantVatType = tenant.vatType || 'NOT_APPLICABLE';
            const tenantVatRate = tenant.vatRate || 0;
            
            if (tenantVatType === 'INCLUSIVE' && tenantVatRate > 0) {
              vatExclusiveCommissionBase = commissionBaseAmount / (1 + (tenantVatRate / 100));
            } else if (tenantVatType === 'EXCLUSIVE') {
              vatExclusiveCommissionBase = commissionBaseAmount / (1 + (tenantVatRate / 100));
            }
            
            const commissionAmount = (vatExclusiveCommissionBase * tenant.unit.property.commissionFee) / 100;
            
            const periodStart = new Date();
            let periodEnd = new Date();
            
            switch (frequency) {
              case 'QUARTERLY':
                periodEnd.setMonth(periodEnd.getMonth() + 3);
                break;
              case 'ANNUAL':
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                break;
              default:
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            }

            commission = await tx.managerCommission.create({
              data: {
                propertyId: tenant.unit.propertyId,
                managerId: propertyManagerId,
                commissionFee: tenant.unit.property.commissionFee,
                incomeAmount: vatExclusiveCommissionBase,
                originalIncomeAmount: parsedAmountPaid,
                commissionAmount: commissionAmount,
                periodStart: periodStart,
                periodEnd: periodEnd,
                status: 'PENDING',
                notes: `Commission for ${manager.role}: ${manager.name} (${manager.email}). VAT Type: ${tenantVatType}, VAT Rate: ${tenantVatRate}%, Credit used: ${creditUsed}. Payment recorded by: ${req.user.id}`
              }
            });
            
            console.log(`Commission created for ${manager.role}: ${manager.name} (${manager.id}) - Amount: ${commissionAmount}`);
          }
        } else {
          console.log(`Commission not created: Property ${tenant.unit.propertyId} has no manager assigned`);
        }
      }

      return {
        report,
        income,
        commission,
        updatedInvoices,
        invoiceUpdateResult,
        tenant,
        overpaymentRecords,
        overpaymentAmount,
        commissionBaseAmount,
        actualPaymentForCurrentPeriod,
        creditUsed,
        parsedAmountPaid,
        totalInvoiceBalance,
        totalAvailable,
        paymentPeriodStr
      };
    }, {
      maxWait: 20000,
      timeout: 60000,
    });

    let receiptResult = null;
    try {
      const freshInvoices = await prisma.invoice.findMany({
        where: { paymentReportId: transactionResult.report.id }
      });

      receiptResult = await generateAndUploadReceipt(
        transactionResult.report,
        transactionResult.tenant,
        freshInvoices,
        transactionResult.overpaymentAmount,
        transactionResult.creditUsed
      );

      await prisma.paymentReport.update({
        where: { id: transactionResult.report.id },
        data: { receiptUrl: receiptResult.receiptUrl }
      });

      console.log(`Receipt generated successfully: ${receiptResult.receiptNumber}`);
    } catch (receiptError) {
      console.error('Failed to generate receipt (non-critical):', receiptError);
    }

    res.status(201).json({
      success: true,
      data: {
        paymentReport: {
          id: transactionResult.report.id,
          tenantId: transactionResult.report.tenantId,
          amountPaid: transactionResult.report.amountPaid,
          arrears: transactionResult.report.arrears,
          status: transactionResult.report.status,
          paymentPeriod: transactionResult.report.paymentPeriod,
          datePaid: transactionResult.report.datePaid,
          notes: transactionResult.report.notes,
          receiptUrl: receiptResult?.receiptUrl || null,
          receiptNumber: receiptResult?.receiptNumber || null
        },
        income: {
          id: transactionResult.income.id,
          propertyId: tenant.unit.propertyId,
          amount: transactionResult.income.amount,
          frequency: transactionResult.income.frequency
        },
        invoices: transactionResult.updatedInvoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          previousBalance: inv.previousBalance,
          paymentApplied: inv.paymentApplied,
          newAmountPaid: inv.newAmountPaid,
          newBalance: inv.newBalance,
          newStatus: inv.newStatus,
          previousStatus: inv.previousStatus,
          wasAutoPaid: inv.wasAutoPaid || false,
          selectionType: inv.selectionType || 'UNKNOWN',
          paymentPolicy: inv.paymentPolicy
        })),
        existingInvoicesUpdated: transactionResult.invoiceUpdateResult ? {
          count: transactionResult.invoiceUpdateResult.updatedInvoices.length,
          totalApplied: transactionResult.invoiceUpdateResult.totalApplied,
          remainingPayment: transactionResult.invoiceUpdateResult.remainingPayment,
          period: transactionResult.paymentPeriodStr
        } : null,
        overpayment: transactionResult.overpaymentAmount > 0 ? {
          totalOverpayment: transactionResult.overpaymentAmount,
          currentPeriodPayment: transactionResult.actualPaymentForCurrentPeriod,
          invoiceBalanceCleared: transactionResult.totalInvoiceBalance,
          allocations: transactionResult.overpaymentRecords,
          creditUsed: transactionResult.creditUsed
        } : null,
        commission: transactionResult.commission ? {
          id: transactionResult.commission.id,
          commissionAmount: transactionResult.commission.commissionAmount,
          commissionBase: transactionResult.commission.incomeAmount,
          originalAmount: transactionResult.commission.originalIncomeAmount,
          status: transactionResult.commission.status,
          note: 'Commission calculated only on current period amount'
        } : null,
        receipt: receiptResult ? {
          receiptNumber: receiptResult.receiptNumber,
          receiptUrl: receiptResult.receiptUrl,
          generatedAt: new Date()
        } : null
      },
      message: 'Payment recorded successfully' + 
        (transactionResult.invoiceUpdateResult ? 
          ` (${transactionResult.invoiceUpdateResult.totalApplied} applied to existing invoices for period ${transactionResult.paymentPeriodStr})` : 
          '') +
        (transactionResult.overpaymentAmount > 0 ? 
          ` (Overpayment of ${transactionResult.overpaymentAmount} allocated using FIFO)` : '') +
        (transactionResult.creditUsed > 0 ? 
          ` (${transactionResult.creditUsed} credit applied)` : '') +
        (receiptResult ? ' (Receipt generated)' : '') +
        (transactionResult.commission ? ` (Commission: ${transactionResult.commission.commissionAmount})` : '')
    });

  } catch (error) {
    console.error('Error creating payment report:', error);
    
    if (error.code === 'P2028') {
      return res.status(408).json({ 
        success: false, 
        message: 'Transaction timeout. Please try again.' 
      });
    }
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Related record not found. Please check the provided IDs.' 
      });
    }
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Duplicate entry. This payment may already exist.' 
      });
    }
    
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to create payment report',
      details: error.code ? `Error code: ${error.code}` : undefined
    });
  }
};

// @desc    Get income reports (with basic filtering)
// @route   GET /api/payments/income
// @access  Private
export const getIncomeReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId, tenantId, dateFrom, dateTo, page = 1, limit = 10 } = req.query;
    const { skip, limit: take } = getPaginationParams(req.query);

    if (userRole !== 'ADMIN') {
      const hasPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_PAYMENT_REPORTS'
      );
      if (!hasPermission) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view income reports' 
        });
      }
    }

    const where = {};

    if (propertyId) {
      if (userRole !== 'ADMIN') {
        const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
        if (!canView) {
          return res.status(403).json({ 
            success: false, 
            message: 'You do not have permission to view income for this property' 
          });
        }
      }
      where.propertyId = propertyId;
    }
    if (tenantId) where.tenantId = tenantId;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const total = await prisma.income.count({ where });

    const incomes = await prisma.income.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        tenant: {
          select: {
            id: true,
            fullName: true,
            vatType: true,
            vatRate: true,
            escalationRate: true,
            escalationFrequency: true,
            unit: { select: { id: true, type: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(take)
    });

    res.json({
      success: true,
      data: incomes,
      meta: {
        page: parseInt(page),
        limit: parseInt(take),
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Error fetching income reports:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create income record
// @route   POST /api/payments/income
// @access  Private (ADMIN, MANAGER)
export const createIncome = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId, tenantId, amount, frequency } = req.body;

    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      const hasPermission = await permissionService.hasPermission(
        userId, 
        'RECORD_PAYMENTS'
      );
      if (!hasPermission) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to create income records' 
        });
      }
    }

    if (!propertyId && !tenantId) {
      return res.status(400).json({ success: false, message: 'Either propertyId or tenantId is required' });
    }
    if (amount == null || isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: 'Valid non-negative amount is required' });
    }

    if (propertyId && userRole !== 'ADMIN') {
      const canManage = await canManagePaymentForProperty(userId, userRole, propertyId);
      if (!canManage) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to create income for this property' 
        });
      }
    }

    const income = await prisma.income.create({
      data: {
        propertyId: propertyId || null,
        tenantId: tenantId || null,
        amount: parseFloat(amount),
        frequency: frequency || 'MONTHLY'
      },
      include: {
        property: { select: { id: true, name: true } },
        tenant: {
          select: {
            id: true,
            fullName: true,
            vatType: true,
            vatRate: true,
            escalationRate: true,
            escalationFrequency: true,
            unit: { select: { id: true, type: true } }
          }
        }
      }
    });

    res.status(201).json({ success: true, data: income });
  } catch (error) {
    console.error('Error creating income record:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Preview expected payment for tenant
// @route   GET /api/payments/preview/:tenantId
// @access  Private (requires PREVIEW_PAYMENTS permission)
export const previewPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;
    const { includeCredit = true, paymentPeriod } = req.query;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { 
        paymentPolicy: true,
        unit: {
          select: {
            propertyId: true
          }
        }
      }
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const propertyId = tenant.unit?.propertyId;

    if (userRole !== 'ADMIN') {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to preview payments for this tenant' 
        });
      }
      
      const hasPreviewPermission = await permissionService.hasPermission(
        userId, 
        'PREVIEW_PAYMENTS', 
        propertyId
      );
      
      if (!hasPreviewPermission && userRole !== 'MANAGER') {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to preview payments' 
        });
      }
    }

    const preview = await computeExpectedChargesForPolicy(
      tenantId,
      paymentPeriod ? new Date(paymentPeriod) : null,
      tenant.paymentPolicy || 'MONTHLY'
    );
    
    let creditBalance = 0;
    if (includeCredit) {
      creditBalance = await getTenantCreditBalance(prisma, tenantId);
    }
    
    res.json({ 
      success: true, 
      data: {
        ...preview,
        existingCredit: creditBalance,
        netDueAfterCredit: Math.max(0, parseFloat((preview.totalDue - creditBalance).toFixed(2))),
        totalAvailable: parseFloat((preview.totalDue + creditBalance).toFixed(2))
      }
    });
  } catch (error) {
    console.error('Preview payment error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update payment report (with income/commission updates)
// @route   PUT /api/payments/:id
// @access  Private (ADMIN, MANAGER, or users with EDIT_PAYMENT_RECORDS permission)
export const updatePaymentReportWithIncome = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { amountPaid, paymentPeriod, notes } = req.body;

    const existingReport = await prisma.paymentReport.findUnique({
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
        invoices: true
      }
    });

    if (!existingReport) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment report not found' 
      });
    }

    const propertyId = existingReport.tenant?.unit?.propertyId;

    if (userRole !== 'ADMIN') {
      const canManage = await canManagePaymentForProperty(userId, userRole, propertyId);
      if (!canManage) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to update payment records for this property' 
        });
      }
      
      const hasEditPermission = await permissionService.hasPermission(
        userId, 
        'EDIT_PAYMENT_RECORDS', 
        propertyId
      );
      
      if (!hasEditPermission && userRole !== 'MANAGER') {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to update payment records' 
        });
      }
    }

    let parsedAmountPaid = existingReport.amountPaid;
    if (amountPaid !== undefined && amountPaid !== null) {
      if (isNaN(amountPaid)) {
        throw new Error('Valid amountPaid is required');
      }
      parsedAmountPaid = parseFloat(amountPaid);
      if (parsedAmountPaid < 0) {
        throw new Error('amountPaid cannot be negative');
      }
    }

    const existingPolicyMonths = existingReport.invoices?.length > 0
      ? Math.max(...existingReport.invoices.map(inv => getInvoicePeriodMonths(inv, existingReport.tenant.paymentPolicy || 'MONTHLY')))
      : getPolicyMonths(existingReport.tenant.paymentPolicy || 'MONTHLY');

    let expected = {
      rent: existingReport.rent,
      serviceCharge: existingReport.serviceCharge,
      vat: existingReport.vat,
      vatType: existingReport.tenant.vatType,
      vatRate: existingReport.tenant.vatRate,
      totalDue: existingReport.totalDue,
      periodStart: existingReport.paymentPeriod,
      periodEnd: new Date(
        new Date(existingReport.paymentPeriod).getFullYear(),
        new Date(existingReport.paymentPeriod).getMonth() + existingPolicyMonths,
        0
      )
    };

    if (paymentPeriod) {
      expected = await computeExpectedChargesForPolicy(
        existingReport.tenantId,
        paymentPeriod,
        existingReport.tenant.paymentPolicy || 'MONTHLY'
      );
    }

    const arrears = parseFloat((expected.totalDue - parsedAmountPaid).toFixed(2));
    const status = parsedAmountPaid >= expected.totalDue
      ? 'PAID'
      : parsedAmountPaid > 0
        ? 'PARTIAL'
        : 'UNPAID';

    const result = await prisma.$transaction(async (tx) => {
      const updatedReport = await tx.paymentReport.update({
        where: { id },
        data: {
          rent: expected.rent,
          serviceCharge: expected.serviceCharge,
          vat: expected.vat,
          totalDue: expected.totalDue,
          amountPaid: parsedAmountPaid,
          arrears,
          status,
          paymentPeriod: expected.periodStart,
          notes: notes !== undefined ? notes : existingReport.notes,
          updatedAt: new Date()
        },
        include: {
          tenant: {
            select: {
              id: true,
              fullName: true,
              contact: true,
              vatType: true,
              vatRate: true,
              escalationRate: true,
              escalationFrequency: true,
              unit: {
                include: {
                  property: {
                    select: { id: true, name: true, managerId: true, commissionFee: true }
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
              status: true,
              issueDate: true,
              dueDate: true
            }
          }
        }
      });

      if (existingReport.invoices && existingReport.invoices.length > 0) {
        const rentInvoice = existingReport.invoices[0];
        const rentBalance = arrears > 0 ? arrears : 0;
        
        await tx.invoice.update({
          where: { id: rentInvoice.id },
          data: {
            rent: expected.rent,
            serviceCharge: expected.serviceCharge || 0,
            vat: expected.vat || 0,
            totalDue: expected.totalDue,
            amountPaid: parsedAmountPaid,
            balance: rentBalance,
            status: status === 'PAID' ? 'PAID' : status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
            notes: notes !== undefined ? notes : rentInvoice.notes,
            updatedAt: new Date()
          }
        });
      }

      const income = await tx.income.findFirst({
        where: {
          tenantId: existingReport.tenantId,
          propertyId: existingReport.tenant.unit.propertyId,
          createdAt: {
            gte: new Date(existingReport.paymentPeriod),
            lt: new Date(new Date(existingReport.paymentPeriod).setMonth(new Date(existingReport.paymentPeriod).getMonth() + 1))
          }
        }
      });

      let updatedIncome = null;
      if (income) {
        updatedIncome = await tx.income.update({
          where: { id: income.id },
          data: {
            amount: parsedAmountPaid,
            updatedAt: new Date()
          }
        });

        // =============================================
        // COMMISSION PROCESSING WITH PROPER MANAGER HANDLING
        // =============================================
        if (updatedIncome) {
          // Get property details to check for commission
          const property = await tx.property.findUnique({
            where: { id: existingReport.tenant.unit.propertyId },
            select: { 
              id: true, 
              managerId: true, 
              commissionFee: true,
              name: true 
            }
          });

          // Only process commission if property has commission fee AND a manager assigned
          if (property?.commissionFee && property?.commissionFee > 0 && property?.managerId) {
            // Verify the manager exists and has appropriate role
            const manager = await tx.user.findUnique({
              where: { id: property.managerId },
              select: { id: true, role: true, name: true, email: true }
            });

            if (!manager) {
              console.log(`Warning: Property ${property.id} has managerId ${property.managerId} but user not found`);
            } else if (!['ADMIN', 'MANAGER'].includes(manager.role)) {
              console.log(`Warning: User ${manager.name} (${manager.id}) is not ADMIN or MANAGER, cannot receive commission`);
            } else {
              // Process the commission
              await processCommissionForIncome(tx, updatedIncome.id);
              console.log(`Commission processed for ${manager.role}: ${manager.name} (${manager.id}) on property: ${property.name}`);
            }
          } else if (property?.commissionFee && property?.commissionFee > 0 && !property?.managerId) {
            console.log(`Commission not processed: Property ${property.id} has commission fee but no manager assigned`);
          }
        }
      }

      return { updatedReport, updatedIncome };
    });

    res.json({
      success: true,
      data: result.updatedReport,
      income: result.updatedIncome,
      message: 'Payment report and related records updated successfully'
    });

  } catch (error) {
    console.error('Error updating payment report:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to update payment report' 
    });
  }
};

// @desc    Download payment receipt PDF
// @route   GET /api/payments/:id/receipt
// @access  Private (requires DOWNLOAD_PAYMENT_RECEIPT permission)
export const downloadPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const paymentReport = await prisma.paymentReport.findUnique({
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

    if (!paymentReport) {
      return res.status(404).json({
        success: false,
        message: 'Payment report not found'
      });
    }

    const propertyId = paymentReport.tenant?.unit?.propertyId;

    if (userRole !== 'ADMIN') {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to download receipts for this property' 
        });
      }
      
      const hasDownloadPermission = await permissionService.hasPermission(
        userId, 
        'DOWNLOAD_PAYMENT_RECEIPT', 
        propertyId
      );
      
      if (!hasDownloadPermission && userRole !== 'MANAGER') {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to download payment receipts' 
        });
      }
    }

    if (!paymentReport.receiptUrl) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found for this payment. It may still be generating or failed to generate.'
      });
    }

    const fileName = path.basename(paymentReport.receiptUrl);
    const filePath = path.join(process.cwd(), 'uploads', 'receipts', fileName);

    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Receipt file not found on server. It may have been deleted or moved.'
      });
    }

    const fileBuffer = await fs.readFile(filePath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${fileName}"`);
    res.send(fileBuffer);

  } catch (error) {
    console.error('Error downloading receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download receipt'
    });
  }
};

// @desc    Get arrears for a property
// @route   GET /api/payments/arrears/:propertyId
// @access  Private (requires VIEW_ARREARS permission)
export async function getPropertyArrears(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;

    if (!propertyId) {
      return res.status(400).json({ error: 'Property ID is required' });
    }

    if (userRole !== 'ADMIN') {
      const canView = await canViewPaymentsForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view arrears for this property' 
        });
      }
      
      const hasArrearsPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_ARREARS', 
        propertyId
      );
      
      if (!hasArrearsPermission && userRole !== 'MANAGER') {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view arrears' 
        });
      }
    }

    const units = await prisma.unit.findMany({
      where: {
        propertyId: propertyId,
        status: 'OCCUPIED',
        tenant: {
          isNot: null
        }
      },
      include: {
        tenant: {
          include: {
            invoices: {
              where: {
                status: {
                  in: ['UNPAID', 'PARTIAL']
                }
              },
              orderBy: {
                dueDate: 'asc'
              }
            },
            billInvoices: {
              where: {
                status: {
                  in: ['UNPAID', 'PARTIAL']
                }
              },
              orderBy: {
                dueDate: 'asc'
              }
            },
            paymentReports: {
              orderBy: {
                paymentPeriod: 'desc'
              }
            }
          }
        },
        property: {
          select: {
            name: true
          }
        }
      }
    });

    const arrearsData = [];

    for (const unit of units) {
      if (!unit.tenant) continue;

      const tenant = unit.tenant;
      
      const creditBalance = await getTenantCreditBalance(prisma, tenant.id);
      
      for (const invoice of tenant.invoices) {
        if (invoice.balance > 0) {
          arrearsData.push({
            id: `invoice-${invoice.id}`,
            tenantId: tenant.id,
            tenantName: tenant.fullName,
            tenantContact: tenant.contact,
            unitType: unit.type || 'Unit',
            unitNo: unit.unitNo || 'N/A',
            floor: unit.floor || 'N/A',
            invoiceNumber: invoice.invoiceNumber,
            invoiceType: 'RENT',
            expectedAmount: invoice.totalDue,
            paidAmount: invoice.amountPaid,
            balance: invoice.balance,
            dueDate: invoice.dueDate,
            status: invoice.status,
            description: `Rent for ${unit.property.name} - ${unit.type || 'Unit'} ${unit.unitNo || ''}`,
            invoiceId: invoice.id,
            paymentPeriod: invoice.paymentPeriod,
            hasCreditBalance: creditBalance > 0,
            creditBalance: creditBalance
          });
        }
      }

      for (const billInvoice of tenant.billInvoices) {
        if (billInvoice.balance > 0) {
          arrearsData.push({
            id: `bill-invoice-${billInvoice.id}`,
            tenantId: tenant.id,
            tenantName: tenant.fullName,
            tenantContact: tenant.contact,
            unitType: unit.type || 'Unit',
            unitNo: unit.unitNo || 'N/A',
            floor: unit.floor || 'N/A',
            invoiceNumber: billInvoice.invoiceNumber,
            invoiceType: 'BILL',
            billType: billInvoice.billType,
            expectedAmount: billInvoice.grandTotal,
            paidAmount: billInvoice.amountPaid,
            balance: billInvoice.balance,
            dueDate: billInvoice.dueDate,
            status: billInvoice.status,
            description: `${billInvoice.billType} charge - ${billInvoice.billReferenceNumber || ''}`,
            billInvoiceId: billInvoice.id,
            billReferenceNumber: billInvoice.billReferenceNumber
          });
        }
      }
    }

    arrearsData.sort((a, b) => {
      const dateDiff = new Date(a.dueDate) - new Date(b.dueDate);
      if (dateDiff !== 0) return dateDiff;
      return b.balance - a.balance;
    });

    const totalArrears = arrearsData.reduce((sum, item) => sum + item.balance, 0);
    const totalExpected = arrearsData.reduce((sum, item) => sum + item.expectedAmount, 0);
    const totalPaid = arrearsData.reduce((sum, item) => sum + item.paidAmount, 0);
    const totalCreditAvailable = arrearsData.reduce((sum, item) => sum + (item.creditBalance || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        arrears: arrearsData,
        summary: {
          totalArrears,
          totalExpected,
          totalPaid,
          totalCreditAvailable,
          itemCount: arrearsData.length,
          pendingInvoicesCount: arrearsData.filter(item => item.isPendingInvoice).length,
          tenantsWithCredit: arrearsData.filter(item => item.hasCreditBalance).length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching property arrears:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Failed to fetch arrears data',
      details: error.message 
    });
  }
}

// @desc    Delete payment report with comprehensive cleanup
// @route   DELETE /api/payments/:id
// @access  Private (Admin only or users with DELETE_PAYMENT_RECORDS permission)
export const deletePaymentReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { 
      deleteLinkedInvoices = false,
      deleteBillInvoices = false,
      deleteIncome = false,
      force = false 
    } = req.body;
    
    const paymentReport = await prisma.paymentReport.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            unit: {
              select: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        },
        invoices: true,
        billInvoices: true
      }
    });
    
    if (!paymentReport) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment report not found' 
      });
    }

    const propertyId = paymentReport.tenant?.unit?.property?.id;

    if (userRole !== 'ADMIN') {
      const canManage = await canManagePaymentForProperty(userId, userRole, propertyId);
      if (!canManage) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to delete payment records for this property' 
        });
      }
      
      const hasDeletePermission = await permissionService.hasPermission(
        userId, 
        'DELETE_PAYMENT_RECORDS', 
        propertyId
      );
      
      if (!hasDeletePermission) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to delete payment records' 
        });
      }
    }
    
    const reportAge = Date.now() - new Date(paymentReport.createdAt).getTime();
    const maxAge = 90 * 24 * 60 * 60 * 1000;
    
    if (!force && reportAge > maxAge && userRole !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: `Payment report is older than 90 days. Use force=true to delete.`,
        ageInDays: Math.floor(reportAge / (24 * 60 * 60 * 1000))
      });
    }
    
    const result = {
      deletedPaymentReport: {
        id: paymentReport.id,
        amountPaid: paymentReport.amountPaid,
        status: paymentReport.status,
        paymentPeriod: paymentReport.paymentPeriod
      },
      deletedReceipt: false,
      deletedInvoices: [],
      deletedBillInvoices: [],
      deletedIncome: null,
      unlinkCount: 0
    };
    
    await prisma.$transaction(async (tx) => {
      if (paymentReport.receiptUrl) {
        try {
          await deleteFromStorage(paymentReport.receiptUrl);
          result.deletedReceipt = true;
          console.log(`Deleted receipt PDF: ${paymentReport.receiptUrl}`);
        } catch (error) {
          console.warn('Failed to delete receipt PDF:', error);
        }
      }
      
      if (paymentReport.invoices.length > 0) {
        if (deleteLinkedInvoices) {
          for (const invoice of paymentReport.invoices) {
            if (invoice.pdfUrl) {
              try {
                await deleteFromStorage(invoice.pdfUrl);
              } catch (error) {
                console.warn(`Failed to delete invoice PDF ${invoice.invoiceNumber}:`, error);
              }
            }
            
            await tx.invoice.delete({
              where: { id: invoice.id }
            });
            
            result.deletedInvoices.push({
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              totalDue: invoice.totalDue
            });
          }
        } else {
          await tx.invoice.updateMany({
            where: { paymentReportId: paymentReport.id },
            data: { paymentReportId: null }
          });
          result.unlinkCount = paymentReport.invoices.length;
        }
      }
      
      if (paymentReport.billInvoices.length > 0) {
        if (deleteBillInvoices) {
          for (const billInvoice of paymentReport.billInvoices) {
            if (billInvoice.pdfUrl) {
              try {
                await deleteFromStorage(billInvoice.pdfUrl);
              } catch (error) {
                console.warn(`Failed to delete bill invoice PDF ${billInvoice.invoiceNumber}:`, error);
              }
            }
            
            await tx.billInvoice.delete({
              where: { id: billInvoice.id }
            });
            
            result.deletedBillInvoices.push({
              id: billInvoice.id,
              invoiceNumber: billInvoice.invoiceNumber,
              totalAmount: billInvoice.totalAmount
            });
          }
        } else {
          await tx.billInvoice.updateMany({
            where: { paymentReportId: paymentReport.id },
            data: { paymentReportId: null }
          });
          result.unlinkCount += paymentReport.billInvoices.length;
        }
      }
      
      if (deleteIncome) {
        const relatedIncome = await tx.income.findFirst({
          where: {
            tenantId: paymentReport.tenantId,
            createdAt: {
              gte: new Date(paymentReport.datePaid.getTime() - 60000),
              lte: new Date(paymentReport.datePaid.getTime() + 60000)
            },
            amount: paymentReport.amountPaid
          }
        });
        
        if (relatedIncome) {
          await tx.income.delete({
            where: { id: relatedIncome.id }
          });
          
          result.deletedIncome = {
            id: relatedIncome.id,
            amount: relatedIncome.amount,
            frequency: relatedIncome.frequency
          };
        }
      }
      
      await tx.paymentReport.delete({
        where: { id: paymentReport.id }
      });
    });
    
    res.json({
      success: true,
      data: result,
      message: 'Payment report deleted successfully' + 
        (result.deletedReceipt ? ' (Receipt PDF deleted)' : '') +
        (result.deletedInvoices.length > 0 ? ` (${result.deletedInvoices.length} invoices deleted)` : '') +
        (result.deletedBillInvoices.length > 0 ? ` (${result.deletedBillInvoices.length} bill invoices deleted)` : '') +
        (result.deletedIncome ? ' (Income record deleted)' : '') +
        (result.unlinkCount > 0 ? ` (${result.unlinkCount} records unlinked)` : '')
    });
    
  } catch (error) {
    console.error('Error deleting payment report:', error);
    
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete payment report due to foreign key constraints. Try unlinking related records first.' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to delete payment report' 
    });
  }
};

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

