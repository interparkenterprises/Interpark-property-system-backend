import prisma from "../lib/prisma.js";
import { generatePDF } from "../utils/pdfGenerator.js";
import { uploadToStorage } from "../utils/storage.js";
import { generateCommissionInvoiceNumber } from "../utils/commissionInvoiceHelpers.js";
import { commissionInvoiceHTML } from "../utils/commissionInvoiceTemplate.js";
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import permissionService from "../services/permissionService.js";

/**
 * Calculate VAT-exclusive amount from a payment for commission purposes
 * @param {number} amount - Total amount paid
 * @param {string} vatType - Tenant's VAT type (INCLUSIVE, EXCLUSIVE, NOT_APPLICABLE)
 * @param {number} vatRate - VAT rate percentage (e.g., 16 for 16%)
 * @returns {number} VAT-exclusive amount for commission calculation
 */
function calculateVatExclusiveAmount(amount, vatType, vatRate) {
  if (!amount || amount <= 0) return 0;
  
  const normalizedVatType = vatType || 'NOT_APPLICABLE';
  const rate = parseFloat(vatRate) || 0;
  
  if ((normalizedVatType === 'INCLUSIVE' || normalizedVatType === 'EXCLUSIVE') && rate > 0) {
    // Both INCLUSIVE and EXCLUSIVE need VAT extraction for commission base
    // Formula: VAT Exclusive = Total / (1 + VAT Rate/100)
    return amount / (1 + (rate / 100));
  }
  
  // NOT_APPLICABLE - no VAT, full amount is commission base
  return amount;
}

/**
 * Get all commissions for a specific manager
 * Required Permission: VIEW_COMMISSIONS
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

    // Permission check: Users can only view their own commissions unless they have VIEW_COMMISSIONS permission
    const hasViewPermission = await permissionService.hasPermission(
      req.user.id, 
      'VIEW_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommissions = req.user.id === managerId;
    
    if (!isAdmin && !isOwnCommissions && !hasViewPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view commissions.'
      });
    }
    
    // If not admin and not viewing own commissions, check if they have permission to view other managers' commissions
    if (!isAdmin && !isOwnCommissions) {
      // Additional check: does the user have permission to view all commissions?
      const canViewAll = await permissionService.hasPermission(
        req.user.id,
        'VIEW_COMMISSIONS',
        null
      );
      if (!canViewAll) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own commissions.'
        });
      }
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
 * Required Permission: VIEW_COMMISSIONS
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

    // Permission check
    const hasViewPermission = await permissionService.hasPermission(
      req.user.id, 
      'VIEW_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommissions = req.user.id === managerId;
    
    if (!isAdmin && !isOwnCommissions && !hasViewPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view commission statistics.'
      });
    }
    
    if (!isAdmin && !isOwnCommissions) {
      const canViewAll = await permissionService.hasPermission(
        req.user.id,
        'VIEW_COMMISSIONS',
        null
      );
      if (!canViewAll) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own commission statistics.'
        });
      }
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
 * Required Permission: VIEW_COMMISSIONS
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

    // Permission check
    const hasViewPermission = await permissionService.hasPermission(
      req.user.id, 
      'VIEW_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommission = req.user.id === commission.managerId;
    
    if (!isAdmin && !isOwnCommission && !hasViewPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this commission.'
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
 * Required Permissions: APPROVE_COMMISSIONS (for APPROVE action) or PROCESS_COMMISSIONS (for PROCESS action)
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

    // Permission check based on the status change
    const isAdmin = req.user.role === 'ADMIN';
    
    if (!isAdmin) {
      // Check for specific permissions based on target status
      let hasPermission = false;
      
      if (status === 'PROCESSING') {
        hasPermission = await permissionService.hasPermission(
          req.user.id,
          'PROCESS_COMMISSIONS'
        );
      } else if (status === 'PAID') {
        hasPermission = await permissionService.hasPermission(
          req.user.id,
          'APPROVE_COMMISSIONS'
        );
      } else if (status === 'CANCELLED') {
        hasPermission = await permissionService.hasPermission(
          req.user.id,
          'APPROVE_COMMISSIONS'
        );
      }
      
      // Also check if user owns this commission and has appropriate permission
      const isOwnCommission = req.user.id === existingCommission.managerId;
      
      if (!hasPermission && !isOwnCommission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to update commission status.'
        });
      }
      
      // Managers can only update to PROCESSING or PAID, and only for their own commissions
      if (!isAdmin && !isOwnCommission) {
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
 * Required Permission: VIEW_COMMISSIONS
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

    // Permission check
    const hasViewPermission = await permissionService.hasPermission(
      req.user.id, 
      'VIEW_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommissions = req.user.id === managerId;
    
    if (!isAdmin && !isOwnCommissions && !hasViewPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view commissions.'
      });
    }
    
    if (!isAdmin && !isOwnCommissions) {
      const canViewAll = await permissionService.hasPermission(
        req.user.id,
        'VIEW_COMMISSIONS',
        null
      );
      if (!canViewAll) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own commissions.'
        });
      }
    }

    // Additional property-based permission check
    const hasPropertyAccess = await permissionService.checkPropertyAccess(
      req.user.id,
      propertyId,
      'canView'
    );
    
    if (!isAdmin && !hasPropertyAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have access to this property.'
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
 * Required Permission: PROCESS_COMMISSIONS
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

    // Permission check
    const hasProcessPermission = await permissionService.hasPermission(
      req.user.id,
      'PROCESS_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommission = req.user.id === existingCommission.managerId;
    
    if (!isAdmin && !isOwnCommission && !hasProcessPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to process commissions.'
      });
    }

    // If it's not admin and not their own commission, check if they have the permission
    if (!isAdmin && !isOwnCommission) {
      const canProcess = await permissionService.hasPermission(
        req.user.id,
        'PROCESS_COMMISSIONS'
      );
      if (!canProcess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only process your own commissions.'
        });
      }
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
        notes: existingCommission.notes ? `${existingCommission.notes}\nMarked as processing by ${req.user.name || req.user.email} on ${new Date().toLocaleDateString()}` : `Marked as processing by ${req.user.name || req.user.email} on ${new Date().toLocaleDateString()}`
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
 * Required Permission: APPROVE_COMMISSIONS
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

    // Permission check
    const hasApprovePermission = await permissionService.hasPermission(
      req.user.id,
      'APPROVE_COMMISSIONS'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommission = req.user.id === existingCommission.managerId;
    
    if (!isAdmin && !isOwnCommission && !hasApprovePermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to approve commissions.'
      });
    }

    // If it's not admin and not their own commission, check if they have the permission
    if (!isAdmin && !isOwnCommission) {
      const canApprove = await permissionService.hasPermission(
        req.user.id,
        'APPROVE_COMMISSIONS'
      );
      if (!canApprove) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only approve your own commissions.'
        });
      }
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
        notes: existingCommission.notes ? `${existingCommission.notes}\nMarked as paid by ${req.user.name || req.user.email} on ${new Date().toLocaleDateString()}` : `Marked as paid by ${req.user.name || req.user.email} on ${new Date().toLocaleDateString()}`
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
 * Required Permission: GENERATE_COMMISSION_INVOICES
 */
