import prisma from "../lib/prisma.js";
import { generatePDF } from '../utils/pdfGenerator.js';
import { processCommissionForIncome } from '../services/commissionService.js';
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import { generateReceiptHTML } from '../utils/receiptTemplate.js';
import { uploadToStorage } from '../utils/storage.js';
import path from 'path';  // ADD THIS
import fs from 'fs/promises';  // ADD THIS
import { existsSync } from 'fs';           // For synchronous methods like existsSync
//const prisma = new PrismaClient();

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
    
    let escalationIntervalMonths = 12; // Default ANNUALLY
    if (tenant.escalationFrequency === 'BI_ANNUALLY') {
      escalationIntervalMonths = 6;
    }
    
    const escalationsApplied = Math.floor(monthsElapsed / escalationIntervalMonths);
    
    if (escalationsApplied > 0) {
      expectedRent = tenant.rent * Math.pow(1 + tenant.escalationRate / 100, escalationsApplied);
    }
  }

  // Compute service charge
  let serviceCharge = 0;
  const sc = tenant.serviceCharge;
  if (sc) {
    switch (sc.type) {
      case 'FIXED':
        serviceCharge = sc.fixedAmount || 0;
        break;
      case 'PERCENTAGE':
        serviceCharge = expectedRent * (sc.percentage || 0) / 100;
        break;
      case 'PER_SQ_FT':
        const sqFt = tenant.unit?.sizeSqFt || 0;
        serviceCharge = sqFt * (sc.perSqFtRate || 0);
        break;
      default:
        serviceCharge = 0;
    }
  }

  // Calculate VAT based on tenant's VAT configuration
  let vat = 0;
  let baseAmount = expectedRent + serviceCharge;
  const vatRate = 16; // Fixed 16% VAT rate

  if (tenant.vatType === 'EXCLUSIVE') {
    // VAT is added on top of rent + service charge
    vat = baseAmount * vatRate / 100;
  } else if (tenant.vatType === 'INCLUSIVE') {
    // VAT is already included in the rent amount
    // Extract VAT from the inclusive amount: VAT = Amount × (VAT Rate / (100 + VAT Rate))
    vat = baseAmount * (vatRate / (100 + vatRate));
    // Note: The rent already includes VAT, so we don't add it to totalDue
  } else {
    // NOT_APPLICABLE - no VAT
    vat = 0;
  }

  // Calculate total due
  let totalDue;
  if (tenant.vatType === 'EXCLUSIVE') {
    totalDue = expectedRent + serviceCharge + vat;
  } else {
    // For INCLUSIVE and NOT_APPLICABLE, totalDue is just rent + service charge
    totalDue = expectedRent + serviceCharge;
  }

  return {
    rent: parseFloat(expectedRent.toFixed(2)),
    serviceCharge: parseFloat(serviceCharge.toFixed(2)),
    vat: parseFloat(vat.toFixed(2)),
    vatType: tenant.vatType,
    vatRate: tenant.vatRate || 0,
    totalDue: parseFloat(totalDue.toFixed(2)),
    periodStart: periodStartOfMonth,
    periodEnd: periodEndOfMonth
  };
}

