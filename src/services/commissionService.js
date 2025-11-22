import { PrismaClient } from '@prisma/client';

// Use a shared Prisma instance (or inject if using DI)
const prisma = new PrismaClient();

/**
 * Helper: Get month range for commission period grouping
 */
export const getMonthRange = (date) => {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

/**
 * Process commission for a given income record (within a Prisma transaction)
 * @param {Prisma.TransactionClient} tx - Prisma transaction client
 * @param {string} incomeId - ID of the income record
 * @returns {Promise<object|null>} - Created/updated commission record, or null
 */
export const processCommissionForIncome = async (tx, incomeId) => {
  // Fetch income with property
  const income = await tx.income.findUnique({
    where: { id: incomeId },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      propertyId: true,
      tenantId: true,
    },
  });

  if (!income || !income.propertyId) {
    return null;
  }

  // Fetch property (manager + commissionFee)
  const property = await tx.property.findUnique({
    where: { id: income.propertyId },
    select: {
      managerId: true,
      commissionFee: true,
    },
  });

  // Skip if no manager or commission fee undefined
  if (!property?.managerId || property.commissionFee == null) {
    return null;
  }

  // Get period (month of income creation)
  const { start: periodStart, end: periodEnd } = getMonthRange(income.createdAt);

  const commissionFee = property.commissionFee;
  const commissionAmount = income.amount * (commissionFee / 100);

  // Upsert commission (one per manager + property + month)
  return await tx.managerCommission.upsert({
    where: {
      managerId_propertyId_periodStart_periodEnd: {
        managerId: property.managerId,
        propertyId: income.propertyId,
        periodStart,
        periodEnd,
      },
    },
    create: {
      manager: { connect: { id: property.managerId } },
      property: { connect: { id: income.propertyId } },
      commissionFee,
      incomeAmount: income.amount,
      commissionAmount,
      periodStart,
      periodEnd,
      status: 'PENDING',
    },
    update: {
      incomeAmount: { increment: income.amount },
      commissionAmount: { increment: commissionAmount },
      updatedAt: new Date(),
    },
  });
};