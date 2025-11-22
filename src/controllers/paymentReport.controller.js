import { PrismaClient } from '@prisma/client';
import { processCommissionForIncome } from '../services/commissionService.js';

const prisma = new PrismaClient();

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
  if (tenant.escalation && new Date(tenant.rentStart) <= periodStartOfMonth) {
    const yearsElapsed = Math.floor(
      (periodStartOfMonth - new Date(tenant.rentStart)) / (365.25 * 24 * 60 * 60 * 1000)
    );
    expectedRent = tenant.rent * Math.pow(1 + tenant.escalation / 100, yearsElapsed);
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

  // VAT (e.g., 16% in Kenya — configurable)
  const vatRate = 0.16;
  const vat = (expectedRent + serviceCharge) * vatRate;
  const totalDue = expectedRent + serviceCharge + vat;

  return {
    rent: parseFloat(expectedRent.toFixed(2)),
    serviceCharge: parseFloat(serviceCharge.toFixed(2)),
    vat: parseFloat(vat.toFixed(2)),
    totalDue: parseFloat(totalDue.toFixed(2)),
    periodStart: periodStartOfMonth,
    periodEnd: periodEndOfMonth
  };
}

// Utility: Parse & validate pagination params
function getPaginationParams(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 10)); // cap at 100
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

    // Filter by payment period range (e.g., Nov 2025 payments)
    if (dateFrom || dateTo) {
      where.paymentPeriod = {};
      if (dateFrom) where.paymentPeriod.gte = new Date(dateFrom);
      if (dateTo) where.paymentPeriod.lte = new Date(dateTo);
    }

    // Count total matching records (for pagination meta)
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
    const { tenantId, amountPaid, paymentPeriod, notes } = req.body;

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

    // Fetch tenant + property (needed for income & commission)
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

    //  Transaction: PaymentReport + Income + Commission
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create PaymentReport (with safe include)
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

      // 2. Create Income
      const income = await tx.income.create({
        data: {
          propertyId: tenant.unit.propertyId,
          tenantId,
          amount: parsedAmountPaid,
          frequency: 'MONTHLY'
        }
      });

      // 3. Process commission
      const commission = await processCommissionForIncome(tx, income.id);

      return { report, income, commission };
    });

    // Manual response shaping (avoids Prisma select/include conflicts)
    const formattedReport = {
      id: result.report.id,
      tenantId: result.report.tenantId,
      rent: result.report.rent,
      serviceCharge: result.report.serviceCharge,
      vat: result.report.vat,
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
        ? 'Payment, income, and commission recorded'
        : 'Payment and income recorded (no commission configured)'
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
          }
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
        totalDue: existingReport.totalDue,
        periodStart: existingReport.paymentPeriod,
        periodEnd: new Date(new Date(existingReport.paymentPeriod).getFullYear(), new Date(existingReport.paymentPeriod).getMonth() + 1, 0)
      };

      if (paymentPeriod) {
        expected = await computeExpectedCharges(
          existingReport.tenantId,
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

      // Update related income record if it exists
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