import prisma from "../lib/prisma.js";
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
import PDFDocument from 'pdfkit';
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

// Enhanced PDF generation function for bill invoices
async function generateBillInvoicePDF(billInvoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Safe number formatting functions
      const safeNum = (val) => {
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };
      
      const formatCurrency = (val) => `Ksh ${safeNum(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Extract safe values
      const previousReading = safeNum(billInvoice.previousReading);
      const currentReading = safeNum(billInvoice.currentReading);
      const units = safeNum(billInvoice.units);
      const chargePerUnit = safeNum(billInvoice.chargePerUnit);
      const totalAmount = safeNum(billInvoice.totalAmount);
      const vatRate = safeNum(billInvoice.vatRate);
      const vatAmount = safeNum(billInvoice.vatAmount);
      const grandTotal = safeNum(billInvoice.grandTotal);
      const amountPaid = safeNum(billInvoice.amountPaid);
      const balance = safeNum(billInvoice.balance);
      const status = billInvoice.status || 'UNPAID';

      // Header Section
      doc.fontSize(20)
         .fillColor('#2563eb')
         .text('BILL INVOICE', { align: 'center' })
         .moveDown(0.5);

      // Invoice Details
      doc.fontSize(10)
         .fillColor('#374151')
         .text(`Invoice Number: ${billInvoice.invoiceNumber || 'N/A'}`, 50, 120)
         .text(`Issue Date: ${billInvoice.issueDate ? new Date(billInvoice.issueDate).toLocaleDateString('en-US') : 'N/A'}`, 50, 135)
         .text(`Due Date: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`, 50, 150)
         .text(`Bill Reference: ${billInvoice.billReferenceNumber || 'N/A'}`, 50, 165);

      // Status
      const statusColor = status === 'PAID' ? '#10b981' : 
                         status === 'PARTIAL' ? '#f59e0b' : 
                         status === 'OVERDUE' ? '#dc2626' : '#ef4444';

      doc.rect(400, 120, 100, 25)
         .fillAndStroke(statusColor, statusColor);
      
      doc.fillColor('#ffffff')
         .fontSize(12)
         .text(status.toUpperCase(), 400, 125, { width: 100, align: 'center' });

      doc.moveDown(3);

      // Tenant Information
      doc.fillColor('#1e293b')
         .fontSize(12)
         .text('BILLED TO:', 50, doc.y)
         .moveDown(0.5);

      doc.fillColor('#374151')
         .fontSize(10)
         .text(billInvoice.tenant?.fullName || 'N/A')
         .text(`Contact: ${billInvoice.tenant?.contact || 'N/A'}`)
         .text(`Unit: ${billInvoice.tenant?.unit?.unitNo || 'N/A'}`)
         .moveDown(1.5);

      // Bill Details
      doc.fillColor('#1e293b')
         .fontSize(14)
         .text(`BILL TYPE: ${billInvoice.billType || 'N/A'}`)
         .moveDown(1);

      // Meter Readings
      doc.fontSize(11)
         .text('METER READINGS:', { underline: true })
         .moveDown(0.5);

      doc.fontSize(10)
         .text(`Previous Reading: ${previousReading}`)
         .text(`Current Reading: ${currentReading}`)
         .text(`Units Consumed: ${units}`)
         .moveDown(1);

      // Charges Breakdown
      doc.fontSize(11)
         .text('CHARGES BREAKDOWN:', { underline: true })
         .moveDown(0.5);

      let currentY = doc.y;
      
      doc.text('Description', 50, currentY)
         .text('Amount', 400, currentY);

      currentY += 20;
      doc.text(`${units} units @ ${formatCurrency(chargePerUnit)}`, 50, currentY)
         .text(formatCurrency(totalAmount), 400, currentY);

      if (vatAmount > 0) {
        currentY += 15;
        doc.text(`VAT (${vatRate}%)`, 50, currentY)
           .text(formatCurrency(vatAmount), 400, currentY);
      }

      currentY += 20;
      doc.rect(50, currentY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      currentY += 10;

      // Grand Total
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('GRAND TOTAL', 50, currentY)
         .text(formatCurrency(grandTotal), 400, currentY);

      currentY += 25;

      // Payment Information
      if (amountPaid > 0) {
        doc.fillColor('#10b981')
           .text('AMOUNT PAID', 50, currentY)
           .text(formatCurrency(amountPaid), 400, currentY);
        currentY += 20;
      }

      // Balance
      const balanceColor = balance === 0 ? '#10b981' : '#ef4444';
      doc.fillColor(balanceColor)
         .text('BALANCE DUE', 50, currentY)
         .text(formatCurrency(balance), 400, currentY);

      doc.moveDown(2);

      // Payment Status
      doc.fillColor('#374151')
         .fontSize(10)
         .text(`Payment Status: ${status}`)
         .moveDown(0.5);

      if (billInvoice.notes) {
        doc.text(`Notes: ${billInvoice.notes}`);
      }

      // Footer
      const footerY = doc.page.height - 50;
      doc.rect(50, footerY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      doc.fillColor('#9ca3af')
         .fontSize(8)
         .text('Thank you for your business!', 50, footerY + 10, { width: 500, align: 'center' });

      doc.end();
    } catch (error) {
      console.error('PDF Generation Error:', error);
      reject(error);
    }
  });
}

// Pay bill with automatic invoice generation
export const payBill = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    // Validate payment amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const bill = await prisma.bill.findUnique({
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

    if (!bill) return res.status(404).json({ error: "Bill not found" });

    const roundTo2 = (num) => Math.round(num * 100) / 100;

    const paymentTolerance = 0.01; // Allow floating-point difference

    const newAmountPaid = roundTo2(bill.amountPaid + amount);
    const grandTotal = roundTo2(bill.grandTotal);
    const remainingBalance = roundTo2(grandTotal - bill.amountPaid);
    const now = new Date();

    // Validate payment doesn't exceed grand total
    if (newAmountPaid > grandTotal + paymentTolerance) {
      return res.status(400).json({
        error: `Payment amount exceeds bill total. Maximum payment allowed: Ksh ${remainingBalance.toLocaleString()}`
      });
    }

    let newStatus = bill.status;
    let paidAt = bill.paidAt;

    // Update status
    if (newAmountPaid >= grandTotal) {
      newStatus = "PAID";
      paidAt = now;
    } else if (newAmountPaid > 0) {
      newStatus = "PARTIAL";
    }

    // Check and update overdue
    if (bill.dueDate && now > bill.dueDate && newStatus !== "PAID") {
      newStatus = "OVERDUE";
    }

    // Execute database operations in transaction
    const { updatedBill, invoice } = await prisma.$transaction(async (tx) => {
      // 1 Update Bill
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
              unit: {
                select: {
                  property: { select: { name: true } }
                }
              }
            }
          }
        }
      });

      // 2 Create Invoice Entry
      const invoiceNumber = await generateBillInvoiceNumber();
      const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;
      
      const balance = roundTo2(grandTotal - newAmountPaid);

      let invoiceStatus = "UNPAID";
      if (newAmountPaid >= grandTotal) invoiceStatus = "PAID";
      else if (newAmountPaid > 0) invoiceStatus = "PARTIAL";

      const invoice = await tx.billInvoice.create({
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
          amountPaid: roundTo2(amount),
          balance: balance,
          status: invoiceStatus,
          notes: `Payment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`
        }
      });

      return { updatedBill, invoice };
    }, {
      // Optional: Increase transaction timeout if needed (default is 5 seconds)
      maxWait: 15000, // Maximum wait time for a transaction (10 seconds)
      timeout: 30000, // Maximum time the transaction can run (30 seconds)
    });

    // 3 Generate PDF and upload to storage (OUTSIDE transaction)
    let pdfUrl = null;
    if (invoice) {
      try {
        const pdfBuffer = await generateBillInvoicePDF(invoice);
        pdfUrl = await uploadToStorage(pdfBuffer, `${invoice.invoiceNumber}.pdf`);
        
        // Update invoice with PDF URL (separate, non-transactional operation)
        await prisma.billInvoice.update({
          where: { id: invoice.id },
          data: { pdfUrl }
        });
      } catch (pdfError) {
        console.error("Invoice PDF generation failed:", pdfError);
        // Don't fail the whole payment if PDF generation fails
        // The invoice was already created successfully
      }
    }

    res.status(200).json({
      success: true,
      data: {
        bill: updatedBill,
        invoice: {
          ...invoice,
          pdfUrl // Include the PDF URL in response
        },
      },
      message: "Payment recorded successfully and invoice generated"
    });

  } catch (error) {
    console.error("Error processing bill payment:", error);

    if (error.code === "P2002") {
      return res.status(400).json({ error: "Duplicate payment detected" });
    }
    
    if (error.code === "P2028") {
      return res.status(500).json({ 
        error: "Transaction timeout. The operation took too long. Please try again." 
      });
    }

    res.status(500).json({ error: "Internal Server Error" });
  }
};
