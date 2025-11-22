import prisma from '../lib/prisma.js';
import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js'; // You'll need to implement this
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';

// @desc    Generate invoice for tenant
// @route   POST /api/invoices/generate
// @access  Private
export const generateInvoice = async (req, res) => {
  try {
    const { tenantId, paymentReportId, dueDate, notes } = req.body;

    // Fetch tenant with unit and property details
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: true
          }
        },
        serviceCharge: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // Fetch payment report if provided
    let paymentReport = null;
    if (paymentReportId) {
      paymentReport = await prisma.paymentReport.findUnique({
        where: { id: paymentReportId }
      });
    }

    // Calculate invoice details
    const rent = paymentReport?.rent || tenant.rent;
    let serviceCharge = 0;
    
    if (tenant.serviceCharge) {
      if (tenant.serviceCharge.type === 'FIXED') {
        serviceCharge = tenant.serviceCharge.fixedAmount || 0;
      } else if (tenant.serviceCharge.type === 'PERCENTAGE') {
        serviceCharge = (rent * (tenant.serviceCharge.percentage || 0)) / 100;
      } else if (tenant.serviceCharge.type === 'PER_SQ_FT') {
        serviceCharge = (tenant.serviceCharge.perSqFtRate || 0) * (tenant.unit?.sizeSqFt || 0);
      }
    }

    const subtotal = rent + serviceCharge;
    const vat = paymentReport?.vat || (subtotal * 0.16); // 16% VAT
    const totalDue = subtotal + vat;
    const amountPaid = paymentReport?.amountPaid || 0;
    const balance = totalDue - amountPaid;

    // Generate unique invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Determine payment period
    const paymentPeriod = paymentReport?.paymentPeriod || 
      new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        tenantId,
        paymentReportId: paymentReportId || null,
        issueDate: new Date(),
        dueDate: new Date(dueDate),
        paymentPeriod,
        rent,
        serviceCharge,
        vat,
        totalDue,
        amountPaid,
        balance,
        status: amountPaid >= totalDue ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID',
        notes
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
        }
      }
    });

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoice);
    
    // Upload PDF to storage (implement your storage solution)
    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    // Update invoice with PDF URL
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice generated successfully'
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all invoices for a tenant
// @route   GET /api/invoices/tenant/:tenantId
// @access  Private
export const getInvoicesByTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const where = { tenantId };
    if (status) {
      where.status = status;
    }

    const total = await prisma.invoice.count({ where });

    const invoices = await prisma.invoice.findMany({
      where,
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
      orderBy: { issueDate: 'desc' },
      skip,
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
export const getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
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
        paymentReport: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update invoice status
// @route   PATCH /api/invoices/:id/status
// @access  Private
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amountPaid } = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const updateData = { status };
    
    if (amountPaid !== undefined) {
      updateData.amountPaid = amountPaid;
      updateData.balance = invoice.totalDue - amountPaid;
      
      // Auto-update status based on payment
      if (amountPaid >= invoice.totalDue) {
        updateData.status = 'PAID';
      } else if (amountPaid > 0) {
        updateData.status = 'PARTIAL';
      }
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice updated successfully'
    });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Download invoice PDF
