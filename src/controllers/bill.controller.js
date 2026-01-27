import prisma from "../lib/prisma.js";
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
//import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js';

//const prisma = new PrismaClient();

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


// Pay bill with update to the same invoice
export const payBill = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: { include: { property: true } }
          }
        },
        // IMPORTANT: Include existing invoices
        billInvoices: {
          orderBy: { createdAt: 'desc' },
          take: 1 // Get the latest invoice
        }
      }
    });

    if (!bill) return res.status(404).json({ error: "Bill not found" });

    const roundTo2 = (num) => Math.round(num * 100) / 100;
    const newAmountPaid = roundTo2(bill.amountPaid + amount);
    const grandTotal = roundTo2(bill.grandTotal);
    const remainingBalance = roundTo2(grandTotal - bill.amountPaid);
    const now = new Date();

    // Validate payment
    if (newAmountPaid > grandTotal + 0.01) {
      return res.status(400).json({
        error: `Payment exceeds bill total. Maximum: Ksh ${remainingBalance.toLocaleString()}`
      });
    }

    let newStatus = bill.status;
    let paidAt = bill.paidAt;

    if (newAmountPaid >= grandTotal) {
      newStatus = "PAID";
      paidAt = now;
    } else if (newAmountPaid > 0) {
      newStatus = "PARTIAL";
    }

    if (bill.dueDate && now > bill.dueDate && newStatus !== "PAID") {
      newStatus = "OVERDUE";
    }

    const { updatedBill, invoice } = await prisma.$transaction(async (tx) => {
      // 1. Update Bill
      const updatedBill = await tx.bill.update({
        where: { id },
        data: {
          amountPaid: newAmountPaid,
          status: newStatus,
          paidAt
        },
        include: {
          tenant: {
            select: {
              fullName: true,
              unit: { select: { property: { select: { name: true } } } }
            }
          }
        }
      });

      const balance = roundTo2(grandTotal - newAmountPaid);
      let invoiceStatus = "UNPAID";
      if (newAmountPaid >= grandTotal) invoiceStatus = "PAID";
      else if (newAmountPaid > 0) invoiceStatus = "PARTIAL";

      // Check for overdue
      if (bill.dueDate && now > bill.dueDate && invoiceStatus !== "PAID") {
        invoiceStatus = "OVERDUE";
      }

      let invoice;

      // ========================================
      // KEY CHANGE: Update existing or create new
      // ========================================
      if (bill.billInvoices && bill.billInvoices.length > 0) {
        // UPDATE existing invoice
        const existingInvoice = bill.billInvoices[0];
        
        invoice = await tx.billInvoice.update({
          where: { id: existingInvoice.id },
          data: {
            amountPaid: newAmountPaid,
            balance: balance,
            status: invoiceStatus,
            notes: existingInvoice.notes 
              ? `${existingInvoice.notes}\nPayment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`
              : `Payment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`,
            updatedAt: now
          }
        });
      } else {
        // CREATE new invoice (only if none exists)
        const invoiceNumber = await generateBillInvoiceNumber();
        const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;

        invoice = await tx.billInvoice.create({
          data: {
            invoiceNumber,
            billId: bill.id,
            billReferenceNumber,
            billReferenceDate: bill.issuedAt,
            tenantId: bill.tenantId,
            issueDate: now,
            dueDate: bill.dueDate || now,
            billType: bill.type,
            previousReading: Number(bill.previousReading) || 0,
            currentReading: Number(bill.currentReading) || 0,
            units: Number(bill.units) || 0,
            chargePerUnit: Number(bill.chargePerUnit) || 0,
            totalAmount: Number(bill.totalAmount) || 0,
            vatRate: bill.vatRate ? Number(bill.vatRate) : null,
            vatAmount: bill.vatAmount ? Number(bill.vatAmount) : null,
            grandTotal: grandTotal,
            amountPaid: newAmountPaid,
            balance: balance,
            status: invoiceStatus,
            notes: `Initial payment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`
          }
        });
      }

      return { updatedBill, invoice };
    }, {
      maxWait: 15000,
      timeout: 30000,
    });

    // 3. Regenerate PDF with updated data (OUTSIDE transaction)
    let pdfUrl = null;
    if (invoice) {
      try {
        const pdfBuffer = await generateBillInvoicePDF(invoice);
        pdfUrl = await uploadToStorage(pdfBuffer, `${invoice.invoiceNumber}.pdf`);
        
        await prisma.billInvoice.update({
          where: { id: invoice.id },
          data: { pdfUrl }
        });
      } catch (pdfError) {
        console.error("Invoice PDF generation failed:", pdfError);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        bill: updatedBill,
        invoice: { ...invoice, pdfUrl }
      },
      message: "Payment recorded and invoice updated successfully"
    });

  } catch (error) {
    console.error("Error processing bill payment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