// Utility: Parse & validate pagination params
function getPaginationParams(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// @desc    Get all payment reports (with pagination & filtering)
// @route   GET /api/payments
// @access  Private
export const getPaymentReports = async (req, res) => {
  try {
    const { 
      status, 
      propertyId, 
      dateFrom, 
      dateTo,
      page = 1,
      limit = 10 
    } = req.query;

    const { skip, limit: take } = getPaginationParams(req.query);

    // Build dynamic WHERE clause
    const where = {};

    // Filter by status (enum-safe)
    if (status && ['PAID', 'PARTIAL', 'UNPAID'].includes(status)) {
      where.status = status;
    }

    // Filter by property (via tenant → unit → property)
    if (propertyId) {
      where.tenant = {
        unit: {
          propertyId
        }
      };
    }

    // Filter by payment period range
    if (dateFrom || dateTo) {
      where.paymentPeriod = {};
      if (dateFrom) where.paymentPeriod.gte = new Date(dateFrom);
      if (dateTo) where.paymentPeriod.lte = new Date(dateTo);
    }

    // Count total matching records
    const total = await prisma.paymentReport.count({ where });

    // Fetch paginated data
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
    const { tenantId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const { skip, limit: take } = getPaginationParams(req.query);

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

// @desc    Get outstanding invoices for a tenant
// @route   GET /api/payments/outstanding/:tenantId
// @access  Private
export const getOutstandingInvoices = async (req, res) => {
  try {
    const { tenantId } = req.params;

    // Get unpaid/partial rent invoices only
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
        rent: true,
        serviceCharge: true,
        vat: true,
        totalDue: true,
        amountPaid: true,
        balance: true,
        status: true,
        pdfUrl: true
      }
    });

    // Calculate totals
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

// Helper: Get or create tenant credit balance for overpayments
async function getTenantCreditBalance(tx, tenantId) {
  // Look for existing credit balance (stored as a special payment report with status 'CREDIT')
  const creditBalance = await tx.paymentReport.findFirst({
    where: {
      tenantId,
      status: 'CREDIT' // We'll add this to PaymentStatus enum
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

// Helper: Calculate how many periods are covered by overpayment
function calculateCoveredPeriods(overpaymentAmount, monthlyRent, paymentPolicy) {
  if (monthlyRent <= 0) return { months: 0, remainder: 0 };
  
  let monthsCovered = 0;
  let remaining = overpaymentAmount;
  
  // Calculate based on payment policy
  switch (paymentPolicy) {
    case 'MONTHLY':
      monthsCovered = Math.floor(remaining / monthlyRent);
      remaining = remaining % monthlyRent;
      break;
    case 'QUARTERLY':
      const quarterlyRent = monthlyRent * 3;
      monthsCovered = Math.floor(remaining / quarterlyRent) * 3;
      remaining = remaining % quarterlyRent;
      break;
    case 'ANNUAL':
      const annualRent = monthlyRent * 12;
      monthsCovered = Math.floor(remaining / annualRent) * 12;
      remaining = remaining % annualRent;
      break;
    default:
      monthsCovered = Math.floor(remaining / monthlyRent);
      remaining = remaining % monthlyRent;
  }
  
  return { months: monthsCovered, remainder: parseFloat(remaining.toFixed(2)) };
}

// Helper: Generate and upload receipt PDF
async function generateAndUploadReceipt(paymentReport, tenant, invoices, overpaymentAmount = 0, creditUsed = 0) {
  try {
    const receiptData = {
      receiptNumber: `RCP-${Date.now()}-${paymentReport.id.slice(-6).toUpperCase()}`,
      paymentDate: paymentReport.datePaid,
      tenantName: tenant.fullName,
      tenantContact: tenant.contact,
      propertyName: tenant.unit?.property?.name || 'N/A',
      unitType: tenant.unit?.type || 'Unit',
      unitNo: tenant.unit?.unitNo || '',
      paymentPeriod: new Date(paymentReport.paymentPeriod).toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
      }),
      amountPaid: paymentReport.amountPaid,
      invoicesPaid: invoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        paymentPeriod: inv.paymentPeriod,
        previousBalance: inv.totalDue,
        paymentApplied: inv.amountPaid,
        newBalance: inv.balance,
        newStatus: inv.status
      })),
      overpaymentAmount: overpaymentAmount,
      creditUsed: creditUsed,
      totalAllocated: paymentReport.amountPaid,
      paymentReportId: paymentReport.id,
      notes: paymentReport.notes
    };

    const receiptHTML = generateReceiptHTML(receiptData);
    const pdfBuffer = await generatePDF(receiptHTML);

    // Update with new receipt URL - store in receipts subdirectory
    const receiptFileName = `${receiptData.receiptNumber}.pdf`;
    const receiptUrl = await uploadToStorage(pdfBuffer, receiptFileName, 'receipts');
    
    return {
      receiptUrl,
      receiptNumber: receiptData.receiptNumber,
      pdfBuffer // Return buffer for immediate download if needed
    };
  } catch (error) {
    console.error('Error generating receipt:', error);
    throw error;
  }
}

// @desc    Create payment report (Invoice-based, RENT ONLY)
// @route   POST /api/payments
// @access  Private (ADMIN, MANAGER)
export const createPaymentReport = async (req, res) => {
  let transactionResult = null;
  
  try {
    const { 
      tenantId, 
      amountPaid,
      invoiceIds = [], // Array of invoice IDs being paid
      notes,
      paymentPeriod,
      createMissingInvoices = false,
      updateExistingInvoices = true,
      handleOverpayment = true
    } = req.body;

    // Input validation
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

    // Validate paymentPeriod date format
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

    // 1. Fetch tenant with related data
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

    // 2. Check for existing credit balance
    let existingCredit = 0;
    if (handleOverpayment) {
      existingCredit = await getTenantCreditBalance(prisma, tenantId);
      if (existingCredit > 0) {
        console.log(`Found existing credit balance for tenant: ${existingCredit}`);
      }
    }

    // 3. Determine invoices to process based on user selection
    let invoicesToProcess = [];
    let totalInvoiceBalance = 0;
    let paymentPolicy = tenant.paymentPolicy;
    let paymentPeriodStr = paymentPeriodDate ? 
      paymentPeriodDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 
      new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // If user selected specific invoices
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
    } 
    // If user didn't select any invoices
    else {
      // Get all unpaid/partial invoices ordered by due date (FIFO)
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
      
      // If no existing invoices
      if (invoicesToProcess.length === 0) {
        // If createMissingInvoices is true, create one
        if (createMissingInvoices) {
          const expected = await computeExpectedCharges(tenantId, paymentPeriodDate);
          
          const invoiceNumber = await generateInvoiceNumber();
          const newInvoice = await prisma.invoice.create({
            data: {
              invoiceNumber,
              tenantId,
              issueDate: new Date(),
              dueDate: paymentPeriodDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              paymentPeriod: expected.periodStart.toLocaleDateString('en-US', { 
                month: 'long', 
                year: 'numeric' 
              }),
              rent: expected.rent,
              serviceCharge: expected.serviceCharge,
              vat: expected.vat,
              totalDue: expected.totalDue,
              amountPaid: 0,
              balance: expected.totalDue,
              status: 'UNPAID',
              paymentPolicy: tenant.paymentPolicy,
              notes: `Auto-generated for payment recording`
            }
          });
          
          invoicesToProcess = [newInvoice];
          totalInvoiceBalance = expected.totalDue;
          paymentPeriodStr = newInvoice.paymentPeriod;
          console.log(`Created new invoice for payment: ${newInvoice.invoiceNumber}`);
        } else {
          // createMissingInvoices is false AND no invoices exist - ERROR
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
        // Use existing invoices (FIFO)
        paymentPolicy = invoicesToProcess[0].paymentPolicy || tenant.paymentPolicy;
        paymentPeriodStr = invoicesToProcess[0].paymentPeriod || paymentPeriodStr;
        console.log(`Using FIFO: Processing ${invoicesToProcess.length} oldest invoices with total balance: ${totalInvoiceBalance}`);
      }
    }

    // Calculate total amount available (payment + existing credit)
    const totalAvailable = parsedAmountPaid + existingCredit;
    
    // Check for overpayment
    let overpaymentAmount = 0;
    let commissionBaseAmount = 0;
    let actualPaymentForCurrentPeriod = parsedAmountPaid;

    if (totalAvailable > totalInvoiceBalance) {
      overpaymentAmount = totalAvailable - totalInvoiceBalance;
      
      // For commission calculation, use only what's due for current period
      commissionBaseAmount = Math.min(totalInvoiceBalance, parsedAmountPaid);
      
      // Calculate actual cash payment for current period
      actualPaymentForCurrentPeriod = Math.max(0, totalInvoiceBalance - existingCredit);
      
      console.log(`Overpayment detected: ${overpaymentAmount}`);
      console.log(`Commission base amount: ${commissionBaseAmount}`);
    } else {
      commissionBaseAmount = parsedAmountPaid;
    }

    // Validate payment amount
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

    // Calculate frequency based on payment policy
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

    // 4. Process payment in transaction
    transactionResult = await prisma.$transaction(async (tx) => {
      // Apply existing credit first
      let creditUsed = 0;
      if (existingCredit > 0) {
        creditUsed = Math.min(existingCredit, totalInvoiceBalance);
        const remainingCredit = existingCredit - creditUsed;
        await updateTenantCreditBalance(tx, tenantId, Math.max(0, remainingCredit));
        console.log(`Applied ${creditUsed} from existing credit, remaining: ${Math.max(0, remainingCredit)}`);
      }

      // Build notes with payment details for proper tracking
      const paymentNotes = [];
      if (notes) paymentNotes.push(notes);
      if (creditUsed > 0) paymentNotes.push(`Applied Ksh ${creditUsed.toFixed(2)} from credit balance`);
      if (overpaymentAmount > 0) paymentNotes.push(`Overpayment: Ksh ${overpaymentAmount.toFixed(2)}`);

      // Create PaymentReport for current payment
      const report = await tx.paymentReport.create({
        data: {
          tenantId,
          rent: invoicesToProcess.reduce((sum, inv) => sum + inv.rent, 0),
          serviceCharge: invoicesToProcess.reduce((sum, inv) => sum + (inv.serviceCharge || 0), 0),
          vat: invoicesToProcess.reduce((sum, inv) => sum + (inv.vat || 0), 0),
          totalDue: invoicesToProcess.reduce((sum, inv) => sum + inv.totalDue, 0),
          amountPaid: totalAvailable, // Total cash + credit applied
          arrears: Math.max(0, totalInvoiceBalance - totalAvailable),
          status: totalAvailable >= totalInvoiceBalance ? 'PAID' : 
                  totalAvailable > 0 ? 'PARTIAL' : 'UNPAID',
          paymentPeriod: paymentPeriodDate || new Date(),
          datePaid: new Date(),
          notes: paymentNotes.join('. ') || null,
          receiptUrl: null // Will be updated after transaction
        }
      });

      // Update existing invoices for the same period if flag is true and no specific invoices selected
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
        
        // Add auto-updated invoices to the results
        if (invoiceUpdateResult.updatedInvoices.length > 0) {
          updatedInvoices.push(...invoiceUpdateResult.updatedInvoices.map(inv => ({
            ...inv,
            wasAutoPaid: true,
            selectionType: 'AUTO_PERIOD_MATCH'
          })));
        }
        
        // Update remaining payment
        remainingPayment = invoiceUpdateResult.remainingPayment;
        
        console.log(`Auto-updated ${invoiceUpdateResult.updatedInvoices.length} invoices for period ${paymentPeriodStr}, applied ${invoiceUpdateResult.totalApplied}`);
      } else {
        // If specific invoices selected or updateExistingInvoices is false, start with full available amount
        remainingPayment = totalAvailable;
      }

      // Handle overpayment with FIFO allocation
      let overpaymentRecords = [];
      let remainingOverpayment = overpaymentAmount;
      
      if (overpaymentAmount > 0 && handleOverpayment) {
        console.log(`Handling overpayment of ${overpaymentAmount} with FIFO allocation`);
        
        // First, allocate overpayment to other unpaid invoices (not in the current processing list)
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

        // Allocate overpayment to other unpaid invoices first
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

            // Add to updated invoices for response
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

        // If still have overpayment, create prepaid future periods
        if (remainingOverpayment > 0) {
          const monthlyRent = tenant.rent;
          const { months, remainder } = calculateCoveredPeriods(remainingOverpayment, monthlyRent, paymentPolicy);
          
          let futureDate = new Date(paymentPeriodDate || new Date());
          const coveredMonths = months > 0 ? months : 0;
          
          for (let i = 1; i <= coveredMonths; i++) {
            switch (paymentPolicy) {
              case 'QUARTERLY':
                futureDate.setMonth(futureDate.getMonth() + 3);
                break;
              case 'ANNUAL':
                futureDate.setFullYear(futureDate.getFullYear() + 1);
                break;
              case 'MONTHLY':
              default:
                futureDate.setMonth(futureDate.getMonth() + 1);
                break;
            }
            
            const expected = await computeExpectedCharges(tenantId, futureDate);
            
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
                paymentPeriod: futureDate,
                datePaid: new Date(),
                notes: `Covered by overpayment from ${paymentPeriodStr}. Original payment: ${parsedAmountPaid}`
              }
            });
            
            overpaymentRecords.push({
              type: 'PREPAID_PERIOD',
              period: futureDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
              reportId: futureReport.id,
              amountCovered: expected.totalDue,
              commissionApplicable: false
            });
          }
          
          // Store remainder as credit balance
          if (remainder > 0) {
            await updateTenantCreditBalance(tx, tenantId, remainder);
            overpaymentRecords.push({
              type: 'CREDIT_BALANCE',
              amount: remainder,
              commissionApplicable: false
            });
          }
          
          console.log(`Created ${coveredMonths} prepaid records, credit balance: ${remainder}`);
        }
      }

      // Apply payment to selected/oldest invoices (if not already processed by updateExistingInvoicesForPayment)
      for (const invoice of invoicesToProcess) {
        if (remainingPayment <= 0) break;
        
        // Check if this invoice was already updated by updateExistingInvoicesForPayment
        const alreadyUpdated = invoiceUpdateResult?.updatedInvoices?.find(
          ui => ui.id === invoice.id
        );
        
        if (alreadyUpdated) {
          // Skip, already updated
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

      // Create Income record - FIXED: Using relation connect syntax
      const income = await tx.income.create({
        data: {
          property: {
            connect: { id: tenant.unit.propertyId }
          },
          tenant: {
            connect: { id: tenantId }
          },
          amount: parsedAmountPaid, // Actual cash payment received
          frequency: frequency
        }
      });

      // Process commission
      let commission = null;
      if (tenant.unit?.property?.commissionFee && tenant.unit?.property?.commissionFee > 0 && commissionBaseAmount > 0) {
        
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
            managerId: tenant.unit.property.managerId,
            commissionFee: tenant.unit.property.commissionFee,
            incomeAmount: vatExclusiveCommissionBase,
            originalIncomeAmount: parsedAmountPaid,
            commissionAmount: commissionAmount,
            periodStart: periodStart,
            periodEnd: periodEnd,
            status: 'PENDING',
            notes: `VAT Type: ${tenantVatType}, VAT Rate: ${tenantVatRate}%, Commission calculated on current period only. Credit used: ${creditUsed}`
          }
        });
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

    // 5. Generate receipt AFTER successful transaction
    let receiptResult = null;
    try {
      // Fetch fresh invoice data for receipt generation
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

      // Update payment report with receipt URL
      await prisma.paymentReport.update({
        where: { id: transactionResult.report.id },
        data: { receiptUrl: receiptResult.receiptUrl }
      });

      console.log(`Receipt generated successfully: ${receiptResult.receiptNumber}`);
    } catch (receiptError) {
      console.error('Failed to generate receipt (non-critical):', receiptError);
      // Don't fail the payment if receipt generation fails
    }

    // 6. Format response
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
        (receiptResult ? ' (Receipt generated)' : '')
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

// Helper function to update existing invoices when payment is made
async function updateExistingInvoicesForPayment(tx, tenantId, paymentPeriodStr, parsedAmountPaid, paymentReportId, periodStartDate, paymentStatus) {
  try {
    // Find all unpaid/partial invoices for this tenant in the same payment period
    const existingInvoices = await tx.invoice.findMany({
      where: {
        tenantId,
        paymentPeriod: paymentPeriodStr,
        status: {
          in: ['UNPAID', 'PARTIAL', 'OVERDUE']
        },
        paymentReportId: null // Only invoices not already linked to a payment report
      },
      orderBy: {
        dueDate: 'asc' // Pay oldest first
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

    // Apply payment to existing invoices
    for (const invoice of existingInvoices) {
      if (remainingPayment <= 0) break;

      // Check if invoice is for the same period (based on paymentPeriod string)
      if (invoice.paymentPeriod === paymentPeriodStr) {
        if (invoice.balance > 0) {
          const paymentToApply = Math.min(invoice.balance, remainingPayment);
          const newAmountPaid = invoice.amountPaid + paymentToApply;
          const newBalance = invoice.balance - paymentToApply;
          
          // Determine new status
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
              paymentReportId: paymentReportId, // Link to current payment report
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

    // If payment status is PAID, ensure all invoices for this period are marked as PAID
    if (paymentStatus === 'PAID' && updatedInvoices.length > 0 && remainingPayment > 0) {
      // Find any remaining unpaid invoices for this period
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

      // Mark all remaining invoices as PAID
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

// @desc    Get income reports (with basic filtering)
// @route   GET /api/payments/income
// @access  Private
export const getIncomeReports = async (req, res) => {
  try {
    const { propertyId, tenantId, dateFrom, dateTo, page = 1, limit = 10 } = req.query;
    const { skip, limit: take } = getPaginationParams(req.query);

    const where = {};

    if (propertyId) where.propertyId = propertyId;
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
    const { propertyId, tenantId, amount, frequency } = req.body;

    if (!propertyId && !tenantId) {
      return res.status(400).json({ success: false, message: 'Either propertyId or tenantId is required' });
    }
    if (amount == null || isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: 'Valid non-negative amount is required' });
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
// @access  Private
export const previewPayment = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { includeCredit = true } = req.query;
    
    const preview = await computeExpectedCharges(tenantId);
    
    // Check for existing credit balance
    let creditBalance = 0;
    if (includeCredit) {
      creditBalance = await getTenantCreditBalance(prisma, tenantId);
    }
    
    res.json({ 
      success: true, 
      data: {
        ...preview,
        existingCredit: creditBalance,
        totalAvailable: preview.totalDue + creditBalance
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update payment report (with income/commission updates)
// @route   PUT /api/payments/:id
// @access  Private (ADMIN, MANAGER)
export const updatePaymentReportWithIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountPaid, paymentPeriod, notes } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Find existing payment report
      const existingReport = await tx.paymentReport.findUnique({
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
        throw new Error('Payment report not found');
      }

      // Validate amountPaid if provided
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

      // Recalculate expected charges if payment period changes
      let expected = {
        rent: existingReport.rent,
        serviceCharge: existingReport.serviceCharge,
        vat: existingReport.vat,
        vatType: existingReport.tenant.vatType,
        vatRate: existingReport.tenant.vatRate,
        totalDue: existingReport.totalDue,
        periodStart: existingReport.paymentPeriod,
        periodEnd: new Date(new Date(existingReport.paymentPeriod).getFullYear(), new Date(existingReport.paymentPeriod).getMonth() + 1, 0)
      };

      if (paymentPeriod) {
        expected = await computeExpectedCharges(
          existingReport.tenant,
          paymentPeriod
        );
      }

      // Calculate arrears and status
      const arrears = parseFloat((expected.totalDue - parsedAmountPaid).toFixed(2));
      const status = parsedAmountPaid >= expected.totalDue
        ? 'PAID'
        : parsedAmountPaid > 0
          ? 'PARTIAL'
          : 'UNPAID';

      // Update payment report
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
        }
      });

      // Update existing rent invoice if it exists
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

      // Update related income record if it exists
      const income = await tx.income.findFirst({
        where: {
          tenantId: existingReport.tenant,
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

        // Re-process commission if income was updated
        if (updatedIncome) {
          await processCommissionForIncome(tx, updatedIncome.id);
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

// @desc    Get arrears for a property
// @route   GET /api/payments/arrears/:propertyId
// @access  Private
export async function getPropertyArrears(req, res) {
  try {
    const { propertyId } = req.params;

    if (!propertyId) {
      return res.status(400).json({ error: 'Property ID is required' });
    }

    // Fetch all units with their tenants for this property
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
            // Get unpaid/partial invoices
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
            // Get unpaid/partial bill invoices
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
            // Get payment reports for calculation
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

    // Process arrears data
    const arrearsData = [];

    for (const unit of units) {
      if (!unit.tenant) continue;

      const tenant = unit.tenant;
      
      // Check for credit balance
      const creditBalance = await getTenantCreditBalance(prisma, tenant.id);
      
      // Process rent invoices (unpaid/partial)
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

      // Process bill invoices (unpaid/partial)
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

      // Calculate current rent arrears (for the current period if no invoice exists yet)
      const expectedMonthlyRent = tenant.rent;
      
      // Calculate service charge if applicable
      let serviceChargeAmount = 0;
      if (tenant.serviceCharge) {
        if (tenant.serviceCharge.type === 'PERCENTAGE') {
          serviceChargeAmount = (expectedMonthlyRent * tenant.serviceCharge.percentage) / 100;
        } else if (tenant.serviceCharge.type === 'FIXED') {
          serviceChargeAmount = tenant.serviceCharge.fixedAmount || 0;
        } else if (tenant.serviceCharge.type === 'PER_SQ_FT') {
          serviceChargeAmount = (unit.sizeSqFt || 0) * (tenant.serviceCharge.perSqFtRate || 0);
        }
      }

      const totalExpectedAmount = expectedMonthlyRent + serviceChargeAmount;

      // Calculate total paid from payment reports for current period
      const currentPeriodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const currentPeriodPaid = tenant.paymentReports
        .filter(report => new Date(report.paymentPeriod) >= currentPeriodStart && report.status !== 'CREDIT' && report.status !== 'PREPAID')
        .reduce((sum, report) => sum + report.amountPaid, 0);

      const currentRentBalance = totalExpectedAmount - currentPeriodPaid - creditBalance;

      // Only add current rent arrears if there's a balance AND no existing invoice for current period
      const currentPeriodInvoiceExists = tenant.invoices.some(invoice => {
        const invoicePeriod = new Date(invoice.paymentPeriod);
        return invoicePeriod >= currentPeriodStart && invoice.balance > 0;
      });

      if (currentRentBalance > 0 && !currentPeriodInvoiceExists) {
        arrearsData.push({
          id: `current-rent-${tenant.id}`,
          tenantId: tenant.id,
          tenantName: tenant.fullName,
          tenantContact: tenant.contact,
          unitType: unit.type || 'Unit',
          unitNo: unit.unitNo || 'N/A',
          floor: unit.floor || 'N/A',
          invoiceNumber: `PENDING-RENT-${tenant.id.substring(0, 8).toUpperCase()}`,
          invoiceType: 'RENT',
          expectedAmount: totalExpectedAmount,
          paidAmount: currentPeriodPaid,
          balance: currentRentBalance,
          dueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
          status: currentPeriodPaid > 0 ? 'PARTIAL' : 'UNPAID',
          description: `Current period rent for ${unit.property.name}`,
          isPendingInvoice: true,
          hasCreditBalance: creditBalance > 0,
          creditBalance: creditBalance
        });
      }
    }

    // Sort by due date (oldest first) then by balance (highest first)
    arrearsData.sort((a, b) => {
      const dateDiff = new Date(a.dueDate) - new Date(b.dueDate);
      if (dateDiff !== 0) return dateDiff;
      return b.balance - a.balance;
    });

    // Calculate totals
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

// @desc    Download payment receipt PDF
// @route   GET /api/payments/:id/receipt
// @access  Private
export const downloadPaymentReceipt = async (req, res) => {
  try {
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

    // Check if receipt exists
    if (!paymentReport.receiptUrl) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found for this payment. It may still be generating or failed to generate.'
      });
    }

    // Construct full file path from receiptUrl
    // receiptUrl format: /uploads/receipts/RCP-xxx.pdf
    const fileName = path.basename(paymentReport.receiptUrl);
    const filePath = path.join(process.cwd(), 'uploads', 'receipts', fileName);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Receipt file not found on server. It may have been deleted or moved.'
      });
    }

    // Read and send the file
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

// @desc    Delete payment report with comprehensive cleanup
// @route   DELETE /api/payments/:id
// @access  Private (Admin only)
export const deletePaymentReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      deleteLinkedInvoices = false,
      deleteBillInvoices = false,
      deleteIncome = false,
      force = false 
    } = req.body;
    
    // Find payment report with all related data
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
    
    // Safety check: prevent deletion of old records without force flag
    const reportAge = Date.now() - new Date(paymentReport.createdAt).getTime();
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
    
    if (!force && reportAge > maxAge) {
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
    
    // Start transaction for cleanup
    await prisma.$transaction(async (tx) => {
      // 1. Delete receipt PDF from storage if exists
      if (paymentReport.receiptUrl) {
        try {
          await deleteFromStorage(paymentReport.receiptUrl);
          result.deletedReceipt = true;
          console.log(`Deleted receipt PDF: ${paymentReport.receiptUrl}`);
        } catch (error) {
          console.warn('Failed to delete receipt PDF:', error);
        }
      }
      
      // 2. Handle linked rent invoices
      if (paymentReport.invoices.length > 0) {
        if (deleteLinkedInvoices) {
          // Delete all linked invoices and their PDFs
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
          // Just unlink invoices
          await tx.invoice.updateMany({
            where: { paymentReportId: paymentReport.id },
            data: { paymentReportId: null }
          });
          result.unlinkCount = paymentReport.invoices.length;
        }
      }
      
      // 3. Handle linked bill invoices
      if (paymentReport.billInvoices.length > 0) {
        if (deleteBillInvoices) {
          // Delete all linked bill invoices and their PDFs
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
          // Just unlink bill invoices
          await tx.billInvoice.updateMany({
            where: { paymentReportId: paymentReport.id },
            data: { paymentReportId: null }
          });
          result.unlinkCount += paymentReport.billInvoices.length;
        }
      }
      
      // 4. Handle related income record
      if (deleteIncome) {
        // Find income records created for this payment
        const relatedIncome = await tx.income.findFirst({
          where: {
            tenantId: paymentReport.tenantId,
            createdAt: {
              gte: new Date(paymentReport.datePaid.getTime() - 60000), // Within 1 minute
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
      
      // 5. Delete the payment report
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

