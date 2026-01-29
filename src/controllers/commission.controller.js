import prisma from "../lib/prisma.js";
import { generatePDF } from "../utils/pdfGenerator.js";
import { uploadToStorage } from "../utils/storage.js";
import { generateCommissionInvoiceNumber } from "../utils/commissionInvoiceHelpers.js";
import { commissionInvoiceHTML } from "../utils/commissionInvoiceTemplate.js";
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

/**
 * Get all commissions for a specific manager
 */
export const getManagerCommissions = async (req, res) => {
  try {
    const { managerId } = req.params;
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Validate managerId
    if (!managerId) {
      return res.status(400).json({
        success: false,
        message: 'Manager ID is required'
      });
    }

    // Check if manager is accessing their own data or if admin
    if (req.user.role !== 'ADMIN' && req.user.id !== managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own commissions.'
      });
    }

    // Build filter conditions
    const where = {
      managerId: managerId
    };

    // Add status filter if provided
    if (status && status !== 'ALL') {
      where.status = status;
    }

    // Add date range filter if provided
    if (startDate && endDate) {
      where.periodStart = {
        gte: new Date(startDate)
      };
      where.periodEnd = {
        lte: new Date(endDate)
      };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Get commissions with pagination and include property details
    const commissions = await prisma.managerCommission.findMany({
      where,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        
      },
      orderBy: {
        periodStart: 'desc'
      },
      skip,
      take
    });

    // Get total count for pagination
    const totalCommissions = await prisma.managerCommission.count({ where });
    const totalPages = Math.ceil(totalCommissions / limit);

    res.json({
      success: true,
      data: commissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCommissions,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching manager commissions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get commission statistics for a manager
 */
export const getCommissionStats = async (req, res) => {
  try {
    const { managerId } = req.params;

    if (!managerId) {
      return res.status(400).json({
        success: false,
        message: 'Manager ID is required'
      });
    }

    // Check if manager is accessing their own data or if admin
    if (req.user.role !== 'ADMIN' && req.user.id !== managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own commission statistics.'
      });
    }

    // Get all commissions for the manager
    const commissions = await prisma.managerCommission.findMany({
      where: { managerId },
      include: {
        property: {
          select: {
            name: true
          }
        }
      }
    });

    // Calculate statistics
    const totalCommissions = commissions.length;
    const totalEarned = commissions
      .filter(c => c.status === 'PAID')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);
    
    const pendingCommissions = commissions
      .filter(c => c.status === 'PENDING')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);
    
    const processingCommissions = commissions
      .filter(c => c.status === 'PROCESSING')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);

    // Group by status
    const statusCounts = commissions.reduce((acc, commission) => {
      acc[commission.status] = (acc[commission.status] || 0) + 1;
      return acc;
    }, {});

    // Group by property
    const propertyStats = commissions.reduce((acc, commission) => {
      const propertyName = commission.property.name;
      if (!acc[propertyName]) {
        acc[propertyName] = {
          totalCommissions: 0,
          totalAmount: 0,
          pendingAmount: 0,
          processingAmount: 0,
          paidAmount: 0
        };
      }
      
      acc[propertyName].totalCommissions++;
      acc[propertyName].totalAmount += commission.commissionAmount;
      
      if (commission.status === 'PENDING') {
        acc[propertyName].pendingAmount += commission.commissionAmount;
      } else if (commission.status === 'PROCESSING') {
        acc[propertyName].processingAmount += commission.commissionAmount;
      } else if (commission.status === 'PAID') {
        acc[propertyName].paidAmount += commission.commissionAmount;
      }
      
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        summary: {
          totalCommissions,
          totalEarned: parseFloat(totalEarned.toFixed(2)),
          pendingAmount: parseFloat(pendingCommissions.toFixed(2)),
          processingAmount: parseFloat(processingCommissions.toFixed(2))
        },
        statusBreakdown: statusCounts,
        propertyBreakdown: propertyStats
      }
    });

  } catch (error) {
    console.error('Error fetching commission stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get a single commission by ID
 */
export const getCommissionById = async (req, res) => {
  try {
    const { id } = req.params;

    const commission = await prisma.managerCommission.findUnique({
      where: { id },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            landlord: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // Check if user has access to this commission
    if (req.user.role !== 'ADMIN' && req.user.id !== commission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own commissions.'
      });
    }

    res.json({
      success: true,
      data: commission
    });

  } catch (error) {
    console.error('Error fetching commission:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Update commission status (for admin use only)
 */
export const updateCommissionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, paidDate } = req.body;

    // Validate status
    const validStatuses = ['PENDING', 'PAID', 'PROCESSING', 'CANCELLED'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // Check if commission exists
    const existingCommission = await prisma.managerCommission.findUnique({
      where: { id }
    });

    if (!existingCommission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // Check if user is admin or the manager who owns the commission
    if (req.user.role !== 'ADMIN' && req.user.id !== existingCommission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own commissions.'
      });
    }

    // Managers can only update to PROCESSING or PAID, and only for their own commissions
    if (req.user.role !== 'ADMIN') {
      if (status && !['PROCESSING', 'PAID'].includes(status)) {
        return res.status(403).json({
          success: false,
          message: 'Managers can only mark commissions as PROCESSING or PAID'
        });
      }
      
      // Managers cannot update notes or paidDate
      if (notes !== undefined || paidDate !== undefined) {
        return res.status(403).json({
          success: false,
          message: 'Managers cannot update notes or paid date'
        });
      }
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    
    // Set paidDate if status is changed to PAID
    if (status === 'PAID') {
      updateData.paidDate = paidDate ? new Date(paidDate) : new Date();
    }

    const updatedCommission = await prisma.managerCommission.update({
      where: { id },
      data: updateData,
      include: {
        property: {
          select: {
            name: true
          }
        },
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Commission updated successfully',
      data: updatedCommission
    });

  } catch (error) {
    console.error('Error updating commission:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get commissions by property for a manager
 */
export const getCommissionsByProperty = async (req, res) => {
  try {
    const { managerId, propertyId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!managerId || !propertyId) {
      return res.status(400).json({
        success: false,
        message: 'Manager ID and Property ID are required'
      });
    }

    // Check if manager is accessing their own data or if admin
    if (req.user.role !== 'ADMIN' && req.user.id !== managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own commissions.'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const commissions = await prisma.managerCommission.findMany({
      where: {
        managerId,
        propertyId
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      },
      orderBy: {
        periodStart: 'desc'
      },
      skip,
      take
    });

    const totalCommissions = await prisma.managerCommission.count({
      where: {
        managerId,
        propertyId
      }
    });

    const totalPages = Math.ceil(totalCommissions / limit);

    res.json({
      success: true,
      data: commissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCommissions,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching property commissions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Mark commission as processing (manager action)
 */
export const markAsProcessing = async (req, res) => {
  try {
    const { id } = req.params;

    const existingCommission = await prisma.managerCommission.findUnique({
      where: { id }
    });

    if (!existingCommission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // Check if manager owns this commission
    if (req.user.role !== 'ADMIN' && req.user.id !== existingCommission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own commissions.'
      });
    }

    // Check if commission can be marked as processing
    if (existingCommission.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Only PENDING commissions can be marked as PROCESSING'
      });
    }

    const updatedCommission = await prisma.managerCommission.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        notes: existingCommission.notes ? `${existingCommission.notes}\nMarked as processing by manager on ${new Date().toLocaleDateString()}` : `Marked as processing by manager on ${new Date().toLocaleDateString()}`
      },
      include: {
        property: {
          select: {
            name: true
          }
        },
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Commission marked as processing',
      data: updatedCommission
    });

  } catch (error) {
    console.error('Error marking commission as processing:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Mark commission as paid (manager action)
 */
export const markAsPaid = async (req, res) => {
  try {
    const { id } = req.params;

    const existingCommission = await prisma.managerCommission.findUnique({
      where: { id }
    });

    if (!existingCommission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // Check if manager owns this commission
    if (req.user.role !== 'ADMIN' && req.user.id !== existingCommission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own commissions.'
      });
    }

    // Check if commission can be marked as paid
    if (!['PENDING', 'PROCESSING'].includes(existingCommission.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only PENDING or PROCESSING commissions can be marked as PAID'
      });
    }

    const updatedCommission = await prisma.managerCommission.update({
      where: { id },
      data: {
        status: 'PAID',
        paidDate: new Date(),
        notes: existingCommission.notes ? `${existingCommission.notes}\nMarked as paid by manager on ${new Date().toLocaleDateString()}` : `Marked as paid by manager on ${new Date().toLocaleDateString()}`
      },
      include: {
        property: {
          select: {
            name: true
          }
        },
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Commission marked as paid',
      data: updatedCommission
    });

  } catch (error) {
    console.error('Error marking commission as paid:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Generate commission invoice PDF and mark commission PROCESSING
 * Manager/Admin
 *
 * Auto-populates:
 * - lrNumber from Property.lrNumber
 * - landlordAddress from Landlord.address
 * - refText auto-generated from period + property
 */
export const generateCommissionInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      description,
      vatRate = 0,
      bankName,
      accountName,
      accountNumber,
      branch,
      bankCode,
      swiftCode,
      currency = "KES"
    } = req.body;

    if (!description) {
      return res.status(400).json({ 
        success: false, 
        message: "Description is required" 
      });
    }

    if (!bankName || !accountName || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: "Bank name, account name, and account number are required"
      });
    }

    // Fetch commission with related data
    const commission = await prisma.managerCommission.findUnique({
      where: { id },
      include: {
        property: {
          include: {
            landlord: { 
              select: { 
                id: true, 
                name: true, 
                address: true 
              } 
            }
          }
        },
        manager: { 
          select: { 
            id: true, 
            name: true, 
            email: true 
          } 
        }
      }
    });

    if (!commission) {
      return res.status(404).json({ 
        success: false, 
        message: "Commission not found" 
      });
    }

    // Check permissions
    if (req.user.role !== "ADMIN" && req.user.id !== commission.managerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only generate invoices for your own commissions."
      });
    }

    // Check if invoice already exists to prevent duplicate transactions
    const existingInvoice = await prisma.commissionInvoice.findFirst({
      where: { commissionId: id }
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: "Invoice already generated for this commission"
      });
    }

    // ----- AUTO-POPULATED FIELDS -----
    const lrNumber = commission.property?.lrNumber || "";
    const landlordAddress = commission.property?.landlord?.address || "";

    const periodStart = new Date(commission.periodStart);
    const monthShort = periodStart.toLocaleString("en-GB", { month: "short" }).toUpperCase();
    const year = periodStart.getFullYear();
    const refText = `COM-${monthShort}-${year}-${commission.property?.name || "PROPERTY"}`;

    // ----- COMMISSION CALCULATION -----
    const collectionAmount = Number(commission.incomeAmount || 0);
    
    // Convert commission fee to decimal
    const commissionFeeFromDB = Number(commission.commissionFee || 0);
    let commissionRateDecimal;
    
    if (commissionFeeFromDB > 1) {
      // Likely a percentage (e.g., 85)
      commissionRateDecimal = commissionFeeFromDB / 100;
    } else {
      // Likely already a decimal
      commissionRateDecimal = commissionFeeFromDB;
    }
    
    const commissionAmount = Number((collectionAmount * commissionRateDecimal).toFixed(2));

    const vatRateNum = Number(vatRate || 0);
    const vatAmount = Number((commissionAmount * vatRateNum).toFixed(2));
    const totalAmount = Number((commissionAmount + vatAmount).toFixed(2));

    // Generate invoice number
    const invoiceNumber = await generateCommissionInvoiceNumber();

    const invoiceDate = new Date();
    const invoiceDateText = invoiceDate.toLocaleDateString("en-GB");

    // Generate HTML for PDF
    const html = commissionInvoiceHTML({
      propertyName: commission.property?.name || "",
      lrNumber,
      invoiceDateText,
      invoiceNumber,
      refText,
      landlordName: commission.property?.landlord?.name || "",
      landlordAddress,
      description,
      collectionAmount,
      commissionRate: commissionRateDecimal,
      commissionAmount,
      vatAmount,
      totalAmount,
      bankName,
      accountName,
      accountNumber,
      branch,
      bankCode,
      swiftCode,
      currency
    });

    // Generate PDF buffer
    const pdfBuffer = await generatePDF(html);

    // Upload PDF to storage
    const safeInvoiceNumber = invoiceNumber.replaceAll("/", "-");
    const fileName = `commission_invoice_${safeInvoiceNumber}.pdf`;
    const pdfUrl = await uploadToStorage(pdfBuffer, fileName, "commission-invoice");

    // Transaction with timeout configuration
    const result = await prisma.$transaction(async (tx) => {
      // Create commission invoice
      const createdInvoice = await tx.commissionInvoice.create({
        data: {
          invoiceNumber,
          invoiceDate,
          commissionId: commission.id,
          propertyName: commission.property?.name || "",
          lrNumber: lrNumber || null,
          landlordName: commission.property?.landlord?.name || "",
          landlordAddress: landlordAddress || null,
          description,
          collectionAmount,
          commissionRate: commissionRateDecimal,
          commissionAmount,
          vatRate: vatRateNum,
          vatAmount,
          totalAmount,
          bankName,
          accountName,
          accountNumber,
          branch: branch || null,
          bankCode: bankCode || null,
          swiftCode: swiftCode || null,
          currency,
          pdfUrl
        }
      });

      // Update commission status
      const updatedCommission = await tx.managerCommission.update({
        where: { id: commission.id },
        data: { status: "PROCESSING" }
      });

      return { createdInvoice, updatedCommission };
    }, {
      maxWait: 10000, // 10 seconds max wait for transaction to start
      timeout: 30000, // 30 seconds max for transaction to complete
    });

    return res.status(201).json({
      success: true,
      message: "Commission invoice generated successfully",
      data: {
        invoice: result.createdInvoice,
        commission: result.updatedCommission
      }
    });

  } catch (error) {
    console.error("Error generating commission invoice:", error);
    
    // Handle specific transaction timeout error
    if (error.code === 'P2028') {
      return res.status(503).json({
        success: false,
        message: "Database transaction timeout. The system is busy. Please try again in a moment.",
        error: "Transaction timeout",
        code: error.code
      });
    }
    
    // Handle other Prisma errors
    if (error.code && error.code.startsWith('P')) {
      return res.status(500).json({
        success: false,
        message: "Database error occurred",
        error: error.message,
        code: error.code
      });
    }
    
    // Handle generic errors
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

/**
 * Download commission invoice PDF by invoice number
 * Manager/Admin
 */
export const downloadCommissionInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await prisma.commissionInvoice.findUnique({
      where: { commissionId: id },
      include: {
        commission: {
          include: {
            manager: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found for this commission'
      });
    }

    // DEBUG: Log the invoice data
   // console.log('Invoice found:', {
     // id: invoice.id,
     // invoiceNumber: invoice.invoiceNumber,
     // pdfUrl: invoice.pdfUrl
   // });

    // Check if user has access
    if (req.user.role !== 'ADMIN' && req.user.id !== invoice.commission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      });
    }

    const pdfUrl = invoice.pdfUrl;
    if (!pdfUrl) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found for this invoice'
      });
    }

    // DEBUG: Log the original pdfUrl
    console.log('Original pdfUrl:', pdfUrl);
    
    // Extract the filename from the URL - handle both forward and backslashes
    const fileName = pdfUrl.split(/[/\\]/).pop();
    
    // DEBUG: Log extracted filename
    console.log('Extracted fileName:', fileName);
    
    if (!fileName) {
      return res.status(404).json({
        success: false,
        message: 'Invalid file URL'
      });
    }

    // Determine the file path - use consistent path resolution
    const filePath = path.resolve(
      process.cwd(),
      'uploads',
      'commission-invoice',
      fileName
    );

    // Alternative: If pdfUrl is an absolute path, use it directly
    // const filePath = path.resolve(pdfUrl);

    // DEBUG: Log the constructed file path
    console.log('Constructed filePath:', filePath);

    // Check if file exists
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
      console.log('File exists and is readable at path:', filePath);
      
      // Get file stats for additional debugging
      const stats = await fsPromises.stat(filePath);
      console.log('File stats:', {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });
    } catch (error) {
      console.error('File not found or not accessible at path:', filePath);
      console.error('Error details:', error.message);
      
      // Try to list files in the directory to see what's there
      try {
        const dirPath = path.join(process.cwd(), 'uploads', 'commission-invoice');
        console.log('Attempting to list directory:', dirPath);
        
        const files = await fsPromises.readdir(dirPath);
        console.log('Files in directory:', files);
        
        // Check if file exists with different case (Windows is case-insensitive)
        const fileExists = files.some(file => 
          file.toLowerCase() === fileName.toLowerCase()
        );
        
        if (fileExists) {
          console.log('File exists with different case. Actual files:');
          files.forEach(file => {
            if (file.toLowerCase() === fileName.toLowerCase()) {
              console.log(`Found: "${file}" (looking for: "${fileName}")`);
            }
          });
        }
      } catch (dirError) {
        console.error('Could not read directory:', dirError.message);
      }
      
      return res.status(404).json({
        success: false,
        message: 'PDF file not found on server',
        details: 'File path may be incorrect or permissions issue'
      });
    }

    // Set headers for file download
    const safeFileName = `commission_invoice_${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Stream the file with error handling
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (streamError) => {
      console.error('File stream error:', streamError);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Error streaming file',
          error: streamError.message
        });
      }
    });
    
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading commission invoice:', error);
    
    if (error.name === 'PrismaClientValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid commission ID format'
      });
    }
    
    // Check if headers were already sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};