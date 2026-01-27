import prisma from "../lib/prisma.js";
import { processCommissionForIncome } from '../services/commissionService.js';
import { generateInvoiceNumber, generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';

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
        },
        billInvoices: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,
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
        },
        billInvoices: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,
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
    const { includeBills = true } = req.query;

    // Get unpaid/partial rent invoices
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

    let billInvoices = [];
    if (includeBills) {
      // Get unpaid/partial bill invoices
      billInvoices = await prisma.billInvoice.findMany({
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
          billType: true,
          billReferenceNumber: true,
          grandTotal: true,
          amountPaid: true,
          balance: true,
          status: true,
          pdfUrl: true
        }
      });
    }

    // Calculate totals
    const totalRentBalance = rentInvoices.reduce((sum, inv) => sum + inv.balance, 0);
    const totalBillBalance = billInvoices.reduce((sum, bi) => sum + bi.balance, 0);
    const totalOutstanding = totalRentBalance + totalBillBalance;

    res.json({
      success: true,
      data: {
        rentInvoices,
        billInvoices,
        totals: {
          totalRentBalance,
          totalBillBalance,
          totalOutstanding,
          invoiceCount: rentInvoices.length,
          billInvoiceCount: billInvoices.length
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

// @desc    Create payment report (Invoice-based)
// @route   POST /api/payments
// @access  Private (ADMIN, MANAGER)
export const createPaymentReport = async (req, res) => {
  let transactionResult = null;
  
  try {
    const { 
      tenantId, 
      amountPaid,
      invoiceIds = [], // Array of invoice IDs being paid
      billInvoiceIds = [], // Array of bill invoice IDs being paid
      notes,
      paymentPeriod,
      autoGenerateBalanceInvoice = false,
      createMissingInvoices = false,
      updateExistingInvoices = true // NEW: Flag to update existing invoices
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

    // 2. Process invoices being paid
    let invoicesToProcess = [];
    let billInvoicesToProcess = [];
    let totalInvoiceBalance = 0;
    let paymentPolicy = tenant.paymentPolicy; // Default to tenant's policy
    let paymentPeriodStr = paymentPeriodDate ? 
      paymentPeriodDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 
      new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    // If invoiceIds provided, fetch those specific invoices
    if (invoiceIds && invoiceIds.length > 0) {
      invoicesToProcess = await prisma.invoice.findMany({
        where: {
          id: { in: invoiceIds },
          tenantId: tenantId,
          status: {
            in: ['UNPAID', 'PARTIAL', 'OVERDUE']
          }
        },
        orderBy: { dueDate: 'asc' } // Pay oldest first
      });

      if (invoicesToProcess.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No unpaid/partial invoices found for the provided IDs'
        });
      }

      // Calculate total balance from selected invoices
      totalInvoiceBalance = invoicesToProcess.reduce((sum, inv) => sum + inv.balance, 0);
      
      // Use payment policy from first invoice if available
      paymentPolicy = invoicesToProcess[0].paymentPolicy || tenant.paymentPolicy;
      paymentPeriodStr = invoicesToProcess[0].paymentPeriod || paymentPeriodStr;
      
      console.log(`Processing ${invoicesToProcess.length} invoices with total balance: ${totalInvoiceBalance}`);
    }

    // If billInvoiceIds provided, fetch those specific bill invoices
    if (billInvoiceIds && billInvoiceIds.length > 0) {
      billInvoicesToProcess = await prisma.billInvoice.findMany({
        where: {
          id: { in: billInvoiceIds },
          tenantId: tenantId,
          status: {
            in: ['UNPAID', 'PARTIAL', 'OVERDUE']
          }
        },
        orderBy: { dueDate: 'asc' }
      });

      const totalBillInvoiceBalance = billInvoicesToProcess.reduce((sum, bi) => sum + bi.balance, 0);
      totalInvoiceBalance += totalBillInvoiceBalance;
      
      console.log(`Processing ${billInvoicesToProcess.length} bill invoices with total balance: ${totalBillInvoiceBalance}`);
    }

    // If no specific invoices provided and createMissingInvoices is true, create new invoice
    if (invoiceIds.length === 0 && billInvoiceIds.length === 0 && createMissingInvoices) {
      const expected = await computeExpectedCharges(
        tenantId,
        paymentPeriodDate
      );
      
      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber();
      
      // Create invoice for current period
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
    }

    // 3. Validate payment amount
    if (parsedAmountPaid > totalInvoiceBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (${parsedAmountPaid}) exceeds total invoice balance (${totalInvoiceBalance})`,
        data: {
          totalInvoiceBalance,
          paymentAmount: parsedAmountPaid,
          difference: parsedAmountPaid - totalInvoiceBalance
        }
      });
    }

    // 4. Calculate frequency based on payment policy
    let frequency = 'MONTHLY'; // Default
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

    // 5. Process payment in transaction with increased timeout
    transactionResult = await prisma.$transaction(async (tx) => {
      // Create PaymentReport
      const report = await tx.paymentReport.create({
        data: {
          tenantId,
          rent: invoicesToProcess.reduce((sum, inv) => sum + inv.rent, 0),
          serviceCharge: invoicesToProcess.reduce((sum, inv) => sum + (inv.serviceCharge || 0), 0),
          vat: invoicesToProcess.reduce((sum, inv) => sum + (inv.vat || 0), 0),
          totalDue: invoicesToProcess.reduce((sum, inv) => sum + inv.totalDue, 0),
          amountPaid: parsedAmountPaid,
          arrears: Math.max(0, totalInvoiceBalance - parsedAmountPaid),
          status: parsedAmountPaid >= totalInvoiceBalance ? 'PAID' : 
                  parsedAmountPaid > 0 ? 'PARTIAL' : 'UNPAID',
          paymentPeriod: paymentPeriodDate || new Date(),
          datePaid: new Date(),
          notes: notes || null
        }
      });

      // NEW: Update existing invoices if flag is true
      let invoiceUpdateResult = null;
      if (updateExistingInvoices && (parsedAmountPaid > 0)) {
        invoiceUpdateResult = await updateExistingInvoicesForPayment(
          tx,
          tenantId,
          paymentPeriodStr,
          parsedAmountPaid,
          report.id,
          paymentPeriodDate || new Date(),
          parsedAmountPaid >= totalInvoiceBalance ? 'PAID' : 
            parsedAmountPaid > 0 ? 'PARTIAL' : 'UNPAID'
        );
        
        console.log(`Updated ${invoiceUpdateResult.updatedInvoices.length} existing invoices, applied ${invoiceUpdateResult.totalApplied} to existing invoices`);
      }

      // Apply payment to invoices (if any remaining payment after updating existing invoices)
      let remainingPayment = invoiceUpdateResult ? 
        (parsedAmountPaid - invoiceUpdateResult.totalApplied) : 
        parsedAmountPaid;
      
      const updatedInvoices = [];
      const updatedBillInvoices = [];

      // Process specified rent invoices (if payment still remaining)
      for (const invoice of invoicesToProcess) {
        if (remainingPayment <= 0) break;
        
        // Check if this invoice was already updated by updateExistingInvoicesForPayment
        const alreadyUpdated = invoiceUpdateResult?.updatedInvoices?.find(
          ui => ui.id === invoice.id
        );
        
        if (alreadyUpdated) {
          // Skip, already updated
          updatedInvoices.push({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            ...alreadyUpdated
          });
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

        updatedInvoices.push(updatedInvoice);
        remainingPayment -= paymentToApply;
      }

      // Process specified bill invoices
      for (const billInvoice of billInvoicesToProcess) {
        if (remainingPayment <= 0) break;
        
        const paymentToApply = Math.min(billInvoice.balance, remainingPayment);
        const newAmountPaid = billInvoice.amountPaid + paymentToApply;
        const newBalance = billInvoice.balance - paymentToApply;
        
        let newStatus = billInvoice.status;
        if (newBalance <= 0) {
          newStatus = 'PAID';
        } else if (paymentToApply > 0) {
          newStatus = 'PARTIAL';
        }

        const updatedBillInvoice = await tx.billInvoice.update({
          where: { id: billInvoice.id },
          data: {
            amountPaid: newAmountPaid,
            balance: newBalance,
            status: newStatus,
            paymentReportId: report.id,
            updatedAt: new Date()
          }
        });

        updatedBillInvoices.push(updatedBillInvoice);
        remainingPayment -= paymentToApply;
      }

      // Create Income record
      const income = await tx.income.create({
        data: {
          propertyId: tenant.unit.propertyId,
          tenantId,
          amount: parsedAmountPaid,
          frequency: frequency // Use calculated frequency
        }
      });

      // Auto-generate balance invoice for partial payments if requested
      let balanceInvoice = null;
      const finalRemainingBalance = totalInvoiceBalance - (parsedAmountPaid - (invoiceUpdateResult?.totalApplied || 0));
      
      if (autoGenerateBalanceInvoice && finalRemainingBalance > 0) {
        const balanceInvoiceNumber = await generateInvoiceNumber();
        
        // Use the first invoice as template for balance invoice
        const templateInvoice = invoicesToProcess.length > 0 ? invoicesToProcess[0] : null;
        
        if (templateInvoice) {
          balanceInvoice = await tx.invoice.create({
            data: {
              invoiceNumber: balanceInvoiceNumber,
              tenantId,
              paymentReportId: report.id,
              issueDate: new Date(),
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
              paymentPeriod: templateInvoice.paymentPeriod,
              rent: templateInvoice.rent,
              serviceCharge: templateInvoice.serviceCharge,
              vat: templateInvoice.vat,
              totalDue: finalRemainingBalance,
              amountPaid: 0,
              balance: finalRemainingBalance,
              status: 'UNPAID',
              paymentPolicy: paymentPolicy,
              notes: `Balance invoice for partial payment of ${templateInvoice.paymentPeriod}`
            }
          });
        }
      }

      // Process commission INSIDE transaction but simplified
      let commission = null;
      if (tenant.unit?.property?.commissionFee && tenant.unit?.property?.commissionFee > 0) {
        const commissionAmount = (parsedAmountPaid * tenant.unit.property.commissionFee) / 100;
        
        // Determine period based on payment frequency
        const periodStart = new Date();
        let periodEnd = new Date();
        
        switch (frequency) {
          case 'QUARTERLY':
            periodEnd.setMonth(periodEnd.getMonth() + 3);
            break;
          case 'ANNUAL':
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            break;
          case 'MONTHLY':
          default:
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            break;
        }

        commission = await tx.managerCommission.create({
          data: {
            propertyId: tenant.unit.propertyId,
            managerId: tenant.unit.property.managerId,
            commissionFee: tenant.unit.property.commissionFee,
            incomeAmount: parsedAmountPaid,
            commissionAmount: commissionAmount,
            periodStart: periodStart,
            periodEnd: periodEnd,
            status: 'PENDING'
          }
        });
      }

      return {
        report,
        income,
        commission,
        updatedInvoices: [
          ...(invoiceUpdateResult?.updatedInvoices || []),
          ...updatedInvoices
        ],
        updatedBillInvoices,
        balanceInvoice,
        invoiceUpdateResult,
        tenant
      };
    }, {
      // Increased transaction timeout
      maxWait: 20000,
      timeout: 60000,
    });

    // 7. Format response
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
          notes: transactionResult.report.notes
        },
        income: {
          id: transactionResult.income.id,
          propertyId: transactionResult.income.propertyId,
          amount: transactionResult.income.amount,
          frequency: transactionResult.income.frequency
        },
        invoices: transactionResult.updatedInvoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          previousBalance: inv.previousBalance,
          paymentApplied: inv.paymentApplied,
          newAmountPaid: inv.newAmountPaid || inv.amountPaid,
          newBalance: inv.newBalance || inv.balance,
          newStatus: inv.newStatus || inv.status,
          previousStatus: inv.previousStatus,
          wasAutoPaid: inv.wasAutoPaid || false,
          paymentPolicy: inv.paymentPolicy
        })),
        billInvoices: transactionResult.updatedBillInvoices.map(bi => ({
          id: bi.id,
          invoiceNumber: bi.invoiceNumber,
          amountPaid: bi.amountPaid,
          balance: bi.balance,
          status: bi.status
        })),
        balanceInvoice: transactionResult.balanceInvoice ? {
          id: transactionResult.balanceInvoice.id,
          invoiceNumber: transactionResult.balanceInvoice.invoiceNumber,
          amountDue: transactionResult.balanceInvoice.totalDue,
          paymentPolicy: transactionResult.balanceInvoice.paymentPolicy
        } : null,
        existingInvoicesUpdated: transactionResult.invoiceUpdateResult ? {
          count: transactionResult.invoiceUpdateResult.updatedInvoices.length,
          totalApplied: transactionResult.invoiceUpdateResult.totalApplied,
          remainingPayment: transactionResult.invoiceUpdateResult.remainingPayment
        } : null,
        commission: transactionResult.commission ? {
          id: transactionResult.commission.id,
          commissionAmount: transactionResult.commission.commissionAmount,
          status: transactionResult.commission.status
        } : null
      },
      message: 'Payment recorded successfully' + 
        (transactionResult.invoiceUpdateResult ? 
          ` (${transactionResult.invoiceUpdateResult.totalApplied} applied to existing invoices)` : 
          '') +
        (transactionResult.commission ? ' with commission' : '')
    });

  } catch (error) {
    console.error('Error creating payment report:', error);
    
    // Check if we have partial transaction data
    if (transactionResult) {
      console.warn('Transaction partially completed:', transactionResult);
    }
    
    if (error.code === 'P2028') {
      return res.status(408).json({ 
        success: false, 
        message: 'Transaction timeout. The operation took too long to complete. Please try again or contact support.' 
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
      message: error.message || 'Failed to create payment report' 
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
            paymentPolicy: invoice.paymentPolicy
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
    const preview = await computeExpectedCharges(tenantId);
    res.json({ success: true, data: preview });
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
    const { amountPaid, paymentPeriod, notes, billIds } = req.body;

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
          billInvoices: true,
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
          },
          billInvoices: {
            select: {
              id: true,
              invoiceNumber: true,
              grandTotal: true,
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

      // Create new bill invoices if bill IDs provided
      let newBillInvoices = [];
      if (billIds && Array.isArray(billIds) && billIds.length > 0) {
        const bills = await tx.bill.findMany({
          where: {
            id: { in: billIds },
            tenantId: existingReport.tenantId
          }
        });

        for (const bill of bills) {
          const billInvoiceNumber = await generateBillInvoiceNumber();
          const issueDate = new Date();
          const dueDate = bill.dueDate || new Date(issueDate.setDate(issueDate.getDate() + 30));

          const billBalance = parseFloat((bill.grandTotal - bill.amountPaid).toFixed(2));
          const billStatus = bill.amountPaid >= bill.grandTotal
            ? 'PAID'
            : bill.amountPaid > 0
              ? 'PARTIAL'
              : 'UNPAID';

          const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;

          const billInvoice = await tx.billInvoice.create({
            data: {
              invoiceNumber: billInvoiceNumber,
              billId: bill.id,
              billReferenceNumber,
              billReferenceDate: bill.issuedAt,
              tenantId: existingReport.tenantId,
              paymentReportId: updatedReport.id,
              issueDate: new Date(),
              dueDate,
              billType: bill.type,
              previousReading: bill.previousReading,
              currentReading: bill.currentReading,
              units: bill.units,
              chargePerUnit: bill.chargePerUnit,
              totalAmount: bill.totalAmount,
              vatRate: bill.vatRate,
              vatAmount: bill.vatAmount,
              grandTotal: bill.grandTotal,
              amountPaid: bill.amountPaid,
              balance: billBalance,
              status: billStatus,
              notes: notes || null
            }
          });

          newBillInvoices.push(billInvoice);
        }
      }

      return { updatedReport, updatedIncome, newBillInvoices };
    });

    res.json({
      success: true,
      data: result.updatedReport,
      income: result.updatedIncome,
      newBillInvoices: result.newBillInvoices.map(bi => ({
        id: bi.id,
        invoiceNumber: bi.invoiceNumber,
        issueDate: bi.issueDate,
        dueDate: bi.dueDate,
        billType: bi.billType,
        grandTotal: bi.grandTotal,
        status: bi.status
      })),
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
            invoiceNumber: invoice.invoiceNumber, // Use actual invoice number
            invoiceType: 'RENT',
            expectedAmount: invoice.totalDue,
            paidAmount: invoice.amountPaid,
            balance: invoice.balance,
            dueDate: invoice.dueDate,
            status: invoice.status,
            description: `Rent for ${unit.property.name} - ${unit.type || 'Unit'} ${unit.unitNo || ''}`,
            invoiceId: invoice.id,
            paymentPeriod: invoice.paymentPeriod
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
            invoiceNumber: billInvoice.invoiceNumber, // Use actual bill invoice number
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
        .filter(report => new Date(report.paymentPeriod) >= currentPeriodStart)
        .reduce((sum, report) => sum + report.amountPaid, 0);

      const currentRentBalance = totalExpectedAmount - currentPeriodPaid;

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
          invoiceNumber: `PENDING-RENT-${tenant.id.substring(0, 8).toUpperCase()}`, // Placeholder for pending invoice
          invoiceType: 'RENT',
          expectedAmount: totalExpectedAmount,
          paidAmount: currentPeriodPaid,
          balance: currentRentBalance,
          dueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), // 1st of next month
          status: currentPeriodPaid > 0 ? 'PARTIAL' : 'UNPAID',
          description: `Current period rent for ${unit.property.name}`,
          isPendingInvoice: true
        });
      }
    }

    // Sort by due date (oldest first) then by balance (highest first)
    arrearsData.sort((a, b) => {
      // First sort by due date (oldest first)
      const dateDiff = new Date(a.dueDate) - new Date(b.dueDate);
      if (dateDiff !== 0) return dateDiff;
      
      // Then by balance (highest first)
      return b.balance - a.balance;
    });

    // Calculate totals
    const totalArrears = arrearsData.reduce((sum, item) => sum + item.balance, 0);
    const totalExpected = arrearsData.reduce((sum, item) => sum + item.expectedAmount, 0);
    const totalPaid = arrearsData.reduce((sum, item) => sum + item.paidAmount, 0);

    return res.status(200).json({
      success: true,
      data: {
        arrears: arrearsData,
        summary: {
          totalArrears,
          totalExpected,
          totalPaid,
          itemCount: arrearsData.length,
          pendingInvoicesCount: arrearsData.filter(item => item.isPendingInvoice).length
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