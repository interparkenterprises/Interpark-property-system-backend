import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
          pendingAmount: 0
        };
      }
      
      acc[propertyName].totalCommissions++;
      acc[propertyName].totalAmount += commission.commissionAmount;
      
      if (commission.status === 'PENDING') {
        acc[propertyName].pendingAmount += commission.commissionAmount;
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