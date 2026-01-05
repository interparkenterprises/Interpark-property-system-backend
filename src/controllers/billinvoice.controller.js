import prisma from "../lib/prisma.js";
import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js';
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sizeOf from 'image-size';

//const prisma = new PrismaClient();

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        paymentPolicy: bill.tenant.paymentPolicy, // Add payment policy from tenant
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
    const pdfBuffer = await generateBillInvoicePDF(billInvoice,  bill.description);
    
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
    const { page = 1, limit = 10, status, tenantId, billType, paymentPolicy } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereClause = {};
    if (status) whereClause.status = status;
    if (tenantId) whereClause.tenantId = tenantId;
    if (billType) whereClause.billType = billType;
    if (paymentPolicy) whereClause.paymentPolicy = paymentPolicy;

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
            paymentPolicy: true,
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
    const { page = 1, limit = 10, status, billType, paymentPolicy } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereClause = { tenantId };
    if (status) whereClause.status = status;
    if (billType) whereClause.billType = billType;
    if (paymentPolicy) whereClause.paymentPolicy = paymentPolicy;

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
            paymentPolicy: true,
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

// @desc    Get bill invoices by payment policy
// @route   GET /api/bill-invoices/payment-policy/:policy
// @access  Private
export const getBillInvoicesByPaymentPolicy = async (req, res) => {
  try {
    const { policy } = req.params;
    const { page = 1, limit = 10, status, billType } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    // Validate payment policy
    const validPolicies = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
    if (!validPolicies.includes(policy.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment policy. Must be MONTHLY, QUARTERLY, or ANNUAL'
      });
    }

    const whereClause = { paymentPolicy: policy.toUpperCase() };
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
    console.error('Error fetching bill invoices by payment policy:', error);
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
              paymentPolicy: billInvoice.paymentPolicy, // Copy payment policy from original invoice
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

// @desc    Update bill invoice payment policy
// @route   PATCH /api/bill-invoices/:id/payment-policy
// @access  Private
export const updateBillInvoicePaymentPolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentPolicy } = req.body;

    // Validate payment policy
    const validPolicies = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
    if (!validPolicies.includes(paymentPolicy)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment policy. Must be MONTHLY, QUARTERLY, or ANNUAL'
      });
    }

    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: {
        tenant: true
      }
    });

    if (!billInvoice) {
      return res.status(404).json({
        success: false,
        error: 'Bill invoice not found'
      });
    }

    const updatedInvoice = await prisma.billInvoice.update({
      where: { id },
      data: { paymentPolicy }
    });

    res.status(200).json({
      success: true,
      data: updatedInvoice,
      message: 'Bill invoice payment policy updated successfully'
    });
  } catch (error) {
    console.error('Error updating bill invoice payment policy:', error);
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
async function generateBillInvoicePDF(billInvoice, billDescription) {
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

      /* =====================================================
         LETTERHEAD IMAGE HANDLING (SAFE & SERVER-READY)
      ====================================================== */

      const projectRoot = process.cwd();
      const possiblePaths = [
        path.join(projectRoot, 'src', 'letterHeads', 'letterhead.png'),
        path.join(__dirname, 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'src', 'letterHeads', 'letterhead.png'),
        '/root/Interpark-property-system-backend/src/letterHeads/letterhead.png',
        '/home/ubuntu/Interpark-property-system-backend/src/letterHeads/letterhead.png',
        '/var/www/Interpark-property-system-backend/src/letterHeads/letterhead.png',
      ];

      let letterheadPath = null;
      let imageLoaded = false;
      const startY = 120;

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          const stats = fs.statSync(possiblePath);
          if (stats.size > 0) {
            letterheadPath = possiblePath;
            console.log(`✓ Letterhead found: ${possiblePath}`);
            break;
          }
        }
      }

      if (letterheadPath) {
        try {
          const imageBuffer = fs.readFileSync(letterheadPath);
          const dimensions = sizeOf(imageBuffer);

          // Max usable width (page width minus margins)
          const maxWidth = doc.page.width - 100;

          // Calculate proportional height
          const scale = maxWidth / dimensions.width;
          const scaledHeight = dimensions.height * scale;

          // Optional: cap height if image is extremely tall
          const finalHeight = Math.min(scaledHeight, 120);

          // Recalculate width if height was capped
          const finalWidth =
            finalHeight !== scaledHeight
              ? (dimensions.width * finalHeight) / dimensions.height
              : maxWidth;

          const xPosition = 50 + (maxWidth - finalWidth) / 2;

          doc.image(imageBuffer, xPosition, 30, {
            width: finalWidth,
          });

          doc.y = 30 + finalHeight + 20;
          imageLoaded = true;

          console.log('✓ Letterhead rendered with correct proportions');
        } catch (err) {
          console.warn('✗ Letterhead failed to load:', err.message);
        }
      }
      // Fallback if no image loaded
      if (!imageLoaded) {
        console.warn('Using fallback text header');
        doc.y = 40;
        doc.fontSize(18)
          .fillColor('#2563eb')
          .font('Helvetica-Bold')
          .text('INTERPARK ENTERPRISES LIMITED', { 
            align: 'center'
          });
        doc.moveDown(0.5);
      }

      console.log('=== End Debug Info ===\n');
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
      const paymentPolicy = billInvoice.paymentPolicy || 'MONTHLY';
      const description = billDescription || null;

      // ===========================================
      // INVOICE TITLE
      // ===========================================
      
      doc.fontSize(20)
         .fillColor('#1e293b')
         .font('Helvetica-Bold')
         .text('UTILITY BILL INVOICE', { 
           align: 'center'
         })
         .moveDown(0.3);
      
      // Property name below the title (bold but smaller)
      const propertyName = billInvoice.tenant?.unit?.property?.name || 'N/A';
      doc.fontSize(14)
         .fillColor('#005478') // Using the blue color from your design
         .font('Helvetica-Bold')
         .text(propertyName, { align: 'center' })
         .font('Helvetica') // Reset to regular font
         .moveDown(1);

      // ===========================================
      // DESCRIPTION (if available)
      // ===========================================
      
      if (description) {
        doc.fillColor('#374151')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text('Description:', { 
             align: 'center',
             width: 510
           })
           .moveDown(0.2);
        
        doc.fillColor('#4b5563')
           .fontSize(10)
           .font('Helvetica')
           .text(description, { 
             align: 'center',
             width: 510
           })
           .moveDown(0.5);
      }

      // ===========================================
      // INVOICE DETAILS & BILLED TO - SIDE BY SIDE
      // ===========================================
      
      const infoTop = doc.y;
      
      // Left Column - Invoice Details
      doc.fontSize(9)
         .fillColor('#374151')
         .font('Helvetica-Bold')
         .text('INVOICE DETAILS:', 40, infoTop, { underline: true });
      
      // Adjust Y positions based on whether description was added
      let invoiceDetailsY = infoTop + 12;
      const lineHeight = 12;
      
      doc.font('Helvetica')
         .fontSize(8.5)
         .text(`Invoice No: ${billInvoice.invoiceNumber || 'N/A'}`, 40, invoiceDetailsY);
      
      invoiceDetailsY += lineHeight;
      doc.text(`Issue Date: ${billInvoice.issueDate ? new Date(billInvoice.issueDate).toLocaleDateString('en-US') : 'N/A'}`, 40, invoiceDetailsY);
      
      invoiceDetailsY += lineHeight;
      doc.text(`Due Date: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`, 40, invoiceDetailsY);
      
      invoiceDetailsY += lineHeight;
      doc.text(`Payment Policy: ${paymentPolicy}`, 40, invoiceDetailsY);
      
      invoiceDetailsY += lineHeight;
      doc.text(`Bill Ref: ${billInvoice.billReferenceNumber || 'N/A'}`, 40, invoiceDetailsY);
      
      invoiceDetailsY += lineHeight;
      doc.text(`Bill Date: ${billInvoice.billReferenceDate ? new Date(billInvoice.billReferenceDate).toLocaleDateString('en-US') : 'N/A'}`, 40, invoiceDetailsY);

      // Right Column - Billed To (with KRA Pin)
      const billedToTop = infoTop;
      doc.fontSize(9)
         .fillColor('#374151')
         .font('Helvetica-Bold')
         .text('BILLED TO:', 280, billedToTop, { underline: true });
      
      let billedToY = billedToTop + 12;
      doc.font('Helvetica')
         .fontSize(8.5)
         .text(billInvoice.tenant?.fullName || 'N/A', 280, billedToY);
      
      billedToY += lineHeight;
      doc.text(`Contact: ${billInvoice.tenant?.contact || 'N/A'}`, 280, billedToY);
      
      billedToY += lineHeight;
      doc.text(`KRA Pin: ${billInvoice.tenant?.KRAPin || 'N/A'}`, 280, billedToY);
      
      billedToY += lineHeight;
      doc.text(`Unit: ${billInvoice.tenant?.unit?.unitNo || 'N/A'}`, 280, billedToY);
      
      billedToY += lineHeight;
      doc.text(`Payment Frequency: ${paymentPolicy}`, 280, billedToY);

      // Move Y position to after the invoice details section
      doc.y = Math.max(invoiceDetailsY + lineHeight, billedToY + lineHeight);
      
      moveDownWithCheck(0.3);

      // ===========================================
      // BILL TYPE & METER READINGS
      // ===========================================
      // Reset position to ensure clean centering
      doc.x = 40; // Set x to left margin
      
      // BILL TYPE - Centered
      doc.fillColor('#2563eb')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(`BILL TYPE: ${billInvoice.billType || 'N/A'}`, { 
           align: 'center',
           width: 510,
           underline: true 
         });
      
      moveDownWithCheck(0.5);

      // Meter Readings Table - Aligned left
      const readingsTop = doc.y;
      
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('METER READING DETAILS', 40, readingsTop, { 
           underline: true 
         });
      
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
      
      // BILL CALCULATION - Aligned left
      doc.fillColor('#1e293b')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('BILL CALCULATION', 40, doc.y, { 
           underline: true 
         });
      
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
      // PAYMENT POLICY NOTE
      // ===========================================
      
      let paymentPolicyNote = '';
      if (paymentPolicy === 'MONTHLY') {
        paymentPolicyNote = 'Note: This is a monthly utility invoice. Bills are generated monthly based on consumption.';
      } else if (paymentPolicy === 'QUARTERLY') {
        paymentPolicyNote = 'Note: This is a quarterly utility invoice. Bills are generated every 3 months based on consumption.';
      } else if (paymentPolicy === 'ANNUAL') {
        paymentPolicyNote = 'Note: This is an annual utility invoice. Bill is for the full year\'s consumption.';
      }

      if (paymentPolicyNote) {
        doc.fillColor('#374151')
           .fontSize(9)
           .font('Helvetica')
           .text(paymentPolicyNote, 40, doc.y, { 
             width: 510,
             align: 'left'
           });
        
        moveDownWithCheck(0.5);
      }

      // ===========================================
      // PAYMENT INSTRUCTIONS (only for unpaid invoices)
      // ===========================================

      if (['UNPAID', 'PARTIAL', 'OVERDUE'].includes(status)) {
        // PAYMENT INSTRUCTIONS - Aligned left
        doc.fillColor('#1e293b')
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('PAYMENT INSTRUCTIONS', 40, doc.y, { 
            underline: true 
          });
        
        moveDownWithCheck(0.3);

        // Get property payment details
        const property = billInvoice.tenant?.unit?.property;
        
        // Due date
        doc.fillColor('#374151')
          .fontSize(9)
          .font('Helvetica')
          .text(`Please pay by: ${billInvoice.dueDate ? new Date(billInvoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`, 40, doc.y);
        
        moveDownWithCheck(0.5);

        // Bank Transfer Details (if available)
        if (property && (property.accountName || property.accountNo || property.bank)) {
          doc.fillColor('#1e293b')
            .fontSize(9)
            .font('Helvetica-Bold')
            .text('Bank Transfer Details:', 40, doc.y);
          
          moveDownWithCheck(0.3);
          
          let bankDetailsY = doc.y;
          
          if (property.accountName) {
            doc.fillColor('#374151')
              .fontSize(8.5)
              .font('Helvetica')
              .text(`Account Name: ${property.accountName}`, 40, bankDetailsY);
            bankDetailsY += 15;
          }
          
          if (property.accountNo) {
            doc.fillColor('#374151')
              .fontSize(8.5)
              .font('Helvetica')
              .text(`Account Number: ${property.accountNo}`, 40, bankDetailsY);
            bankDetailsY += 15;
          }
          
          if (property.bank) {
            doc.fillColor('#374151')
              .fontSize(8.5)
              .font('Helvetica')
              .text(`Bank: ${property.bank}`, 40, bankDetailsY);
            bankDetailsY += 15;
          }
          
          if (property.branch) {
            doc.fillColor('#374151')
              .fontSize(8.5)
              .font('Helvetica')
              .text(`Branch: ${property.branch}`, 40, bankDetailsY);
            bankDetailsY += 15;
          }
          
          if (property.branchCode) {
            doc.fillColor('#374151')
              .fontSize(8.5)
              .font('Helvetica')
              .text(`Branch Code: ${property.branchCode}`, 40, bankDetailsY);
            bankDetailsY += 15;
          }
          
          doc.y = bankDetailsY;
          moveDownWithCheck(0.5);
        } else {
          // Default payment methods if no bank details
          doc.fillColor('#374151')
            .fontSize(9)
            .font('Helvetica')
            .text('Payment Methods: Bank Transfer, Mobile Money, or Cash', 40, doc.y);
          
          moveDownWithCheck(0.5);
        }

        // Contact information
        doc.fillColor('#374151')
          .fontSize(9)
          .font('Helvetica')
          .text('For assistance, contact property management', 40, doc.y);
        
        moveDownWithCheck(0.5);
      }
      // ===========================================
      // NOTES SECTION
      // ===========================================
      
      if (billInvoice.notes) {
        // NOTES - Aligned left
        doc.fillColor('#1e293b')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('NOTES', 40, doc.y, { 
             underline: true 
           });
        
        moveDownWithCheck(0.3);

        doc.fillColor('#374151')
           .fontSize(9)
           .font('Helvetica')
           .text(billInvoice.notes, 40, doc.y, { 
             width: 510,
             align: 'left' 
           });
        
        moveDownWithCheck(0.5);
      }

      // ===========================================
      // FOOTER
      // ===========================================

      // Add significant space before footer to make it look like a proper footer
      // First, check if we're near the bottom of the page
      if (doc.y < doc.page.height - 100) {
        // Add more space to push footer to bottom
        doc.y = doc.page.height - 60; // Position footer 60px from bottom
      } else {
        // If we're already near bottom, just add some space
        moveDownWithCheck(3); // Add 3 lines of space
      }

      // Footer separator
      doc.rect(40, doc.y, 510, 0.5).fillAndStroke('#e5e7eb', '#e5e7eb');
            
      moveDownWithCheck(0.5);

      // FOOTER - Left aligned
      doc.fillColor('#6b7280')
         .fontSize(8)
         .font('Helvetica')
         .text('Interpark Enterprises Limited | Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke | Website: www.interparkenterprises.co.ke', 40, doc.y, {
           align: 'left',
           width: 510
         });

      moveDownWithCheck(0.3);

      doc.end();
    } catch (error) {
      console.error('PDF Generation Error:', error);
      reject(error);
    }
  });
}
// @desc    Get bill invoice statistics by payment policy
// @route   GET /api/bill-invoices/stats/payment-policy
// @access  Private
export const getBillInvoiceStatsByPaymentPolicy = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const whereClause = {};
    
    if (startDate || endDate) {
      whereClause.issueDate = {};
      if (startDate) {
        whereClause.issueDate.gte = new Date(startDate);
      }
      if (endDate) {
        whereClause.issueDate.lte = new Date(endDate);
      }
    }

    // Get all invoices grouped by payment policy
    const invoices = await prisma.billInvoice.findMany({
      where: whereClause,
      select: {
        paymentPolicy: true,
        grandTotal: true,
        amountPaid: true,
        balance: true,
        status: true,
        issueDate: true
      }
    });

    // Calculate statistics
    const stats = {
      MONTHLY: { 
        count: 0, 
        totalAmount: 0, 
        totalPaid: 0, 
        totalBalance: 0,
        paid: { count: 0, amount: 0 },
        unpaid: { count: 0, amount: 0 },
        partial: { count: 0, amount: 0 },
        overdue: { count: 0, amount: 0 }
      },
      QUARTERLY: { 
        count: 0, 
        totalAmount: 0, 
        totalPaid: 0, 
        totalBalance: 0,
        paid: { count: 0, amount: 0 },
        unpaid: { count: 0, amount: 0 },
        partial: { count: 0, amount: 0 },
        overdue: { count: 0, amount: 0 }
      },
      ANNUAL: { 
        count: 0, 
        totalAmount: 0, 
        totalPaid: 0, 
        totalBalance: 0,
        paid: { count: 0, amount: 0 },
        unpaid: { count: 0, amount: 0 },
        partial: { count: 0, amount: 0 },
        overdue: { count: 0, amount: 0 }
      }
    };

    invoices.forEach(invoice => {
      const policy = invoice.paymentPolicy || 'MONTHLY';
      const stat = stats[policy];
      
      if (stat) {
        stat.count++;
        stat.totalAmount += Number(invoice.grandTotal) || 0;
        stat.totalPaid += Number(invoice.amountPaid) || 0;
        stat.totalBalance += Number(invoice.balance) || 0;
        
        // Categorize by status
        const status = invoice.status || 'UNPAID';
        if (status === 'PAID') {
          stat.paid.count++;
          stat.paid.amount += Number(invoice.grandTotal) || 0;
        } else if (status === 'UNPAID') {
          stat.unpaid.count++;
          stat.unpaid.amount += Number(invoice.grandTotal) || 0;
        } else if (status === 'PARTIAL') {
          stat.partial.count++;
          stat.partial.amount += Number(invoice.grandTotal) || 0;
        } else if (status === 'OVERDUE') {
          stat.overdue.count++;
          stat.overdue.amount += Number(invoice.grandTotal) || 0;
        }
      }
    });

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching bill invoice statistics:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};