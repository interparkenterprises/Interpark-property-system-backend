import { PrismaClient } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js';
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs';
import path from 'path';

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
        margin: 40,
        size: 'A4'
      });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ===== ADD LETTERHEAD IMAGE =====

      
      // Get project root directory
      const projectRoot = process.cwd();
      
      // Define multiple possible paths for the letterhead
      const possiblePaths = [
        // Exact path based on your server structure
        path.join(projectRoot, 'src', 'letterHeads', 'letter head-02.jpg'),
        path.join(projectRoot, 'src', 'letterHeads', 'letter-head.jpg'),
        path.join(projectRoot, 'src', 'letterHeads', 'letter_head.jpg'),
        
        // Alternative paths in case you're running from a different directory
        path.join(__dirname, 'letterHeads', 'letter head-02.jpg'),
        path.join(__dirname, '..', 'letterHeads', 'letter head-02.jpg'),
        path.join(__dirname, '..', 'src', 'letterHeads', 'letter head-02.jpg'),
        
        // Common fallback paths
        '/root/Interpark-property-system-backend/src/letterHeads/letter head-02.jpg',
        '/home/ubuntu/Interpark-property-system-backend/src/letterHeads/letter head-02.jpg',
        '/var/www/Interpark-property-system-backend/src/letterHeads/letter head-02.jpg',
      ];

      let letterheadPath = null;
      let imageLoaded = false;
      const startY = 100; // Starting position below letterhead

      // Try each possible path
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            letterheadPath = possiblePath;
            console.log(`✓ Found letterhead at: ${possiblePath}`);
            break;
          }
        } catch (err) {
          continue;
        }
      }

      // Add letterhead if found
      if (letterheadPath) {
        try {
          // Add letterhead image at the top
          doc.image(letterheadPath, 40, 15, { 
            width: 510, 
            height: 70
          });
          
          // Adjust the Y position to start below the letterhead
          doc.y = startY;
          imageLoaded = true;
        } catch (imageError) {
          console.warn('Could not load letterhead image:', imageError.message);
          imageLoaded = false;
        }
      }

      // Fallback if no image loaded
      if (!imageLoaded) {
        doc.y = 40;
        doc.fontSize(18)
          .fillColor('#2563eb')
          .font('Helvetica-Bold')
          .text('INTERPARK ENTERPRISES LIMITED', { 
            align: 'center'
          });
        doc.moveDown(0.5);
      }

      // Safe number formatting functions
      const safeNum = (val) => {
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };
      
      const safeStr = (val) => safeNum(val).toFixed(2);
      const formatCurrency = (val) => `Ksh ${safeNum(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Helper function to move down with overflow check (simplified for single page)
      const moveDownWithCheck = (lines = 1) => {
        const lineHeight = doc.currentLineHeight();
        const newY = doc.y + (lineHeight * lines);
        
        // Check if we're near the bottom of the page
        if (newY > doc.page.height - 80) {
          // Try to compress content instead of adding new page
          doc.moveDown(lines * 0.7); // Reduce spacing
          return;
        }
        
        doc.moveDown(lines);
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
      // INVOICE TITLE
      // ===========================================
      
      doc.fontSize(20)
         .fillColor('#1e293b')
         .font('Helvetica-Bold')
         .text('UTILITY BILL INVOICE', { 
           align: 'center'
         });
      
      moveDownWithCheck(0.5);

      // ===========================================
      // INVOICE DETAILS & BILLED TO - SIDE BY SIDE
      // ===========================================
      
      const infoTop = doc.y;
      
      // Left Column - Invoice Details
      doc.fontSize(9)
         .fillColor('#374151')
         .font('Helvetica-Bold')
         .text('INVOICE DETAILS:', 40, infoTop, { underline: true });
      
      doc.font('Helvetica')
         .fontSize(8.5)
         .text(`Invoice No: ${billInvoice.invoiceNumber || 'N/A'}`, 40, infoTop + 12)
         .text(`Issue Date: ${billInvoice.issueDate ? new Date(billInvoice.issueDate).toLocaleDateString('en-US') : 'N/A'}`, 40, infoTop + 24)
         .text(`Due Date: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`, 40, infoTop + 36)
         .text(`Bill Ref: ${billInvoice.billReferenceNumber || 'N/A'}`, 40, infoTop + 48)
         .text(`Bill Date: ${billInvoice.billReferenceDate ? new Date(billInvoice.billReferenceDate).toLocaleDateString('en-US') : 'N/A'}`, 40, infoTop + 60);

      // Right Column - Billed To
      const billedToTop = infoTop;
      doc.fontSize(9)
         .fillColor('#374151')
         .font('Helvetica-Bold')
         .text('BILLED TO:', 280, billedToTop, { underline: true });
      
      doc.font('Helvetica')
         .fontSize(8.5)
         .text(billInvoice.tenant?.fullName || 'N/A', 280, billedToTop + 12)
         .text(`Contact: ${billInvoice.tenant?.contact || 'N/A'}`, 280, billedToTop + 24)
         .text(`Unit: ${billInvoice.tenant?.unit?.unitNo || 'N/A'}`, 280, billedToTop + 36)
         .text(`Property: ${billInvoice.tenant?.unit?.property?.name || 'N/A'}`, 280, billedToTop + 48);

      // Status Badge - placed at the right side above both columns
      const statusColor = 
        status === 'PAID' ? '#10b981' : 
        status === 'PARTIAL' ? '#f59e0b' : 
        status === 'OVERDUE' ? '#dc2626' : 
        status === 'CANCELLED' ? '#6b7280' : '#ef4444';

      const statusBoxTop = infoTop;
      const statusBoxWidth = 100;
      const statusBoxHeight = 25;
      const statusBoxX = 510 - statusBoxWidth;
      
      doc.rect(statusBoxX, statusBoxTop, statusBoxWidth, statusBoxHeight)
         .fillAndStroke(statusColor, statusColor);
      
      doc.fillColor('#ffffff')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text(status.toUpperCase(), statusBoxX, statusBoxTop + 7, { 
           width: statusBoxWidth, 
           align: 'center' 
         });

      // Move Y position to after the invoice details section
      doc.y = Math.max(infoTop + 72, billedToTop + 60);
      
      moveDownWithCheck(0.3);

      // ===========================================
      // BILL TYPE & METER READINGS
      // ===========================================
      
      doc.fillColor('#2563eb')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(`BILL TYPE: ${billInvoice.billType || 'N/A'}`, { underline: true });
      
      moveDownWithCheck(0.5);

      // Meter Readings Table
      const readingsTop = doc.y;
      
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('METER READING DETAILS', { underline: true });
      
      moveDownWithCheck(0.3);

      // Table headers
      const tableRowHeight = 18;
      let currentRowY = doc.y;
      
      doc.fillColor('#1e293b')
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('Description', 40, currentRowY)
         .text('Reading', 250, currentRowY)
         .text('Unit', 400, currentRowY);

      // Separator line
      currentRowY += 12;
      doc.rect(40, currentRowY, 510, 0.5).fillAndStroke('#cbd5e1', '#cbd5e1');
      
      // Previous Reading
      currentRowY += 8;
      doc.fillColor('#374151')
         .fontSize(8.5)
         .font('Helvetica')
         .text('Previous Reading', 40, currentRowY)
         .text(safeStr(previousReading), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 400, currentRowY);

      // Current Reading
      currentRowY += tableRowHeight;
      doc.fillColor('#374151')
         .text('Current Reading', 40, currentRowY)
         .text(safeStr(currentReading), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 400, currentRowY);

      // Separator line
      currentRowY += 12;
      doc.rect(40, currentRowY, 510, 0.5).fillAndStroke('#cbd5e1', '#cbd5e1');
      
      // Total Units Consumed
      currentRowY += 8;
      doc.fillColor('#1e293b')
         .fontSize(9.5)
         .font('Helvetica-Bold')
         .text('Total Units Consumed', 40, currentRowY)
         .text(safeStr(units), 250, currentRowY)
         .text(billInvoice.billType === 'ELECTRICITY' ? 'kWh' : 'm³', 400, currentRowY);

      // Update doc.y to continue after the table
      doc.y = currentRowY + tableRowHeight + 10;
      moveDownWithCheck(0.5);

      // ===========================================
      // BILL CALCULATION & CHARGES
      // ===========================================
      
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('BILL CALCULATION', { underline: true });
      
      moveDownWithCheck(0.3);

      const chargesTop = doc.y;
      currentRowY = chargesTop;
      
      // Table headers
      doc.fillColor('#1e293b')
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('Description', 40, currentRowY)
         .text('Rate/Amount', 300, currentRowY)
         .text('Amount (Ksh)', 450, currentRowY);

      // Separator line
      currentRowY += 12;
      doc.rect(40, currentRowY, 510, 0.5).fillAndStroke('#cbd5e1', '#cbd5e1');
      
      currentRowY += 8;

      // Units Charge
      doc.fillColor('#374151')
         .fontSize(8.5)
         .font('Helvetica')
         .text(`${safeStr(units)} units consumed`, 40, currentRowY)
         .text(`@ Ksh ${safeStr(chargePerUnit)} per unit`, 300, currentRowY)
         .text(formatCurrency(totalAmount), 450, currentRowY);

      currentRowY += tableRowHeight;

      // VAT (if applicable)
      if (vatAmount > 0 && vatRate > 0) {
        doc.text(`VAT (${safeStr(vatRate)}%)`, 40, currentRowY)
           .text('', 300, currentRowY)
           .text(formatCurrency(vatAmount), 450, currentRowY);
        currentRowY += tableRowHeight;
      }

      // Separator line before total
      currentRowY += 5;
      doc.rect(40, currentRowY, 510, 0.5).fillAndStroke('#cbd5e1', '#cbd5e1');
      currentRowY += 10;

      // Grand Total
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('GRAND TOTAL', 40, currentRowY)
         .text(formatCurrency(grandTotal), 450, currentRowY);

      currentRowY += tableRowHeight + 8;

      // Amount Paid (if any)
      if (amountPaid > 0) {
        doc.fillColor('#10b981')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('Amount Paid', 40, currentRowY)
           .text(formatCurrency(amountPaid), 450, currentRowY);
        currentRowY += tableRowHeight + 5;
      }

      // Balance Due
      const balanceColor = balance === 0 ? '#10b981' : 
                          status === 'OVERDUE' ? '#dc2626' : '#ef4444';
      
      doc.fillColor(balanceColor)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('BALANCE DUE', 40, currentRowY)
         .text(formatCurrency(balance), 450, currentRowY);

      // Update doc.y to continue after the calculations table
      doc.y = currentRowY + tableRowHeight + 10;
      moveDownWithCheck(0.5);

      // ===========================================
      // PAYMENT INSTRUCTIONS (only for unpaid invoices)
      // ===========================================
      
      if (['UNPAID', 'PARTIAL', 'OVERDUE'].includes(status)) {
        doc.fillColor('#1e293b')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('PAYMENT INSTRUCTIONS', { underline: true });
        
        moveDownWithCheck(0.3);

        doc.fillColor('#374151')
           .fontSize(9)
           .font('Helvetica')
           .text(`• Please pay by: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`)
           .text(`• Reference Number: ${billInvoice.invoiceNumber}`)
           .text('• Payment Methods: Bank Transfer, Mobile Money, or Cash')
           .text('• For assistance, contact property management');
        
        moveDownWithCheck(0.5);
      }

      // ===========================================
      // NOTES SECTION
      // ===========================================
      
      if (billInvoice.notes) {
        doc.fillColor('#1e293b')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('NOTES', { underline: true });
        
        moveDownWithCheck(0.3);

        doc.fillColor('#374151')
           .fontSize(9)
           .font('Helvetica')
           .text(billInvoice.notes, { 
             width: 510,
             align: 'left' 
           });
        
        moveDownWithCheck(0.5);
      }

      // ===========================================
      // FOOTER
      // ===========================================
      
      // Footer separator
      const footerY = Math.min(doc.y + 10, doc.page.height - 50);
      doc.y = footerY;
      
      doc.rect(40, doc.y, 510, 0.5).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      moveDownWithCheck(0.3);

      doc.fillColor('#6b7280')
         .fontSize(8)
         .font('Helvetica')
         .text('Interpark Enterprises Limited | Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke | Website: www.interparkenterprises.co.ke', {
           align: 'center',
           width: 510
         });

      moveDownWithCheck(0.2);

      doc.text(`Generated on ${new Date().toLocaleDateString('en-US')}`, {
        align: 'center',
        width: 510
      });

      doc.end();
    } catch (error) {
      console.error('PDF Generation Error:', error);
      reject(error);
    }
  });
}
