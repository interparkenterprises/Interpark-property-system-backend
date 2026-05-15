import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";

// Helper function to check landlord permissions
const checkLandlordPermission = async (userId, userRole, landlordId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    // Managers can access landlords they have properties with
    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordId },
      include: {
        properties: {
          where: { managerId: userId },
          select: { id: true }
        }
      }
    });
    return landlord && landlord.properties.length > 0;
  }
  
  if (userRole === 'USER') {
    // Check if user has the specific permission
    const hasPermission = await permissionService.hasPermission(userId, `VIEW_LANDLORDS`);
    if (!hasPermission) return false;
    
    // Also check if they have access to any property of this landlord
    const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
    if (accessiblePropertyIds.length === 0) return false;
    
    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordId },
      include: {
        properties: {
          where: {
            id: { in: accessiblePropertyIds }
          },
          select: { id: true }
        }
      }
    });
    
    return landlord && landlord.properties.length > 0;
  }
  
  return false;
};

// Helper function to check if user has access to a landlord for write operations
const checkLandlordWriteAccess = async (userId, userRole, landlordId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    // Check if manager has any property with this landlord
    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordId },
      include: {
        properties: {
          where: { managerId: userId },
          select: { id: true }
        }
      }
    });
    return landlord && landlord.properties.length > 0;
  }
  
  if (userRole === 'USER') {
    // Check if user has the edit permission
    const hasPermission = await permissionService.hasPermission(userId, operation === 'edit' ? 'EDIT_LANDLORD' : 'DELETE_LANDLORD');
    if (!hasPermission) return false;
    
    // Also check if they have edit access to any property of this landlord
    const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
    if (accessiblePropertyIds.length === 0) return false;
    
    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordId },
      include: {
        properties: {
          where: {
            id: { in: accessiblePropertyIds }
          },
          select: { id: true }
        }
      }
    });
    
    return landlord && landlord.properties.length > 0;
  }
  
  return false;
};