// @route   GET /api/invoices/:id/download
// @access  Private
export const downloadInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
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

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Generate PDF if not exists or regenerate
    const pdfBuffer = await generateInvoicePDF(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper function to generate PDF
async function generateInvoicePDF(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Company Header
      doc.fontSize(20)
        .fillColor('#2563eb')
        .text(invoice.tenant.unit?.property?.name || 'Property Management', { align: 'center' });
      
      doc.fontSize(10)
        .fillColor('#666')
        .text('Property Management System', { align: 'center' })
        .moveDown();

      // Invoice Title
      doc.fontSize(28)
        .fillColor('#1e293b')
        .text('INVOICE', { align: 'center' })
        .moveDown();

      // Invoice Details Box
      const topY = doc.y;
      doc.fontSize(10)
        .fillColor('#1e293b')
        .text(`Invoice Number: ${invoice.invoiceNumber}`, 50, topY)
        .text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString('en-US')}`)
        .text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-US')}`)
        .text(`Payment Period: ${invoice.paymentPeriod}`);

      // Status Badge
      doc.rect(400, topY, 100, 30)
        .fillAndStroke(
          invoice.status === 'PAID' ? '#10b981' : 
          invoice.status === 'PARTIAL' ? '#f59e0b' : '#ef4444',
          '#000'
        );
      
      doc.fillColor('#fff')
        .fontSize(12)
        .text(invoice.status, 400, topY + 8, { width: 100, align: 'center' });

      doc.moveDown(3);

      // Tenant Information
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('BILL TO:', { underline: true })
        .moveDown(0.5);

      doc.fontSize(10)
        .fillColor('#374151')
        .text(invoice.tenant.fullName)
        .text(`Contact: ${invoice.tenant.contact}`)
        .text(`Unit: ${invoice.tenant.unit?.type || 'N/A'}`)
        .text(`Property: ${invoice.tenant.unit?.property?.name || 'N/A'}`)
        .moveDown(2);

      // Line Items Table
      const tableTop = doc.y;
      const itemX = 50;
      const descX = 200;
      const amountX = 450;

      // Table Header
      doc.rect(50, tableTop, 500, 25)
        .fillAndStroke('#2563eb', '#2563eb');

      doc.fillColor('#fff')
        .fontSize(11)
        .text('Item', itemX + 5, tableTop + 7)
        .text('Description', descX, tableTop + 7)
        .text('Amount (Ksh)', amountX, tableTop + 7);

      let currentY = tableTop + 30;

      // Rent
      doc.fillColor('#1e293b')
        .fontSize(10)
        .text('Rent', itemX + 5, currentY)
        .text(`Monthly rent for ${invoice.paymentPeriod}`, descX, currentY)
        .text(invoice.rent.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY);

      currentY += 25;

      // Service Charge
      if (invoice.serviceCharge && invoice.serviceCharge > 0) {
        doc.text('Service Charge', itemX + 5, currentY)
          .text('Property service charge', descX, currentY)
          .text(invoice.serviceCharge.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY);
        currentY += 25;
      }

      // Subtotal
      doc.rect(50, currentY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      currentY += 10;

      const subtotal = invoice.rent + (invoice.serviceCharge || 0);
      doc.fontSize(10)
        .text('Subtotal', descX, currentY)
        .text(subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY);

      currentY += 20;

      // VAT
      if (invoice.vat && invoice.vat > 0) {
        doc.text('VAT (16%)', descX, currentY)
          .text(invoice.vat.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY);
        currentY += 25;
      }

      // Total Due
      doc.rect(50, currentY, 500, 30)
        .fillAndStroke('#f3f4f6', '#f3f4f6');

      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('TOTAL DUE', descX, currentY + 8, { bold: true })
        .text(`Ksh ${invoice.totalDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX - 10, currentY + 8);

      currentY += 40;

      // Amount Paid
      if (invoice.amountPaid > 0) {
        doc.fontSize(10)
          .fillColor('#10b981')
          .text('Amount Paid', descX, currentY)
          .text(`Ksh ${invoice.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX, currentY);
        currentY += 20;
      }

      // Balance
      doc.fontSize(11)
        .fillColor(invoice.balance > 0 ? '#ef4444' : '#10b981')
        .text('Balance Due', descX, currentY, { bold: true })
        .text(`Ksh ${invoice.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX, currentY);

      // Notes
      if (invoice.notes) {
        doc.moveDown(2)
          .fontSize(10)
          .fillColor('#374151')
          .text('Notes:', 50)
          .text(invoice.notes, { width: 500 });
      }

      // Footer
      doc.fontSize(8)
        .fillColor('#9ca3af')
        .text(
          'Thank you for your business!',
          50,
          doc.page.height - 100,
          { align: 'center', width: 500 }
        )
        .text(
          'For inquiries, please contact the property management office.',
          { align: 'center', width: 500 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
