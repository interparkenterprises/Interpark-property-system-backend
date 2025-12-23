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
  
  if (tenant.vatType === 'EXCLUSIVE') {
    // VAT is added on top of rent + service charge
    vat = baseAmount * (tenant.vatRate || 0) / 100;
  } else if (tenant.vatType === 'INCLUSIVE') {
    // VAT is already included in the rent amount
    // Extract VAT from the inclusive amount: VAT = Amount × (VAT Rate / (100 + VAT Rate))
    const vatRate = tenant.vatRate || 0;
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

// @desc    Create payment report
// @route   POST /api/payments
// @access  Private (ADMIN, MANAGER)
export const createPaymentReport = async (req, res) => {
  try {
    const { 
      tenantId, 
      amountPaid, 
      paymentPeriod, 
      notes, 
      billIds, // Changed from billInvoiceIds to billIds (Bill IDs, not BillInvoice IDs)
      createRentInvoice = true,
      rentInvoiceDueDate,
      autoGenerateBalanceInvoice = false // NEW: Flag for balance invoice generation
    } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }
    if (amountPaid == null || isNaN(amountPaid)) {
      return res.status(400).json({ success: false, message: 'Valid amountPaid is required' });
    }

    const parsedAmountPaid = parseFloat(amountPaid);
    if (parsedAmountPaid < 0) {
      return res.status(400).json({ success: false, message: 'amountPaid cannot be negative' });
    }

    // Fetch tenant + property
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: {
              select: { id: true, name: true, managerId: true }
            }
          }
        }
      }
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    if (!tenant.unit?.propertyId) {
      return res.status(400).json({ success: false, message: 'Tenant must be assigned to a unit with a property' });
    }

    // Compute expected charges with VAT
    const expected = await computeExpectedCharges(
      tenantId,
      paymentPeriod ? new Date(paymentPeriod) : null
    );

    const arrears = parseFloat((expected.totalDue - parsedAmountPaid).toFixed(2));
    const status = parsedAmountPaid >= expected.totalDue
      ? 'PAID'
      : parsedAmountPaid > 0
        ? 'PARTIAL'
        : 'UNPAID';

    // Transaction: PaymentReport + Income + Commission + Invoices + BillInvoices
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create PaymentReport
      const report = await tx.paymentReport.create({
        data: {
          tenantId,
          rent: expected.rent,
          serviceCharge: expected.serviceCharge,
          vat: expected.vat,
          totalDue: expected.totalDue,
          amountPaid: parsedAmountPaid,
          arrears,
          status,
          paymentPeriod: expected.periodStart,
          datePaid: new Date(),
          notes: notes || null
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
          }
        }
      });

      // 2. Create Rent Invoice if requested
      let rentInvoice = null;
      if (createRentInvoice) {
        const invoiceNumber = await generateInvoiceNumber();
        const issueDate = new Date();
        const dueDate = rentInvoiceDueDate ? new Date(rentInvoiceDueDate) : new Date(issueDate.setDate(issueDate.getDate() + 30));

        const paymentPeriodStr = expected.periodStart.toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric' 
        });

        const rentBalance = arrears > 0 ? arrears : 0;

        rentInvoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            tenantId,
            paymentReportId: report.id,
            issueDate: new Date(), // Current date
            dueDate,
            paymentPeriod: paymentPeriodStr,
            rent: expected.rent,
            serviceCharge: expected.serviceCharge || 0,
            vat: expected.vat || 0,
            totalDue: expected.totalDue,
            amountPaid: parsedAmountPaid,
            balance: rentBalance,
            status: status === 'PAID' ? 'PAID' : status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
            notes: notes || null
          }
        });
      }

      // 2.5 Auto-generate balance invoice if payment is partial (OPTIONAL)
      let balanceInvoice = null;
      if (status === 'PARTIAL' && arrears > 0 && autoGenerateBalanceInvoice) {
        const balanceInvoiceNumber = await generateInvoiceNumber();
        const balanceIssueDate = new Date();
        const balanceDueDate = rentInvoiceDueDate 
          ? new Date(rentInvoiceDueDate) 
          : new Date(balanceIssueDate.setDate(balanceIssueDate.getDate() + 30));

        const paymentPeriodStr = expected.periodStart.toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric' 
        });

        balanceInvoice = await tx.invoice.create({
          data: {
            invoiceNumber: balanceInvoiceNumber,
            tenantId,
            paymentReportId: report.id,
            issueDate: new Date(),
            dueDate: balanceDueDate,
            paymentPeriod: paymentPeriodStr,
            rent: expected.rent,
            serviceCharge: expected.serviceCharge || 0,
            vat: expected.vat || 0,
            totalDue: arrears, // Only the balance
            amountPaid: 0,
            balance: arrears,
            status: 'UNPAID',
            notes: `Balance invoice for partial payment of ${paymentPeriodStr}`
          }
        });
      }

      // 3. Create Income
      const income = await tx.income.create({
        data: {
          propertyId: tenant.unit.propertyId,
          tenantId,
          amount: parsedAmountPaid,
          frequency: 'MONTHLY'
        }
      });

      // 4. Create Bill Invoices if bill IDs provided
      let createdBillInvoices = [];
      if (billIds && Array.isArray(billIds) && billIds.length > 0) {
        // Fetch the bills to create invoices from
        const bills = await tx.bill.findMany({
          where: {
            id: { in: billIds },
            tenantId
          }
        });

        if (bills.length > 0) {
          // You can distribute payment or handle as needed
          // For now, we'll create invoices without payment distribution
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
                tenantId,
                paymentReportId: report.id,
                issueDate: new Date(), // Current date
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

            createdBillInvoices.push(billInvoice);
          }
        }
      }

      // 5. Process commission
      const commission = await processCommissionForIncome(tx, income.id);

      return { 
        report, 
        income, 
        commission, 
        rentInvoice, 
        billInvoices: createdBillInvoices,
        balanceInvoice // NEW: Include balance invoice in transaction result
      };
    });

    // Format response
    const formattedReport = {
      id: result.report.id,
      tenantId: result.report.tenant,
      rent: result.report.rent,
      serviceCharge: result.report.serviceCharge,
      vat: result.report.vat,
      vatType: result.report.tenant.vatType,
      vatRate: result.report.tenant.vatRate,
      totalDue: result.report.totalDue,
      amountPaid: result.report.amountPaid,
      arrears: result.report.arrears,
      status: result.report.status,
      paymentPeriod: result.report.paymentPeriod,
      datePaid: result.report.datePaid,
      notes: result.report.notes,
      createdAt: result.report.createdAt,
      updatedAt: result.report.updatedAt,
      tenant: {
        id: result.report.tenant.id,
        fullName: result.report.tenant.fullName,
        contact: result.report.tenant.contact,
        vatType: result.report.tenant.vatType,
        vatRate: result.report.tenant.vatRate,
        unit: {
          property: {
            id: result.report.tenant.unit.property.id,
            name: result.report.tenant.unit.property.name
          }
        }
      }
    };

    res.status(201).json({
      success: true,
      data: formattedReport,
      income: {
        id: result.income.id,
        propertyId: result.income.propertyId,
        tenantId: result.income.tenantId,
        amount: result.income.amount,
        frequency: result.income.frequency,
        createdAt: result.income.createdAt
      },
      rentInvoice: result.rentInvoice ? {
        id: result.rentInvoice.id,
        invoiceNumber: result.rentInvoice.invoiceNumber,
        issueDate: result.rentInvoice.issueDate,
        dueDate: result.rentInvoice.dueDate,
        paymentPeriod: result.rentInvoice.paymentPeriod,
        totalDue: result.rentInvoice.totalDue,
        amountPaid: result.rentInvoice.amountPaid,
        balance: result.rentInvoice.balance,
        status: result.rentInvoice.status
      } : null,
      balanceInvoice: result.balanceInvoice ? {  // NEW: Include balance invoice in response
        id: result.balanceInvoice.id,
        invoiceNumber: result.balanceInvoice.invoiceNumber,
        issueDate: result.balanceInvoice.issueDate,
        dueDate: result.balanceInvoice.dueDate,
        totalDue: result.balanceInvoice.totalDue,
        balance: result.balanceInvoice.balance,
        status: result.balanceInvoice.status
      } : null,
      billInvoices: result.billInvoices.map(bi => ({
        id: bi.id,
        invoiceNumber: bi.invoiceNumber,
        issueDate: bi.issueDate,
        dueDate: bi.dueDate,
        billType: bi.billType,
        billReferenceNumber: bi.billReferenceNumber,
        grandTotal: bi.grandTotal,
        amountPaid: bi.amountPaid,
        balance: bi.balance,
        status: bi.status
      })),
      commission: result.commission
        ? {
            id: result.commission.id,
            propertyId: result.commission.propertyId,
            managerId: result.commission.managerId,
            commissionFee: result.commission.commissionFee,
            incomeAmount: result.commission.incomeAmount,
            commissionAmount: result.commission.commissionAmount,
            periodStart: result.commission.periodStart,
            periodEnd: result.commission.periodEnd,
            status: result.commission.status,
            paidDate: result.commission.paidDate,
            createdAt: result.commission.createdAt
          }
        : null,
      message: result.commission
        ? 'Payment, income, invoices, and commission recorded'
        : 'Payment, income, and invoices recorded (no commission configured)'
    });

  } catch (error) {
    console.error('Error creating payment report:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to create payment report' 
    });
  }
};




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