// @desc    Get all landlords
// @route   GET /api/landlords
// @access  Private (Requires VIEW_LANDLORDS permission)
export const getLandlords = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check VIEW_LANDLORDS permission for USER role
    if (userRole === 'USER') {
      const hasViewPermission = await permissionService.hasPermission(userId, 'VIEW_LANDLORDS');
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view landlords.',
          requiredPermission: 'VIEW_LANDLORDS'
        });
      }
    }

    let landlords;

    if (userRole === 'ADMIN') {
      // Admin sees all landlords
      landlords = await prisma.landlord.findMany({
        include: {
          properties: {
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } 
    else if (userRole === 'MANAGER') {
      // Manager sees landlords from properties they manage
      const managerProperties = await prisma.property.findMany({
        where: { managerId: userId },
        select: { landlordId: true }
      });

      const landlordIds = [...new Set(managerProperties.map(p => p.landlordId).filter(id => id))];

      if (landlordIds.length === 0) {
        return res.json([]);
      }

      landlords = await prisma.landlord.findMany({
        where: {
          id: { in: landlordIds }
        },
        include: {
          properties: {
            where: {
              managerId: userId
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }
    else if (userRole === 'USER') {
      // Managed user - get landlords from properties they have access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      // Get unique landlord IDs from accessible properties
      const propertiesWithLandlords = await prisma.property.findMany({
        where: {
          id: { in: accessiblePropertyIds },
          landlordId: { not: null }
        },
        select: { landlordId: true }
      });
      
      const landlordIds = [...new Set(propertiesWithLandlords.map(p => p.landlordId))];
      
      if (landlordIds.length === 0) {
        return res.json([]);
      }
      
      // Fetch landlords with their properties (but only properties the user has access to)
      landlords = await prisma.landlord.findMany({
        where: {
          id: { in: landlordIds }
        },
        include: {
          properties: {
            where: {
              id: { in: accessiblePropertyIds }
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }
    else {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied' 
      });
    }

    res.json(landlords);
  } catch (error) {
    console.error('Get landlords error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Get single landlord
// @route   GET /api/landlords/:id
// @access  Private (Requires VIEW_LANDLORDS permission)
export const getLandlord = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check VIEW_LANDLORDS permission for USER role
    if (userRole === 'USER') {
      const hasViewPermission = await permissionService.hasPermission(userId, 'VIEW_LANDLORDS');
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view landlords.',
          requiredPermission: 'VIEW_LANDLORDS'
        });
      }
    }

    let landlord;

    if (userRole === 'ADMIN') {
      // Admin can see any landlord
      landlord = await prisma.landlord.findUnique({
        where: { id },
        include: {
          properties: {
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        }
      });
    } 
    else if (userRole === 'MANAGER') {
      // Manager can only see landlord if they manage at least one property
      landlord = await prisma.landlord.findUnique({
        where: { id },
        include: {
          properties: {
            where: {
              managerId: userId
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        }
      });

      // Check if manager has access to this landlord
      if (landlord && landlord.properties.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied to this landlord' 
        });
      }
    }
    else if (userRole === 'USER') {
      // Managed user - check if they have access to any property linked to this landlord
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied to this landlord' 
        });
      }
      
      landlord = await prisma.landlord.findUnique({
        where: { id },
        include: {
          properties: {
            where: {
              id: { in: accessiblePropertyIds }
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        }
      });

      // Check if user has access to this landlord (must have at least one accessible property)
      if (!landlord || landlord.properties.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied to this landlord' 
        });
      }
    }
    else {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied' 
      });
    }

    if (!landlord) {
      return res.status(404).json({ 
        success: false,
        message: 'Landlord not found' 
      });
    }

    res.json({
      success: true,
      data: landlord
    });
  } catch (error) {
    console.error('Get landlord error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Create landlord
// @route   POST /api/landlords
// @access  Private (Admin, Manager, or User with CREATE_LANDLORD permission)
export const createLandlord = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { name, email, phone, address, idNumber } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false,
        message: 'Name is required' 
      });
    }

    // Check permission for creating landlord
    let canCreate = false;
    
    if (userRole === 'ADMIN') {
      canCreate = true;
    } else if (userRole === 'MANAGER') {
      canCreate = true;
    } else if (userRole === 'USER') {
      // Check if user has CREATE_LANDLORD permission
      canCreate = await permissionService.hasPermission(userId, 'CREATE_LANDLORD');
    }

    if (!canCreate) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. You do not have permission to create landlords.',
        requiredPermission: 'CREATE_LANDLORD'
      });
    }

    const landlord = await prisma.landlord.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        idNumber: idNumber || null
      }
    });

    res.status(201).json({
      success: true,
      message: 'Landlord created successfully',
      data: landlord
    });
  } catch (error) {
    console.error('Create landlord error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Update landlord
// @route   PUT /api/landlords/:id
// @access  Private (Admin, Manager with access, or User with EDIT_LANDLORD permission)
export const updateLandlord = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { name, email, phone, address, idNumber } = req.body;

    // Check EDIT_LANDLORD permission
    let hasAccess = false;

    if (userRole === 'ADMIN') {
      hasAccess = true;
    } else if (userRole === 'MANAGER') {
      // Check if manager has access to this landlord
      const landlord = await prisma.landlord.findUnique({
        where: { id },
        include: {
          properties: {
            where: { managerId: userId },
            select: { id: true }
          }
        }
      });

      if (landlord && landlord.properties.length > 0) {
        hasAccess = true;
      }
    } else if (userRole === 'USER') {
      // Check if user has EDIT_LANDLORD permission
      hasAccess = await permissionService.hasPermission(userId, 'EDIT_LANDLORD');
      
      if (hasAccess) {
        // Also check if they have access to any property of this landlord
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        
        const landlord = await prisma.landlord.findUnique({
          where: { id },
          include: {
            properties: {
              where: {
                id: { in: accessiblePropertyIds }
              },
              select: { id: true }
            }
          }
        });
        
        hasAccess = landlord && landlord.properties.length > 0;
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. You do not have permission to update this landlord.',
        requiredPermission: 'EDIT_LANDLORD'
      });
    }

    const landlord = await prisma.landlord.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(idNumber !== undefined && { idNumber })
      }
    });

    res.json({
      success: true,
      message: 'Landlord updated successfully',
      data: landlord
    });
  } catch (error) {
    console.error('Update landlord error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Delete landlord
// @route   DELETE /api/landlords/:id
// @access  Private (Admin only, or User with DELETE_LANDLORD permission)
export const deleteLandlord = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check DELETE_LANDLORD permission
    let hasAccess = false;

    if (userRole === 'ADMIN') {
      hasAccess = true;
    } else if (userRole === 'USER') {
      // Check if user has DELETE_LANDLORD permission
      hasAccess = await permissionService.hasPermission(userId, 'DELETE_LANDLORD');
      
      if (hasAccess) {
        // Also check if they have access to any property of this landlord
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        
        const landlord = await prisma.landlord.findUnique({
          where: { id },
          include: {
            properties: {
              where: {
                id: { in: accessiblePropertyIds }
              },
              select: { id: true }
            }
          }
        });
        
        hasAccess = landlord && landlord.properties.length > 0;
      }
    } else {
      // Managers cannot delete landlords (only admin or users with permission)
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Only administrators or users with DELETE_LANDLORD permission can delete landlords.' 
      });
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. You do not have permission to delete landlords.',
        requiredPermission: 'DELETE_LANDLORD'
      });
    }

    // Check if landlord exists
    const landlord = await prisma.landlord.findUnique({
      where: { id },
      include: {
        properties: {
          select: { id: true }
        }
      }
    });

    if (!landlord) {
      return res.status(404).json({ 
        success: false,
        message: 'Landlord not found' 
      });
    }

    // Check if landlord has associated properties
    if (landlord.properties.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: `Cannot delete landlord that has ${landlord.properties.length} associated property(ies). Reassign or delete properties first.` 
      });
    }

    await prisma.landlord.delete({
      where: { id }
    });

    res.json({ 
      success: true,
      message: 'Landlord deleted successfully' 
    });
  } catch (error) {
    console.error('Delete landlord error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};