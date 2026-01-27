import prisma from "../lib/prisma.js";
import { generatePDF } from "../utils/pdfGenerator.js";
import { uploadToStorage } from "../utils/storage.js";
import { generateCommissionInvoiceNumber } from "../utils/commissionInvoiceHelpers.js";
import { commissionInvoiceHTML } from "../utils/commissionInvoiceTemplate.js";
import fs from 'fs/promises';
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
        }
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
      return res.status(400).json({ success: false, message: "Description is required" });
    }

    if (!bankName || !accountName || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: "Bank name, account name, and account number are required"
      });
    }

    const commission = await prisma.managerCommission.findUnique({
      where: { id },
      include: {
        property: {
          include: {
            landlord: { select: { id: true, name: true, address: true } }
          }
        },
        manager: { select: { id: true, name: true, email: true } }
      }
    });

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission not found" });
    }

    if (req.user.role !== "ADMIN" && req.user.id !== commission.managerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only generate invoices for your own commissions."
      });
    }

    // ----- AUTO-POPULATED FIELDS -----
    const lrNumber = commission.property?.lrNumber || "";
    const landlordAddress = commission.property?.landlord?.address || "";

    const periodStart = new Date(commission.periodStart);
    const monthShort = periodStart.toLocaleString("en-GB", { month: "short" }).toUpperCase();
    const year = periodStart.getFullYear();
    const refText = `COM-${monthShort}-${year}-${commission.property?.name || "PROPERTY"}`;

    // ----- FIXED COMMISSION RATE CALCULATION -----
    const collectionAmount = Number(commission.incomeAmount || 0);
    
    // If commissionFee is stored as percentage (e.g., 85), convert to decimal
    const commissionFeeFromDB = Number(commission.commissionFee || 0);
    
    // Check if it's likely a percentage (e.g., 85) vs decimal (e.g., 0.85)
    let commissionRateDecimal;
    if (commissionFeeFromDB > 1) {
      // If it's > 1, it's likely a percentage (e.g., 85)
      commissionRateDecimal = commissionFeeFromDB / 100; // Convert to decimal (0.85)
    } else {
      // If it's <= 1, it's likely already a decimal
      commissionRateDecimal = commissionFeeFromDB;
    }
    
    const commissionAmount = Number((collectionAmount * commissionRateDecimal).toFixed(2));

    const vatRateNum = Number(vatRate || 0);
    const vatAmount = Number((commissionAmount * vatRateNum).toFixed(2));
    const totalAmount = Number((commissionAmount + vatAmount).toFixed(2));

    const invoiceNumber = await generateCommissionInvoiceNumber();

    const invoiceDate = new Date();
    const invoiceDateText = invoiceDate.toLocaleDateString("en-GB");

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
      commissionRate: commissionRateDecimal, // Pass decimal rate to HTML function
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

    const safeInvoiceNumber = invoiceNumber.replaceAll("/", "-");
    const fileName = `commission_invoice_${safeInvoiceNumber}.pdf`;
    const pdfUrl = await uploadToStorage(pdfBuffer, fileName, "commission-invoice");

    const result = await prisma.$transaction(async (tx) => {
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
          commissionRate: commissionRateDecimal, // Store as decimal
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

      const updatedCommission = await tx.managerCommission.update({
        where: { id: commission.id },
        data: { status: "PROCESSING" }
      });

      return { createdInvoice, updatedCommission };
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
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

/**
 * Download commission invoice PDF
 * Manager/Admin
 */
export const downloadCommissionInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Find the invoice record
    const invoice = await prisma.commissionInvoice.findUnique({
      where: { id: invoiceId },
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
        message: 'Invoice not found'
      });
    }

    // Check if user has access to this invoice
    // Admin can access any invoice, manager can only access their own
    if (req.user.role !== 'ADMIN' && req.user.id !== invoice.commission.managerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only download invoices for your own commissions.'
      });
    }

    // Extract filename from the pdfUrl
    const pdfUrl = invoice.pdfUrl;
    if (!pdfUrl) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found for this invoice'
      });
    }

    // Extract the filename from the URL
    // URL format: /uploads/commission-invoice/commission_invoice_COM-INV-YYYYMM-000001.pdf
    const fileName = pdfUrl.split('/').pop();
    
    if (!fileName) {
      return res.status(404).json({
        success: false,
        message: 'Invalid file URL'
      });
    }

    // Determine the file path
    const filePath = path.join(
      process.cwd(),
      'uploads',
      'commission-invoice',
      fileName
    );

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found on server'
      });
    }

    // Set headers for file download
    const safeFileName = `commission_invoice_${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading commission invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};