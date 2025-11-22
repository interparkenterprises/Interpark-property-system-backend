import { PrismaClient } from "@prisma/client";
import { processCommissionForIncome } from '../services/commissionService.js';

const prisma = new PrismaClient();


// Create income record + auto-generate/update manager commission
export const createIncome = async (req, res) => {
  const { propertyId, tenantId, amount, frequency } = req.body;

  if (!propertyId) {
    return res.status(400).json({ message: "propertyId is required" });
  }
  if (!amount || !frequency) {
    return res.status(400).json({ message: "Amount and frequency are required" });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ message: "Valid positive amount is required" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create income
      const income = await tx.income.create({
        data: { propertyId, tenantId, amount: parsedAmount, frequency },
      });

      // 2. Process commission
      const commission = await processCommissionForIncome(tx, income.id);

      return { income, commission };
    });

    res.status(201).json({
      income: result.income,
      commission: result.commission,
      message: result.commission
        ? "Income and commission recorded"
        : "Income recorded (no manager/commission fee configured)",
    });

  } catch (error) {
    console.error("Error in createIncome:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Duplicate constraint violation" });
    }
    res.status(500).json({ message: "Server error while creating income" });
  }
};
// Get all income records
export const getAllIncomes = async (req, res) => {
  try {
    const incomes = await prisma.income.findMany({
      include: {
        property: { select: { name: true, address: true } },
        tenant: { select: { fullName: true, contact: true, id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Format response
    const formatted = incomes.map((i) => ({
      id: i.id,
      amount: i.amount,
      frequency: i.frequency,
      createdAt: i.createdAt,
      property: i.property
        ? {
            id: i.propertyId,
            name: i.property.name,
            address: i.property.address,
          }
        : null,
      tenant: i.tenant
        ? {
            id: i.tenant.id,
            name: i.tenant.fullName,
            contact: i.tenant.contact,
          }
        : null,
    }));

    res.json(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch incomes" });
  }
};


// Get single income record
export const getIncomeById = async (req, res) => {
  try {
    const { id } = req.params;
    const income = await prisma.income.findUnique({
      where: { id },
      include: { property: true, tenant: true },
    });

    if (!income) return res.status(404).json({ message: "Income not found" });
    res.json(income);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching income" });
  }
};

// Update income
export const updateIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, frequency } = req.body;

    const updated = await prisma.income.update({
      where: { id },
      data: { amount: parseFloat(amount), frequency },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update income" });
  }
};

// Delete income
export const deleteIncome = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.income.delete({ where: { id } });
    res.json({ message: "Income deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete income" });
  }
};