export const generateCommissionInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      description,
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

    // Permission check for generating invoices
    const hasGeneratePermission = await permissionService.hasPermission(
      req.user.id,
      'GENERATE_COMMISSION_INVOICES'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommission = req.user.id === commission.managerId;
    
    if (!isAdmin && !isOwnCommission && !hasGeneratePermission) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to generate commission invoices."
      });
    }

    // If it's not admin and not their own commission, check if they have the permission
    if (!isAdmin && !isOwnCommission) {
      const canGenerate = await permissionService.hasPermission(
        req.user.id,
        'GENERATE_COMMISSION_INVOICES'
      );
      if (!canGenerate) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only generate invoices for your own commissions."
        });
      }
    }

    // Additional property access check
    const hasPropertyAccess = await permissionService.checkPropertyAccess(
      req.user.id,
      commission.propertyId,
      'canView'
    );
    
    if (!isAdmin && !hasPropertyAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have access to this property."
      });
    }

    // ----- CHECK FOR EXISTING INVOICE -----
    let existingInvoice = await prisma.commissionInvoice.findFirst({
      where: { commissionId: id }
    });

    // If invoice exists, delete the old one and its associated PDF file
    if (existingInvoice) {
      console.log(`Deleting existing invoice for commission ${id}: ${existingInvoice.invoiceNumber}`);
      
      // Delete the PDF file from storage if it exists
      if (existingInvoice.pdfUrl) {
        try {
          const fileName = existingInvoice.pdfUrl.split('/').pop();
          if (fileName) {
            const filePath = path.join(
              process.cwd(),
              'uploads',
              'commission-invoice',
              fileName
            );
            
            if (fs.existsSync(filePath)) {
              await fsPromises.unlink(filePath);
              console.log(`Deleted PDF file: ${filePath}`);
            }
          }
        } catch (fileError) {
          console.error('Error deleting PDF file:', fileError);
        }
      }
      
      await prisma.commissionInvoice.delete({
        where: { id: existingInvoice.id }
      });
      
      console.log(`Deleted existing invoice record: ${existingInvoice.invoiceNumber}`);
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
    const originalIncomeAmount = Number(commission.originalIncomeAmount || collectionAmount);
    
    // Extract VAT information from commission notes if available
    let vatTypeFromNotes = 'NOT_APPLICABLE';
    let vatRateFromNotes = 0;
    if (commission.notes) {
      const vatTypeMatch = commission.notes.match(/VAT Type: (\w+)/);
      const vatRateMatch = commission.notes.match(/VAT Rate: ([\d.]+)%/);
      if (vatTypeMatch) vatTypeFromNotes = vatTypeMatch[1];
      if (vatRateMatch) vatRateFromNotes = parseFloat(vatRateMatch[1]);
    }
    
    // Convert commission fee to decimal
    const commissionFeeFromDB = Number(commission.commissionFee || 0);
    let commissionRateDecimal;
    
    if (commissionFeeFromDB > 1) {
      commissionRateDecimal = commissionFeeFromDB / 100;
    } else {
      commissionRateDecimal = commissionFeeFromDB;
    }
    
    const commissionAmount = Number((collectionAmount * commissionRateDecimal).toFixed(2));

    // COMMISSION TO LANDLORD HAS NO VAT
    const vatRateNum = 0;
    const vatAmount = 0;
    const totalAmount = commissionAmount;

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
      originalIncomeAmount,
      vatType: vatTypeFromNotes,
      vatRate: vatRateFromNotes,
      commissionRate: commissionRateDecimal,
      commissionAmount,
      vatAmount: 0,
      totalAmount: commissionAmount,
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
          vatRate: 0,
          vatAmount: 0,
          totalAmount: commissionAmount,
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

      // Update commission status to PROCESSING
      const updatedCommission = await tx.managerCommission.update({
        where: { id: commission.id },
        data: { status: "PROCESSING" }
      });

      return { createdInvoice, updatedCommission };
    }, {
      maxWait: 15000,
      timeout: 30000,
    });

    // Invalidate permission cache for this user
    await permissionService.invalidateUserCache(req.user.id);

    return res.status(201).json({
      success: true,
      message: existingInvoice 
        ? "Commission invoice regenerated successfully (previous invoice deleted)" 
        : "Commission invoice generated successfully",
      data: {
        invoice: result.createdInvoice,
        commission: result.updatedCommission,
        vatDetails: {
          originalAmount: originalIncomeAmount,
          vatExclusiveBase: collectionAmount,
          vatType: vatTypeFromNotes,
          vatRate: vatRateFromNotes,
          note: "Commission invoice is VAT-exempt"
        },
        previousInvoiceDeleted: !!existingInvoice,
        previousInvoiceNumber: existingInvoice?.invoiceNumber
      }
    });

  } catch (error) {
    console.error("Error generating commission invoice:", error);
    
    if (error.code === 'P2028') {
      return res.status(503).json({
        success: false,
        message: "Database transaction timeout. The system is busy. Please try again in a moment.",
        error: "Transaction timeout",
        code: error.code
      });
    }
    
    if (error.code && error.code.startsWith('P')) {
      return res.status(500).json({
        success: false,
        message: "Database error occurred",
        error: error.message,
        code: error.code
      });
    }
    
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

/**
 * Download commission invoice PDF by invoice number
 * Required Permissions: VIEW_COMMISSIONS or GENERATE_COMMISSION_INVOICES
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

    // Permission check for downloading invoice
    const hasViewPermission = await permissionService.hasPermission(
      req.user.id,
      'VIEW_COMMISSIONS'
    );
    const hasGeneratePermission = await permissionService.hasPermission(
      req.user.id,
      'GENERATE_COMMISSION_INVOICES'
    );
    
    const isAdmin = req.user.role === 'ADMIN';
    const isOwnCommission = req.user.id === invoice.commission.managerId;
    
    if (!isAdmin && !isOwnCommission && !hasViewPermission && !hasGeneratePermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to download this invoice.'
      });
    }

    const pdfUrl = invoice.pdfUrl;
    if (!pdfUrl) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found for this invoice'
      });
    }

    // Extract the filename from the URL
    const fileName = pdfUrl.split(/[/\\]/).pop();
    
    if (!fileName) {
      return res.status(404).json({
        success: false,
        message: 'Invalid file URL'
      });
    }

    // Determine the file path
    const filePath = path.resolve(
      process.cwd(),
      'uploads',
      'commission-invoice',
      fileName
    );

    // Check if file exists
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
      console.log('File exists and is readable at path:', filePath);
      
      const stats = await fsPromises.stat(filePath);
      console.log('File stats:', {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });
    } catch (error) {
      console.error('File not found or not accessible at path:', filePath);
      console.error('Error details:', error.message);
      
      try {
        const dirPath = path.join(process.cwd(), 'uploads', 'commission-invoice');
        console.log('Attempting to list directory:', dirPath);
        
        const files = await fsPromises.readdir(dirPath);
        console.log('Files in directory:', files);
        
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
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};