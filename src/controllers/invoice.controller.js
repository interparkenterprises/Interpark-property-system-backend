import prisma from '../lib/prisma.js';
import PDFDocument from 'pdfkit';
import { uploadToStorage } from '../utils/storage.js'; // You'll need to implement this
import { generateInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs'; 
import path from 'path'; 
import { fileURLToPath } from 'url';


// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    // Calculate VAT based on tenant's VAT configuration
    let vat = 0;
    let vatRate = tenant.vatRate || 0;
    
    if (vatRate > 0 && tenant.vatType !== 'NOT_APPLICABLE') {
      if (tenant.vatType === 'INCLUSIVE') {
        // VAT is already included in the rent amount
        // Extract VAT from the subtotal: VAT = subtotal - (subtotal / (1 + vatRate/100))
        vat = subtotal - (subtotal / (1 + vatRate / 100));
      } else if (tenant.vatType === 'EXCLUSIVE') {
        // VAT is added on top of the subtotal
        vat = (subtotal * vatRate) / 100;
      }
    }
    
    // Use payment report VAT if provided, otherwise use calculated VAT
    vat = paymentReport?.vat !== undefined ? paymentReport.vat : vat;

    // Calculate total based on VAT type
    let totalDue;
    if (tenant.vatType === 'INCLUSIVE') {
      // VAT is already included in the subtotal
      totalDue = subtotal;
    } else {
      // VAT is exclusive or not applicable
      totalDue = subtotal + vat;
    }

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
    const pdfBuffer = await generateInvoicePDF(invoice, tenant);
    
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
            vatRate: true,
            vatType: true,
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
    const pdfBuffer = await generateInvoicePDF(invoice, invoice.tenant);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper function to generate PDF
async function generateInvoicePDF(invoice, tenant) {
  return new Promise((resolve, reject) => {
    try {
      // Create __dirname equivalent for ES modules
      //const __filename = fileURLToPath(import.meta.url);
      //const __dirname = path.dirname(__filename);
      
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ===== IMPROVED LETTERHEAD IMAGE HANDLING =====
      
      // Get project root directory
      const projectRoot = process.cwd();
      
      // Define multiple possible paths for the letterhead based on your exact server structure
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
      const startY = 120; // Default starting position below letterhead

      // Debug logging
      console.log('=== Regular Invoice PDF Generation Debug Info ===');
      console.log('Project Root (cwd):', projectRoot);
      console.log('Current File Directory (__dirname):', __dirname);
      console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

      // Try each possible path
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            letterheadPath = possiblePath;
            console.log(`✓ Found letterhead at: ${possiblePath}`);
            break;
          } else {
            console.log(`✗ Not found: ${possiblePath}`);
          }
        } catch (err) {
          console.log(`✗ Error checking: ${possiblePath} - ${err.message}`);
          continue;
        }
      }

      // Add letterhead if found
      if (letterheadPath) {
        try {
          // Add letterhead image at the top
          doc.image(letterheadPath, 50, 30, { 
            width: 500, 
            height: 80
          });
          
          // Adjust the Y position to start below the letterhead
          doc.y = startY;
          imageLoaded = true;
          console.log('✓ Letterhead image loaded successfully');
        } catch (imageError) {
          console.warn('✗ Could not load letterhead image:', imageError.message);
          console.warn('Image path that failed:', letterheadPath);
          imageLoaded = false;
        }
      } else {
        console.warn('✗ Letterhead image not found in any of the searched paths');
      }

      // Fallback if no image loaded
      if (!imageLoaded) {
        console.warn('Using fallback text header');
        
        // Fallback: start at adjusted position
        doc.y = 100;
        
        // Add a placeholder header instead
        doc.fontSize(20)
          .fillColor('#1e293b')
          .text('INTERPARK ENTERPRISES LIMITED', 50, 50, { align: 'center' })
          .moveDown(0.5);
      }

      console.log('=== End Debug Info ===\n');

      // Move cursor below letterhead
      doc.moveDown(2);

      // Invoice Title
      doc.fontSize(28)
        .fillColor('#1e293b')
        .text('INVOICE', { align: 'center' })
        .moveDown(0.5);

      // Invoice Details Box
      const topY = doc.y;
      
      // Left column - Invoice details
      doc.fontSize(10)
        .fillColor('#1e293b')
        .text(`Invoice Number: ${invoice.invoiceNumber}`, 50, topY)
        .text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString('en-US')}`, 50, topY + 15)
        .text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-US')}`, 50, topY + 30)
        .text(`Payment Period: ${invoice.paymentPeriod}`, 50, topY + 45);

      // VAT Information - right column
      if (tenant.vatRate > 0 && tenant.vatType !== 'NOT_APPLICABLE') {
        doc.text(`VAT Rate: ${tenant.vatRate}% (${tenant.vatType})`, 300, topY + 15);
      }

      doc.moveDown(3);

      // Tenant Information Section
      const tenantY = doc.y;
      
      // Left side - BILL TO
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('BILL TO:', 50, tenantY, { underline: true })
        .moveDown(0.5);

      doc.fontSize(10)
        .fillColor('#374151')
        .text(invoice.tenant.fullName, 50, tenantY + 25)
        .text(`Contact: ${invoice.tenant.contact}`, 50, tenantY + 40)
        .text(`Unit: ${invoice.tenant.unit?.type || 'N/A'}`, 50, tenantY + 55)
        .text(`Property: ${invoice.tenant.unit?.property?.name || 'N/A'}`, 50, tenantY + 70);

      // Right side - Property/Landlord Information
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('FROM:', 300, tenantY, { underline: true })
        .moveDown(0.5);

      doc.fontSize(10)
        .fillColor('#374151')
        .text('Interpark Enterprises Limited', 300, tenantY + 25)
        .text('Tel: 0110 060 088', 300, tenantY + 40)
        .text('Email: info@interparkenterprises.co.ke', 300, tenantY + 55)
        .text('Website: www.interparkenterprises.co.ke', 300, tenantY + 70);

      doc.moveDown(4);

      // Line Items Table
      const tableTop = doc.y;
      const itemX = 50;
      const descX = 200;
      const amountX = 450;
      const rowHeight = 25;

      // Table Header
      doc.rect(itemX, tableTop, 500, rowHeight)
        .fillAndStroke('#2563eb', '#2563eb');

      doc.fillColor('#fff')
        .fontSize(11)
        .text('Item', itemX + 10, tableTop + 8)
        .text('Description', descX, tableTop + 8)
        .text('Amount (Ksh)', amountX, tableTop + 8, { width: 80, align: 'right' });

      let currentY = tableTop + rowHeight;

      // Rent Row
      doc.fillColor('#1e293b')
        .fontSize(10)
        .text('Rent', itemX + 10, currentY + 8)
        .text(`Monthly rent for ${invoice.paymentPeriod}`, descX, currentY + 8)
        .text(invoice.rent.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY + 8, { width: 80, align: 'right' });

      currentY += rowHeight;

      // Service Charge Row (if applicable)
      if (invoice.serviceCharge && invoice.serviceCharge > 0) {
        doc.text('Service Charge', itemX + 10, currentY + 8)
          .text('Property service charge', descX, currentY + 8)
          .text(invoice.serviceCharge.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY + 8, { width: 80, align: 'right' });
        currentY += rowHeight;
      }

      // Separator line before calculations
      doc.rect(itemX, currentY, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      currentY += 15;

      // Subtotal - Clear and visible
      const subtotal = invoice.rent + (invoice.serviceCharge || 0);
      doc.fontSize(11)
        .fillColor('#374151')
        .text('Subtotal:', descX, currentY + 5)
        .text(subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY + 5, { width: 80, align: 'right' });

      currentY += 25;

      // VAT - Clear and visible (only if applicable)
      if (invoice.vat && invoice.vat > 0 && tenant.vatType !== 'NOT_APPLICABLE') {
        const vatLabel = tenant.vatType === 'INCLUSIVE' ? 'VAT (Inclusive):' : `VAT (${tenant.vatRate}%):`;
        doc.text(vatLabel, descX, currentY + 5)
          .text(invoice.vat.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY + 5, { width: 80, align: 'right' });
        currentY += 25;
      }

      // Total Due Section - Prominent display
      currentY += 10;
      doc.rect(itemX, currentY, 500, 35)
        .fillAndStroke('#f8fafc', '#e2e8f0');

      doc.fontSize(14)
        .fillColor('#1e293b')
        .text('TOTAL DUE:', descX, currentY + 10, { bold: true })
        .text(`Ksh ${invoice.totalDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX - 10, currentY + 10, { width: 90, align: 'right', bold: true });

      currentY += 45;

      // Payment Status Section
      if (invoice.amountPaid > 0) {
        doc.fontSize(11)
          .fillColor('#10b981')
          .text('Amount Paid:', descX, currentY)
          .text(`Ksh ${invoice.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX, currentY, { width: 80, align: 'right' });
        currentY += 20;
      }

      // Notes Section (if any)
      if (invoice.notes) {
        doc.fontSize(10)
          .fillColor('#374151')
          .text('Notes:', 50, currentY)
          .moveDown(0.3)
          .text(invoice.notes, { width: 500, indent: 10 });
        currentY = doc.y + 20;
      }

      // Footer with company information
      const footerY = doc.page.height - 100;
      
      // Separator line above footer
      doc.rect(50, footerY - 10, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      doc.fontSize(9)
        .fillColor('#6b7280')
        .text(
          'Thank you for your business!',
          50,
          footerY,
          { align: 'center', width: 500 }
        )
        .moveDown(0.5)
        .fontSize(8)
        .text(
          'Interpark Enterprises Limited | Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke | Website: www.interparkenterprises.co.ke',
          { align: 'center', width: 500 }
        )
        .moveDown(0.3)
        .text(
          `Generated on ${new Date().toLocaleDateString('en-US')}`,
          { align: 'center', width: 500 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}


// @desc    Generate invoice for partial payment balance
// @route   POST /api/invoices/generate-from-partial
// @access  Private
export const generateInvoiceFromPartialPayment = async (req, res) => {
  try {
    const { paymentReportId, dueDate, notes } = req.body;

    if (!paymentReportId) {
      return res.status(400).json({ 
        success: false, 
        message: 'paymentReportId is required' 
      });
    }

    // Fetch payment report with tenant details
    const paymentReport = await prisma.paymentReport.findUnique({
      where: { id: paymentReportId },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            },
            serviceCharge: true
          }
        },
        invoices: true
      }
    });

    if (!paymentReport) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment report not found' 
      });
    }

    // Check if payment status is PARTIAL
    if (paymentReport.status !== 'PARTIAL') {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only generate invoices for partial payments. Current status: ' + paymentReport.status 
      });
    }

    // Check if balance exists
    if (paymentReport.arrears <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No outstanding balance to invoice' 
      });
    }

    const tenant = paymentReport.tenant;

    // Use values from the payment report
    const rent = paymentReport.rent;
    const serviceCharge = paymentReport.serviceCharge || 0;
    const vat = paymentReport.vat || 0;
    const totalDue = paymentReport.totalDue;
    const amountPaid = paymentReport.amountPaid;
    const balance = paymentReport.arrears;

    // Generate unique invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Determine payment period
    const paymentPeriod = new Date(paymentReport.paymentPeriod).toLocaleDateString('en-US', { 
      month: 'long', 
      year: 'numeric' 
    });

    // Create invoice record for the balance
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        tenantId: tenant.id,
        paymentReportId: paymentReportId,
        issueDate: new Date(),
        dueDate: new Date(dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // Default 30 days from now
        paymentPeriod,
        rent,
        serviceCharge,
        vat,
        totalDue: balance, // Invoice only the outstanding balance
        amountPaid: 0, // New invoice, no payment yet
        balance: balance,
        status: 'UNPAID',
        notes: notes || `Balance invoice for partial payment of ${paymentPeriod}`
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
        paymentReport: true
      }
    });

    // Generate PDF
    const pdfBuffer = await generatePartialPaymentInvoicePDF(invoice, tenant, paymentReport);
    
    // Upload PDF to storage
    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    // Update invoice with PDF URL
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Balance invoice generated successfully for partial payment'
    });
  } catch (error) {
    console.error('Error generating balance invoice:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all partial payment reports (status = PARTIAL with balance > 0)
// @route   GET /api/invoices/partial-payments
// @access  Private
export const getPartialPayments = async (req, res) => {
  try {
    const { propertyId, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = { 
      status: 'PARTIAL',
      arrears: {
        gt: 0
      }
    };

    // Filter by property if provided
    if (propertyId) {
      where.tenant = {
        unit: {
          propertyId
        }
      };
    }

    const total = await prisma.paymentReport.count({ where });

    const partialPayments = await prisma.paymentReport.findMany({
      where,
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            vatRate: true,
            vatType: true,
            unit: {
              include: {
                property: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            totalDue: true,
            amountPaid: true,
            balance: true,
            status: true,
            issueDate: true
          }
        }
      },
      orderBy: { paymentPeriod: 'desc' },
      skip,
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: partialPayments,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching partial payments:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper function to generate PDF for partial payment balance invoice
async function generatePartialPaymentInvoicePDF(invoice, tenant, paymentReport) {
  return new Promise((resolve, reject) => {
    try {
      // Create __dirname equivalent for ES modules
     // const __filename = fileURLToPath(import.meta.url);
     // const __dirname = path.dirname(__filename);
      
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ===== IMPROVED LETTERHEAD IMAGE HANDLING =====
      
      // Get project root directory
      const projectRoot = process.cwd();
      
      // Define multiple possible paths for the letterhead based on your exact server structure
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
      const startY = 120; // Default starting position below letterhead

      // Debug logging (remove in production if desired)
      console.log('=== PDF Generation Debug Info ===');
      console.log('Project Root (cwd):', projectRoot);
      console.log('Current File Directory (__dirname):', __dirname);
      console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

      // Try each possible path
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            letterheadPath = possiblePath;
            console.log(`✓ Found letterhead at: ${possiblePath}`);
            break;
          } else {
            console.log(`✗ Not found: ${possiblePath}`);
          }
        } catch (err) {
          console.log(`✗ Error checking: ${possiblePath} - ${err.message}`);
          continue;
        }
      }

      // Add letterhead if found
      if (letterheadPath) {
        try {
          // Add letterhead image at the top
          doc.image(letterheadPath, 50, 30, { 
            width: 500, 
            height: 80
          });
          
          // Adjust the Y position to start below the letterhead
          doc.y = startY;
          imageLoaded = true;
          console.log('✓ Letterhead image loaded successfully');
        } catch (imageError) {
          console.warn('✗ Could not load letterhead image:', imageError.message);
          console.warn('Image path that failed:', letterheadPath);
          imageLoaded = false;
        }
      } else {
        console.warn('✗ Letterhead image not found in any of the searched paths');
      }

      // Fallback if no image loaded
      if (!imageLoaded) {
        console.warn('Using fallback text header');
        
        // Fallback: start at adjusted position
        doc.y = 100;
        
        // Add a placeholder header instead
        doc.fontSize(20)
          .fillColor('#1e293b')
          .text('INTERPARK ENTERPRISES LIMITED', 50, 50, { align: 'center' })
          .moveDown(0.5);
      }

      console.log('=== End Debug Info ===\n');

      // Move cursor below letterhead
      doc.moveDown(2);

      // Invoice Title with BALANCE badge
      doc.fontSize(28)
        .fillColor('#dc2626')
        .text('BALANCE INVOICE', { align: 'center' })
        .moveDown(0.5);

      // Alert box for partial payment
      const alertY = doc.y;
      doc.rect(50, alertY, 500, 50)
        .fillAndStroke('#fef3c7', '#f59e0b');
      
      doc.fontSize(10)
        .fillColor('#92400e')
        .text('⚠️  BALANCE INVOICE - OUTSTANDING PAYMENT', 60, alertY + 8, { bold: true })
        .text('This invoice represents the outstanding balance from a partial payment.', 60, alertY + 23)
        .text(`Original Payment Period: ${invoice.paymentPeriod}`, 60, alertY + 38);

      doc.moveDown(3);

      // Invoice Details Box
      const detailsY = doc.y;
      
      // Left column - Invoice details
      doc.fontSize(10)
        .fillColor('#1e293b')
        .text(`Invoice Number: ${invoice.invoiceNumber}`, 50, detailsY)
        .text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString('en-US')}`, 50, detailsY + 15)
        .text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-US')}`, 50, detailsY + 30)
        .text(`Original Payment Period: ${invoice.paymentPeriod}`, 50, detailsY + 45);

      // VAT Information
      if (tenant.vatRate > 0 && tenant.vatType !== 'NOT_APPLICABLE') {
        doc.text(`VAT Rate: ${tenant.vatRate}% (${tenant.vatType})`, 300, detailsY + 15);
      }

      // Status Badge
      const statusWidth = 100;
      const statusX = 500 - statusWidth;
      doc.rect(statusX, detailsY, statusWidth, 25)
        .fillAndStroke('#dc2626', '#dc2626');
      
      doc.fillColor('#fff')
        .fontSize(12)
        .text('UNPAID', statusX, detailsY + 7, { width: statusWidth, align: 'center' });

      doc.moveDown(3);

      // Tenant Information
      const tenantY = doc.y;
      
      // Left side - BILL TO
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('BILL TO:', 50, tenantY, { underline: true })
        .moveDown(0.5);

      doc.fontSize(10)
        .fillColor('#374151')
        .text(invoice.tenant.fullName, 50, tenantY + 25)
        .text(`Contact: ${invoice.tenant.contact}`, 50, tenantY + 40)
        .text(`Unit: ${invoice.tenant.unit?.type || 'N/A'}`, 50, tenantY + 55)
        .text(`Property: ${invoice.tenant.unit?.property?.name || 'N/A'}`, 50, tenantY + 70);

      // Right side - Property/Landlord Information
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('FROM:', 300, tenantY, { underline: true })
        .moveDown(0.5);

      doc.fontSize(10)
        .fillColor('#374151')
        .text('Interpark Enterprises Limited', 300, tenantY + 25)
        .text('Tel: 0110 060 088', 300, tenantY + 40)
        .text('Email: info@interparkenterprises.co.ke', 300, tenantY + 55)
        .text('Website: www.interparkenterprises.co.ke', 300, tenantY + 70);

      doc.moveDown(4);

      // Payment Summary Section - Clear and prominent
      const summaryY = doc.y;
      doc.fontSize(12)
        .fillColor('#1e293b')
        .text('PAYMENT SUMMARY', { underline: true })
        .moveDown(0.5);

      // Summary box
      doc.rect(50, summaryY + 25, 500, 100)
        .fillAndStroke('#f8fafc', '#e2e8f0');

      const summaryContentY = summaryY + 45;
      
      // Original Total
      doc.fontSize(11)
        .fillColor('#374151')
        .text('Original Total Due:', 70, summaryContentY)
        .text(`Ksh ${paymentReport.totalDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 450, summaryContentY, { width: 80, align: 'right' });

      // Amount Paid
      doc.fillColor('#10b981')
        .text('Amount Previously Paid:', 70, summaryContentY + 25)
        .text(`Ksh ${paymentReport.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 450, summaryContentY + 25, { width: 80, align: 'right' });

      // Outstanding Balance - Highlighted
      doc.fillColor('#dc2626')
        .fontSize(12)
        .text('OUTSTANDING BALANCE:', 70, summaryContentY + 50, { bold: true })
        .text(`Ksh ${paymentReport.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 450, summaryContentY + 50, { width: 80, align: 'right', bold: true });

      doc.moveDown(5);

      // Line Items Table
      const tableTop = doc.y;
      const itemX = 50;
      const descX = 200;
      const amountX = 450;
      const rowHeight = 25;

      // Table Header
      doc.rect(itemX, tableTop, 500, rowHeight)
        .fillAndStroke('#2563eb', '#2563eb');

      doc.fillColor('#fff')
        .fontSize(11)
        .text('Item', itemX + 10, tableTop + 8)
        .text('Description', descX, tableTop + 8)
        .text('Amount (Ksh)', amountX, tableTop + 8, { width: 80, align: 'right' });

      let currentY = tableTop + rowHeight;

      // Outstanding Balance Item
      doc.fillColor('#1e293b')
        .fontSize(10)
        .text('Balance Due', itemX + 10, currentY + 8)
        .text(`Outstanding amount for ${invoice.paymentPeriod}`, descX, currentY + 8)
        .text(invoice.balance.toLocaleString('en-US', { minimumFractionDigits: 2 }), amountX, currentY + 8, { width: 80, align: 'right' });

      currentY += rowHeight + 15;

      // Total Balance Due - Very prominent
      doc.rect(itemX, currentY, 500, 40)
        .fillAndStroke('#fee2e2', '#dc2626');

      doc.fontSize(16)
        .fillColor('#dc2626')
        .text('TOTAL BALANCE DUE', descX, currentY + 12, { bold: true })
        .text(`Ksh ${invoice.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, amountX - 10, currentY + 12, { width: 90, align: 'right', bold: true });

      currentY += 60;

      // Notes Section
      if (invoice.notes) {
        doc.fontSize(10)
          .fillColor('#374151')
          .text('Notes:', 50, currentY)
          .moveDown(0.3)
          .text(invoice.notes, { width: 500, indent: 10 });
        currentY = doc.y + 20;
      }

      // Important Notice - Very prominent
      doc.rect(50, currentY, 500, 40)
        .fillAndStroke('#fef3c7', '#d97706');
      
      doc.fontSize(11)
        .fillColor('#92400e')
        .text('⚠️  IMPORTANT NOTICE', 60, currentY + 8, { bold: true })
        .text('Please settle this outstanding balance by the due date to avoid additional charges.', 60, currentY + 25, { width: 480 });

      // Footer with company information (consistent with first function)
      const footerY = doc.page.height - 100;
      
      // Separator line above footer
      doc.rect(50, footerY - 10, 500, 1).fillAndStroke('#e5e7eb', '#e5e7eb');
      
      doc.fontSize(9)
        .fillColor('#6b7280')
        .text(
          'Thank you for your business!',
          50,
          footerY,
          { align: 'center', width: 500 }
        )
        .moveDown(0.5)
        .fontSize(8)
        .text(
          'Interpark Enterprises Limited | Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke | Website: www.interparkenterprises.co.ke',
          { align: 'center', width: 500 }
        )
        .moveDown(0.3)
        .text(
          `Balance Invoice generated on ${new Date().toLocaleDateString('en-US')}`,
          { align: 'center', width: 500 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}