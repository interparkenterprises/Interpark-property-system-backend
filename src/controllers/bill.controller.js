import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Create a new bill
export const createBill = async (req, res) => {
  try {
    const {
      tenantId,
      type,
      description,
      previousReading,
      currentReading,
      chargePerUnit,
      vatRate,
      dueDate,
      notes,
    } = req.body;

    // Validate required fields
    if (!tenantId || !type || previousReading === undefined || currentReading === undefined || chargePerUnit === undefined) {
      return res.status(400).json({ error: 'tenantId, type, previousReading, currentReading, and chargePerUnit are required.' });
    }

    // Validate tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    // Compute derived values
    const units = currentReading - previousReading;
    const totalAmount = units * chargePerUnit;
    const vatAmount = vatRate ? totalAmount * (vatRate / 100) : 0;
    const grandTotal = totalAmount + vatAmount;

    const bill = await prisma.bill.create({
      data: {
        tenantId,
        type,
        description,
        previousReading,
        currentReading,
        units,
        chargePerUnit,
        totalAmount,
        vatRate,
        vatAmount,
        grandTotal,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes,
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true, address: true }
                }
              }
            }
          }
        }
      }
    });

    res.status(201).json(bill);
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get all bills
export const getAllBills = async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status, tenantId } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereClause = {};
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (tenantId) whereClause.tenantId = tenantId;

    const bills = await prisma.bill.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issuedAt: 'desc' },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });

    const total = await prisma.bill.count({ where: whereClause });

    res.status(200).json({
      bills,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get a specific bill by ID
export const getBillById = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true, address: true }
                }
              }
            }
          }
        }
      }
    });

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    res.status(200).json(bill);
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Update a bill by ID
export const updateBill = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Find the existing bill
    const existingBill = await prisma.bill.findUnique({
      where: { id },
    });

    if (!existingBill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    // Recalculate derived values if relevant fields are updated
    let finalUpdates = { ...updates };
    if (updates.currentReading !== undefined || updates.previousReading !== undefined || updates.chargePerUnit !== undefined) {
      const prevRead = updates.previousReading ?? existingBill.previousReading;
      const currRead = updates.currentReading ?? existingBill.currentReading;
      const chargePerUnit = updates.chargePerUnit ?? existingBill.chargePerUnit;
      const vatRate = updates.vatRate ?? existingBill.vatRate;

      const units = currRead - prevRead;
      const totalAmount = units * chargePerUnit;
      const vatAmount = vatRate ? totalAmount * (vatRate / 100) : 0;
      const grandTotal = totalAmount + vatAmount;

      finalUpdates = {
        ...finalUpdates,
        units,
        totalAmount,
        vatAmount,
        grandTotal,
      };
    }

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: finalUpdates,
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });

    res.status(200).json(updatedBill);
  } catch (error) {
    console.error('Error updating bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Delete a bill by ID
export const deleteBill = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await prisma.bill.findUnique({
      where: { id },
    });

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    await prisma.bill.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Bill deleted successfully.' });
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const payBill = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    // Validate payment amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) return res.status(404).json({ error: "Bill not found" });

    const newAmountPaid = bill.amountPaid + amount;
    const now = new Date();

    let newStatus = bill.status;
    let paidAt = bill.paidAt;

    // Updated logic based on enums: UNPAID, PARTIAL, PAID, OVERDUE, CANCELLED
    if (newAmountPaid >= bill.grandTotal) {
      newStatus = "PAID";
      paidAt = now;
    } else if (newAmountPaid > 0) {
      newStatus = "PARTIAL";
    } else {
      newStatus = "UNPAID";
    }

    //  Automatically mark OVERDUE if due date passed & not fully paid
    if (bill.dueDate && now > bill.dueDate && newStatus !== "PAID") {
      newStatus = "OVERDUE";
    }

    // Prevent over-payment!
    const totalPaid = Math.min(newAmountPaid, bill.grandTotal);

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: {
        amountPaid: totalPaid,
        status: newStatus,
        paidAt
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            unit: {
              select: {
                property: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    res.status(200).json(updatedBill);

  } catch (error) {
    console.error("Error processing bill payment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
