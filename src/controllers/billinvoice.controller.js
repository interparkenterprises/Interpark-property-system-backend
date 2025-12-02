import { PrismaClient } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js';
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';

const prisma = new PrismaClient();

// @desc    Generate invoice for a bill (for current remaining balance)
// @route   POST /api/bill-invoices/generate
// @access  Private
export const generateBillInvoice = async (req, res) => {
  try {
    const { billId, dueDate, notes } = req.body;

    // Validate required fields
    if (!billId || !dueDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'billId and dueDate are required.' 
      });
    }

    // Fetch bill with tenant and property details
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
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

    if (!bill) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill not found.' 
      });
    }

    // Calculate current remaining balance
    const remainingBalance = bill.grandTotal - bill.amountPaid;
    
    if (remainingBalance <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Bill is already fully paid. No balance remaining for invoice.' 
      });
    }

    // Generate unique invoice number
    const invoiceNumber = await generateBillInvoiceNumber();

    // Generate bill reference number
    const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;

    // Determine status based on remaining balance
    let status = 'UNPAID';
    const now = new Date();
    const due = new Date(dueDate);
    
    if (now > due) {
      status = 'OVERDUE';
    }

    // Create bill invoice record for the CURRENT BALANCE
    const billInvoice = await prisma.billInvoice.create({
      data: {
        invoiceNumber,
        billId: bill.id,
        billReferenceNumber,
        billReferenceDate: bill.issuedAt,
        tenantId: bill.tenantId,
        issueDate: new Date(),
        dueDate: due,
        billType: bill.type,
        previousReading: Number(bill.previousReading) || 0,
        currentReading: Number(bill.currentReading) || 0,
        units: Number(bill.units) || 0,
        chargePerUnit: Number(bill.chargePerUnit) || 0,
        totalAmount: Number(bill.totalAmount) || 0,
        vatRate: bill.vatRate ? Number(bill.vatRate) : null,
        vatAmount: bill.vatAmount ? Number(bill.vatAmount) : null,
        grandTotal: remainingBalance, // This is the key change - invoice for current balance
        amountPaid: 0, // Start with 0 paid for this invoice
        balance: remainingBalance,
        status,
        notes: notes || `Invoice generated for remaining balance of Ksh ${remainingBalance.toLocaleString()}`
      },
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
        bill: true
      }
    });

    // Generate PDF
    const pdfBuffer = await generateBillInvoicePDF(billInvoice);
    
    // Upload PDF to storage
    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    // Update invoice with PDF URL
    const updatedInvoice = await prisma.billInvoice.update({
      where: { id: billInvoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Bill invoice generated successfully for remaining balance'
    });
  } catch (error) {
    console.error('Error generating bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get all bill invoices
// @route   GET /api/bill-invoices
// @access  Private
export const getAllBillInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, tenantId, billType } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereClause = {};
    if (status) whereClause.status = status;
    if (tenantId) whereClause.tenantId = tenantId;
    if (billType) whereClause.billType = billType;

    const billInvoices = await prisma.billInvoice.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issueDate: 'desc' },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                unitNo: true,
                property: {
                  select: { name: true }
                }
              }
            }
          }
        },
        bill: {
          select: {
            id: true,
            type: true,
            issuedAt: true
          }
        }
      }
    });

    const total = await prisma.billInvoice.count({ where: whereClause });

    res.status(200).json({
      success: true,
      data: billInvoices,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bill invoices:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get bill invoices by tenant
// @route   GET /api/bill-invoices/tenant/:tenantId
// @access  Private
export const getBillInvoicesByTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { page = 1, limit = 10, status, billType } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereClause = { tenantId };
    if (status) whereClause.status = status;
    if (billType) whereClause.billType = billType;

    const billInvoices = await prisma.billInvoice.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issueDate: 'desc' },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                unitNo: true,
                property: {
                  select: { name: true, address: true }
                }
              }
            }
          }
        },
        bill: true
      }
    });

    const total = await prisma.billInvoice.count({ where: whereClause });

    res.status(200).json({
      success: true,
      data: billInvoices,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bill invoices:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get single bill invoice by ID
// @route   GET /api/bill-invoices/:id
// @access  Private
export const getBillInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const billInvoice = await prisma.billInvoice.findUnique({
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
        bill: true
      }
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }

    res.status(200).json({ success: true, data: billInvoice });
  } catch (error) {
    console.error('Error fetching bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Update bill invoice status and payment
// @route   PATCH /api/bill-invoices/:id/payment
// @access  Private
export const updateBillInvoicePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountPaid } = req.body;

    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payment amount' 
      });
    }

    const billInvoice = await prisma.billInvoice.findUnique({ 
      where: { id } 
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found' 
      });
    }

    const newAmountPaid = billInvoice.amountPaid + amountPaid;
    const newBalance = billInvoice.grandTotal - newAmountPaid;
    
    let newStatus = billInvoice.status;
    if (newAmountPaid >= billInvoice.grandTotal) {
      newStatus = 'PAID';
    } else if (newAmountPaid > 0) {
      newStatus = 'PARTIAL';
    }

    // Check if overdue
    const now = new Date();
    if (now > billInvoice.dueDate && newStatus !== 'PAID') {
      newStatus = 'OVERDUE';
    }

    // Prevent over-payment
    const totalPaid = Math.min(newAmountPaid, billInvoice.grandTotal);
    const finalBalance = Math.max(0, billInvoice.grandTotal - totalPaid);

    const updatedInvoice = await prisma.billInvoice.update({
      where: { id },
      data: {
        amountPaid: totalPaid,
        balance: finalBalance,
        status: newStatus
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            unit: {
              select: {
                unitNo: true,
                property: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    // Also update the original bill
    await prisma.bill.update({
      where: { id: billInvoice.billId },
      data: {
        amountPaid: totalPaid,
        status: newStatus === 'PAID' ? 'PAID' : newStatus === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
        paidAt: newStatus === 'PAID' ? new Date() : null
      }
    });

    res.status(200).json({
      success: true,
      data: updatedInvoice,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('Error updating bill invoice payment:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Record a new payment for a bill invoice (idempotent-friendly; adds a payment *event*)
// @route   POST /api/bill-invoices/:id/record-payment
// @access  Private
export const recordBillInvoicePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountPaid, paymentDate, notes } = req.body;

    // Validate input
    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amountPaid must be a positive number'
      });
    }

    if (!paymentDate) {
      return res.status(400).json({
        success: false,
        error: 'paymentDate is required'
      });
    }

    const parsedPaymentDate = new Date(paymentDate);
    if (isNaN(parsedPaymentDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid paymentDate format'
      });
    }

    // Fetch invoice with bill details
    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: { 
        bill: true,
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

    if (!billInvoice) {
      return res.status(404).json({
        success: false,
        error: 'Bill invoice not found'
      });
    }

    // Calculate new cumulative payment & balance for THIS invoice
    const newAmountPaid = billInvoice.amountPaid + amountPaid;
    const invoiceGrandTotal = Number(billInvoice.grandTotal);
    const finalAmountPaid = Math.min(newAmountPaid, invoiceGrandTotal); // prevent overpayment
    const newBalance = Math.max(0, invoiceGrandTotal - finalAmountPaid);

    // Determine new status for THIS invoice
    let newInvoiceStatus = billInvoice.status;
    if (finalAmountPaid >= invoiceGrandTotal) {
      newInvoiceStatus = 'PAID';
    } else if (finalAmountPaid > 0) {
      newInvoiceStatus = 'PARTIAL';
    }

    const now = new Date();
    if (now > new Date(billInvoice.dueDate) && newInvoiceStatus !== 'PAID') {
      newInvoiceStatus = 'OVERDUE';
    }

    // Start transaction: update invoice + update bill + generate new invoice if partial payment
    const [updatedInvoice, updatedBill, newInvoice] = await prisma.$transaction(async (tx) => {
      // 1. Update this invoice
      const updatedInvoice = await tx.billInvoice.update({
        where: { id },
        data: {
          amountPaid: finalAmountPaid,
          balance: newBalance,
          status: newInvoiceStatus,
          updatedAt: new Date()
        },
        include: {
          tenant: {
            select: {
              fullName: true,
              unit: {
                select: { unitNo: true, property: { select: { name: true } } }
              }
            }
          }
        }
      });

      // 2. Update original bill for consistency
      const billNewAmountPaid = billInvoice.bill.amountPaid + amountPaid;
      const billGrandTotal = Number(billInvoice.bill.grandTotal);
      const billFinalAmountPaid = Math.min(billNewAmountPaid, billGrandTotal);
      const billNewBalance = Math.max(0, billGrandTotal - billFinalAmountPaid);

      let billNewStatus = billInvoice.bill.status;
      if (billFinalAmountPaid >= billGrandTotal) {
        billNewStatus = 'PAID';
      } else if (billFinalAmountPaid > 0) {
        billNewStatus = 'PARTIAL';
      }

      if (now > new Date(billInvoice.bill.dueDate) && billNewStatus !== 'PAID') {
        billNewStatus = 'OVERDUE';
      }

      const updatedBill = await tx.bill.update({
        where: { id: billInvoice.billId },
        data: {
          amountPaid: billFinalAmountPaid,
          status: billNewStatus,
          paidAt: billNewStatus === 'PAID' ? new Date() : null
        }
      });

      // 3. If this is a partial payment and there's still balance, generate a new invoice for remaining balance
      let newInvoice = null;
      if (newBalance > 0 && newInvoiceStatus === 'PARTIAL') {
        try {
          const newInvoiceNumber = await generateBillInvoiceNumber();
          const billReferenceNumber = `BILL-${billInvoice.billType}-${billInvoice.billId.substring(0, 8).toUpperCase()}`;

          newInvoice = await tx.billInvoice.create({
            data: {
              invoiceNumber: newInvoiceNumber,
              billId: billInvoice.billId,
              billReferenceNumber,
              billReferenceDate: billInvoice.bill.issuedAt,
              tenantId: billInvoice.tenantId,
              issueDate: new Date(),
              dueDate: billInvoice.dueDate,
              billType: billInvoice.billType,
              previousReading: Number(billInvoice.previousReading) || 0,
              currentReading: Number(billInvoice.currentReading) || 0,
              units: Number(billInvoice.units) || 0,
              chargePerUnit: Number(billInvoice.chargePerUnit) || 0,
              totalAmount: Number(billInvoice.totalAmount) || 0,
              vatRate: billInvoice.vatRate ? Number(billInvoice.vatRate) : null,
              vatAmount: billInvoice.vatAmount ? Number(billInvoice.vatAmount) : null,
              grandTotal: newBalance,
              amountPaid: 0,
              balance: newBalance,
              status: 'UNPAID',
              notes: `New invoice generated for remaining balance after partial payment`
            }
          });
        } catch (invoiceError) {
          console.error('Error generating new invoice for remaining balance:', invoiceError);
          // Don't fail the transaction if new invoice generation fails
        }
      }

      return [updatedInvoice, updatedBill, newInvoice];
    });

    res.status(201).json({
      success: true,
      data: {
        invoice: updatedInvoice,
        bill: updatedBill,
        newInvoice: newInvoice
      },
      message: 'Payment recorded successfully' + (newInvoice ? ' and new invoice generated for remaining balance' : '')
    });
  } catch (error) {
    console.error('Error recording bill invoice payment:', error);
    if (error.code === 'P2002') { // Unique constraint violation
      return res.status(409).json({ success: false, error: 'Duplicate payment detected' });
    }
    res.status(500).json({ success: false, error: 'Failed to record payment' });
  }
};

// @desc    Download bill invoice PDF
// @route   GET /api/bill-invoices/:id/download
// @access  Private
export const downloadBillInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const billInvoice = await prisma.billInvoice.findUnique({
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
        bill: true
      }
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }

    // Generate PDF
    const pdfBuffer = await generateBillInvoicePDF(billInvoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${billInvoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Delete bill invoice
// @route   DELETE /api/bill-invoices/:id
// @access  Private
export const deleteBillInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id }
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }

    await prisma.billInvoice.delete({
      where: { id }
    });

    res.status(200).json({ 
      success: true, 
      message: 'Bill invoice deleted successfully.' 
    });
  } catch (error) {
    console.error('Error deleting bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};


// Helper function to generate Bill Invoice PDF
async function generateBillInvoicePDF(billInvoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 50, 
        size: 'A4',
        bufferPages: true 
      });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Safe number formatting functions
      const safeNum = (val) => {
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };
      
      const safeStr = (val) => safeNum(val).toFixed(2);
      const formatCurrency = (val) => `Ksh ${safeNum(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Helper function to move down with overflow check
      const moveDownWithCheck = (lines = 1) => {
        const lineHeight = doc.currentLineHeight();
        const newY = doc.y + (lineHeight * lines);
        
        // Check if we're near the bottom of the page (leave 100px for footer)
        if (newY > doc.page.height - 100) {
          doc.addPage();
          doc.y = 50; // Reset to top margin on new page
          return true; // Page was added
        }
        
        doc.moveDown(lines);
        return false;
      };

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

      // ===========================================
      // HEADER SECTION
      // ===========================================
      
      // Company Logo/Name
      doc.fontSize(20)
         .fillColor('#2563eb')
         .text(billInvoice.tenant?.unit?.property?.name || 'PROPERTY MANAGEMENT', { 
           align: 'center',
           underline: true 
         });
      
      // Company Address
      doc.fontSize(10)
         .fillColor('#666666')
         .text(billInvoice.tenant?.unit?.property?.address || 'Professional Property Management Services', { 
           align: 'center' 
         });
      
      moveDownWithCheck(0.5);

      // Invoice Title
      doc.fontSize(24)
         .fillColor('#1e293b')
         .text('UTILITY BILL INVOICE', { 
           align: 'center',
           underline: false 
         });
      
      moveDownWithCheck(1);

      // ===========================================
      // INVOICE & STATUS SECTION
      // ===========================================
      
      const infoTop = doc.y;
      
      // Left Column - Invoice Details
      doc.fontSize(10)
         .fillColor('#374151')
         .text('INVOICE DETAILS:', 50, infoTop, { underline: true })
         .text(`Invoice Number: ${billInvoice.invoiceNumber || 'N/A'}`, 50, infoTop + 15)
         .text(`Issue Date: ${billInvoice.issueDate ? new Date(billInvoice.issueDate).toLocaleDateString('en-US') : 'N/A'}`, 50, infoTop + 30)
         .text(`Due Date: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`, 50, infoTop + 45)
         .text(`Bill Reference: ${billInvoice.billReferenceNumber || 'N/A'}`, 50, infoTop + 60)
         .text(`Bill Date: ${billInvoice.billReferenceDate ? new Date(billInvoice.billReferenceDate).toLocaleDateString('en-US') : 'N/A'}`, 50, infoTop + 75);

      // Right Column - Status Badge
      const statusColor = 
        status === 'PAID' ? '#10b981' : 
        status === 'PARTIAL' ? '#f59e0b' : 
        status === 'OVERDUE' ? '#dc2626' : 
        status === 'CANCELLED' ? '#6b7280' : '#ef4444';

      // Status box - dynamically position based on content height
      const statusBoxTop = infoTop;
      const statusBoxHeight = status === 'OVERDUE' ? 45 : 30;
      
      doc.rect(400, statusBoxTop, 120, statusBoxHeight)
         .fillAndStroke(statusColor, statusColor);
      
      doc.fillColor('#ffffff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(status.toUpperCase(), 400, statusBoxTop + 8, { 
           width: 120, 
           align: 'center' 
         });

      if (status === 'OVERDUE') {
        doc.fillColor('#ffffff')
           .fontSize(8)
           .text('PAYMENT OVERDUE', 400, statusBoxTop + 28, { 
             width: 120, 
             align: 'center' 
           });
      }

      // Move Y position to after the invoice details section
      doc.y = Math.max(infoTop + 90, statusBoxTop + statusBoxHeight + 20);
      
      // Check for overflow
      moveDownWithCheck(1);

      // ===========================================
      // TENANT INFORMATION
      // ===========================================
      
      const tenantSectionTop = doc.y;
      
      doc.fillColor('#1e293b')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('BILLED TO:', 50, tenantSectionTop, { underline: true });
      
      doc.y = tenantSectionTop + 20;
      
      doc.fillColor('#374151')
         .fontSize(10)
         .font('Helvetica')
         .text(billInvoice.tenant?.fullName || 'N/A', 50, doc.y)
         .text(`Contact: ${billInvoice.tenant?.contact || 'N/A'}`, 50, doc.y + 15)
         .text(`Unit: ${billInvoice.tenant?.unit?.unitNo || 'N/A'}`, 50, doc.y + 30)
         .text(`Property: ${billInvoice.tenant?.unit?.property?.name || 'N/A'}`, 50, doc.y + 45);
      
      doc.y += 60; // Move Y position after tenant info
      moveDownWithCheck(1.5);

      // ===========================================
      // BILL TYPE & METER READINGS
      // ===========================================
      
      doc.fillColor('#2563eb')
         .fontSize(14)
         .font('Helvetica-Bold')
         .text(`BILL TYPE: ${billInvoice.billType || 'N/A'}`, { underline: true });
      
      moveDownWithCheck(1);

      // Meter Readings Table
      const readingsTop = doc.y;
      
      doc.fillColor('#1e293b')
         .fontSize(11)
         .text('METER READING DETAILS', { underline: true });
      
      moveDownWithCheck(0.5);

      // Table headers
      const tableRowHeight = 20;
      let currentRowY = doc.y;
      
      doc.fillColor('#374151')
         .fontSize(10)
         .text('Description', 50, currentRowY)
         .text('Reading', 250, currentRowY)
         .text('Unit', 350, currentRowY);

      // Separator line
      currentRowY += 15;
      doc.rect(50, currentRowY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      // Previous Reading
      currentRowY += 10;
      doc.text('Previous Reading', 50, currentRowY)
         .text(safeStr(previousReading), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 350, currentRowY);

      // Current Reading
      currentRowY += tableRowHeight;
      doc.text('Current Reading', 50, currentRowY)
         .text(safeStr(currentReading), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 350, currentRowY);

      // Separator line
      currentRowY += 15;
      doc.rect(50, currentRowY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      // Total Units Consumed
      currentRowY += 10;
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Total Units Consumed', 50, currentRowY)
         .text(safeStr(units), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 350, currentRowY);

      // Update doc.y to continue after the table
      doc.y = currentRowY + tableRowHeight + 10;
      moveDownWithCheck(2);

      // ===========================================
      // BILL CALCULATION & CHARGES
      // ===========================================
      
      doc.fillColor('#1e293b')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('BILL CALCULATION', { underline: true });
      
      moveDownWithCheck(0.5);

      const chargesTop = doc.y;
      currentRowY = chargesTop;
      
      // Table headers
      doc.fillColor('#374151')
         .fontSize(10)
         .text('Description', 50, currentRowY)
         .text('Rate/Amount', 300, currentRowY)
         .text('Total (Ksh)', 450, currentRowY);

      // Separator line
      currentRowY += 15;
      doc.rect(50, currentRowY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      currentRowY += 10;

      // Units Charge
      doc.text(`${safeStr(units)} units consumed`, 50, currentRowY)
         .text(`@ Ksh ${safeStr(chargePerUnit)} per unit`, 300, currentRowY)
         .text(formatCurrency(totalAmount), 450, currentRowY);

      currentRowY += tableRowHeight;

      // VAT (if applicable)
      if (vatAmount > 0 && vatRate > 0) {
        doc.text(`VAT (${safeStr(vatRate)}%)`, 50, currentRowY)
           .text('', 300, currentRowY)
           .text(formatCurrency(vatAmount), 450, currentRowY);
        currentRowY += tableRowHeight;
      }

      // Separator line before total
      currentRowY += 5;
      doc.rect(50, currentRowY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      currentRowY += 10;

      // Grand Total
      doc.fillColor('#1e293b')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('GRAND TOTAL', 50, currentRowY)
         .text(formatCurrency(grandTotal), 450, currentRowY);

      currentRowY += tableRowHeight + 10;

      // Amount Paid (if any)
      if (amountPaid > 0) {
        doc.fillColor('#10b981')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('Amount Paid', 50, currentRowY)
           .text(formatCurrency(amountPaid), 450, currentRowY);
        currentRowY += tableRowHeight;
      }

      // Balance Due
      const balanceColor = balance === 0 ? '#10b981' : 
                          status === 'OVERDUE' ? '#dc2626' : '#ef4444';
      
      doc.fillColor(balanceColor)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('BALANCE DUE', 50, currentRowY)
         .text(formatCurrency(balance), 450, currentRowY);

      // Update doc.y to continue after the calculations table
      doc.y = currentRowY + tableRowHeight + 10;
      moveDownWithCheck(2);

      // ===========================================
      // PAYMENT STATUS & INSTRUCTIONS
      // ===========================================
      
      doc.fillColor('#1e293b')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('PAYMENT STATUS', { underline: true });
      
      moveDownWithCheck(0.5);

      doc.fillColor('#374151')
         .fontSize(10)
         .font('Helvetica');

      // Status-specific messages
      const statusMessages = [];
      switch (status) {
        case 'PAID':
          statusMessages.push('✅ Payment Completed - Thank you for your payment!');
          statusMessages.push(`Paid on: ${billInvoice.updatedAt ? new Date(billInvoice.updatedAt).toLocaleDateString('en-US') : 'N/A'}`);
          break;
        case 'PARTIAL':
          statusMessages.push('⚠️ Partial Payment Received');
          statusMessages.push(`Amount paid: ${formatCurrency(amountPaid)}`);
          statusMessages.push(`Remaining balance: ${formatCurrency(balance)}`);
          break;
        case 'OVERDUE':
          statusMessages.push('🚨 PAYMENT OVERDUE - Immediate attention required!');
          statusMessages.push(`Original due date: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`);
          break;
        case 'UNPAID':
          statusMessages.push('⏳ Payment Pending');
          statusMessages.push('No payment has been received for this invoice.');
          break;
        case 'CANCELLED':
          statusMessages.push('❌ Invoice Cancelled');
          statusMessages.push('This invoice is no longer valid for payment.');
          break;
      }

      // Write status messages with proper spacing
      statusMessages.forEach((msg, index) => {
        doc.text(msg);
        if (index < statusMessages.length - 1) {
          moveDownWithCheck(0.3);
        }
      });

      moveDownWithCheck(1.5);

      // Payment Instructions for unpaid invoices
      if (['UNPAID', 'PARTIAL', 'OVERDUE'].includes(status)) {
        doc.fillColor('#1e293b')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text('PAYMENT INSTRUCTIONS', { underline: true });
        
        moveDownWithCheck(0.5);

        doc.fillColor('#374151')
           .fontSize(10)
           .font('Helvetica')
           .text(`• Please make payment by: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`)
           .text(`• Include invoice number (${billInvoice.invoiceNumber}) as payment reference`)
           .text('• Payment methods: Bank transfer, Mobile money, or Cash at office')
           .text('• Contact property management for payment details and assistance');
        
        moveDownWithCheck(1.5);
      }

      // ===========================================
      // NOTES SECTION
      // ===========================================
      
      if (billInvoice.notes) {
        doc.fillColor('#1e293b')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text('ADDITIONAL NOTES', { underline: true });
        
        moveDownWithCheck(0.5);

        doc.fillColor('#374151')
           .fontSize(10)
           .font('Helvetica')
           .text(billInvoice.notes, { 
             width: 500,
             align: 'left' 
           });
        
        moveDownWithCheck(1);
      }

      // ===========================================
      // FOOTER
      // ===========================================
      
      // Always ensure we have enough space for footer
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
        doc.y = 50;
      }
      
      const footerY = doc.page.height - 80;
      
      // Footer separator
      doc.rect(50, footerY - 10, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      // Position at footer
      doc.y = footerY;
      
      doc.fillColor('#9ca3af')
         .fontSize(8)
         .font('Helvetica');

      // Status-specific footer message
      if (status === 'PAID') {
        doc.text('Thank you for your timely payment! We appreciate your business.', {
          align: 'center',
          width: 500
        });
      } else if (status === 'OVERDUE') {
        doc.fillColor('#dc2626')
           .text('URGENT: Please settle this overdue invoice immediately to avoid service interruption.', {
             align: 'center',
             width: 500
           })
           .fillColor('#9ca3af');
      } else {
        doc.text('Thank you for your business! We appreciate your timely payment.', {
          align: 'center',
          width: 500
        });
      }

      moveDownWithCheck(0.5);

      // Contact information
      doc.text('For any inquiries, please contact the property management office during business hours.', {
        align: 'center',
        width: 500
      });

      moveDownWithCheck(0.5);

      // Page number
      const totalPages = doc.bufferedPageRange().count;
      doc.text(`Page ${totalPages} of ${totalPages} - Generated on ${new Date().toLocaleDateString('en-US')}`, {
        align: 'center',
        width: 500
      });

      doc.end();
    } catch (error) {
      console.error('PDF Generation Error:', error);
      reject(error);
    }
  });
}