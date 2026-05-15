import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";

// Helper function to check if user has access to a property with specific permission
const checkPropertyAccess = async (userId, userRole, propertyId, requiredPermission = 'canView') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await permissionService.checkPropertyAccess(userId, propertyId, requiredPermission);
  }
  
  return false;
};

// Helper function to check unit-specific permissions
const checkUnitPermission = async (userId, userRole, propertyId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await permissionService.checkUnitPermission(userId, propertyId, operation);
  }
  
  return false;
};

// Helper function to check if user has write access to a specific unit
const checkUnitWriteAccess = async (userId, userRole, unitId, operation = 'edit') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: true }
    });
    if (!unit) return false;
    return unit.property.managerId === userId;
  }
  
  if (userRole === 'USER') {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: true }
    });
    if (!unit) return false;
    return await permissionService.checkUnitPermission(userId, unit.propertyId, operation);
  }
  
  return false;
};

// Helper function to determine unit type based on property usage
const determineUnitType = (propertyUsage, requestedUnitType) => {
  // For pure residential properties, unit type must be RESIDENTIAL
  if (propertyUsage === 'RESIDENTIAL') {
    return 'RESIDENTIAL';
  }
  
  // For commercial, industrial, institutional properties, unit type must be COMMERCIAL
  if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(propertyUsage)) {
    return 'COMMERCIAL';
  }
  
  // For MIXED_USE, allow user to specify
  if (propertyUsage === 'MIXED_USE') {
    return requestedUnitType || 'RESIDENTIAL'; // Default to RESIDENTIAL if not specified
  }
  
  return 'RESIDENTIAL'; // Default fallback
};

// Helper function to calculate rent amount based on rent type
const calculateRentAmount = (rentType, rentAmount, sizeSqFt) => {
  if (rentType === 'PER_SQFT') {
    // For PER_SQFT, rentAmount is the rate per square foot
    // Total rent = rate per sq ft * size in sq ft
    return parseFloat(rentAmount) * parseInt(sizeSqFt);
  }
  // For all other rent types, use the provided rentAmount directly
  return parseFloat(rentAmount);
};

// Helper function to validate and prepare unit data based on property usage and unit type
const prepareUnitData = (propertyUsage, unitType, data) => {
  // Calculate rent amount based on rent type
  const calculatedRentAmount = calculateRentAmount(data.rentType, data.rentAmount, data.sizeSqFt);

  const unitData = {
    propertyId: data.propertyId,
    unitNo: data.unitNo || null,
    floor: data.floor || null,
    unitType: unitType,
    sizeSqFt: parseInt(data.sizeSqFt),
    type: data.type || null,
    status: data.status || 'VACANT',
    rentType: data.rentType,
    rentAmount: calculatedRentAmount
  };

  // For RESIDENTIAL units: include bedrooms and bathrooms, exclude usage
  if (unitType === 'RESIDENTIAL') {
    unitData.bedrooms = data.bedrooms ? parseInt(data.bedrooms) : null;
    unitData.bathrooms = data.bathrooms ? parseInt(data.bathrooms) : null;
    unitData.usage = null; // Explicitly set to null for residential
  }
  
  // For COMMERCIAL units: include usage field, exclude bedrooms and bathrooms
  if (unitType === 'COMMERCIAL') {
    unitData.usage = data.usage || null; // Business type (e.g., "Boutique", "Bank")
    unitData.bedrooms = null; // Explicitly set to null for commercial
    unitData.bathrooms = null; // Explicitly set to null for commercial
  }

  return unitData;
};

// @desc    Get all units
// @route   GET /api/units
// @access  Private
export const getUnits = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let units;

    if (userRole === 'ADMIN') {
      // Admin sees all units
      units = await prisma.unit.findMany({
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: true
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'MANAGER') {
      // Manager sees units for their properties
      units = await prisma.unit.findMany({
        where: {
          property: {
            managerId: userId
          }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: true
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'USER') {
      // USER sees units for accessible properties where they have VIEW_UNITS permission
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      // Filter properties where user has VIEW_UNITS permission
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkUnitPermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      units = await prisma.unit.findMany({
        where: {
          propertyId: { in: propertiesWithPermission }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: true
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(units);
  } catch (error) {
    console.error('Get units error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get units by property
// @route   GET /api/units/property/:propertyId
// @access  Private
export const getUnitsByProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;
    const { status } = req.query;

    // Check if user has VIEW_UNITS permission for this property
    const hasViewPermission = await checkUnitPermission(userId, userRole, propertyId, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ message: 'Access denied to view units for this property' });
    }
    
    // Build where clause
    const whereClause = { propertyId };
    
    if (status) {
      whereClause.status = status;
    }
    
    const units = await prisma.unit.findMany({
      where: whereClause,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            usage: true,
            form: true
          }
        },
        tenant: true
      },
      orderBy: { unitNo: 'asc' }
    });
    res.json(units);
  } catch (error) {
    console.error('Get units by property error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single unit
// @route   GET /api/units/:id
// @access  Private
export const getUnit = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const unit = await prisma.unit.findUnique({
      where: { id },
      include: {
        property: {
          include: {
            landlord: true,
            manager: { select: { id: true, name: true, email: true } }
          }
        },
        tenant: {
          include: {
            serviceCharge: true
          }
        }
      }
    });

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Check if user has VIEW_UNITS permission
    const hasViewPermission = await checkUnitPermission(userId, userRole, unit.propertyId, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ message: 'Access denied to view this unit' });
    }

    res.json(unit);
  } catch (error) {
    console.error('Get unit error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create unit
// @route   POST /api/units
// @access  Private
export const createUnit = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { 
      propertyId, 
      unitNo,
      floor,
      unitType: requestedUnitType,
      usage,
      bedrooms, 
      bathrooms, 
      sizeSqFt, 
      type, 
      status, 
      rentType, 
      rentAmount 
    } = req.body;

    // Validate required fields
    if (!propertyId || !sizeSqFt || !rentType || !rentAmount) {
      return res.status(400).json({
        message: 'Property, size, rent type, and rent amount are required fields.'
      });
    }

    // Check if user has CREATE_UNIT permission
    const hasCreatePermission = await checkUnitPermission(userId, userRole, propertyId, 'create');
    
    if (!hasCreatePermission) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to create units for this property.',
        requiredPermission: 'CREATE_UNIT'
      });
    }

    // Validate rent amount
    const parsedRentAmount = parseFloat(rentAmount);
    if (isNaN(parsedRentAmount) || parsedRentAmount < 0) {
      return res.status(400).json({
        message: 'Rent amount must be a positive number'
      });
    }

    // Validate size
    const parsedSizeSqFt = parseInt(sizeSqFt);
    if (isNaN(parsedSizeSqFt) || parsedSizeSqFt <= 0) {
      return res.status(400).json({
        message: 'Size must be a positive number'
      });
    }

    // Fetch property to get usage type
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { usage: true, name: true }
    });

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Determine the correct unit type based on property usage
    const finalUnitType = determineUnitType(property.usage, requestedUnitType);

    // Validate unit type for non-MIXED_USE properties
    if (property.usage === 'RESIDENTIAL' && requestedUnitType === 'COMMERCIAL') {
      return res.status(400).json({
        message: 'Cannot create COMMERCIAL unit in a RESIDENTIAL property.'
      });
    }

    if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(property.usage) && requestedUnitType === 'RESIDENTIAL') {
      return res.status(400).json({
        message: `Cannot create RESIDENTIAL unit in a ${property.usage} property.`
      });
    }

    // Validate RESIDENTIAL unit requirements
    if (finalUnitType === 'RESIDENTIAL') {
      if (!bedrooms || !bathrooms) {
        return res.status(400).json({
          message: 'Bedrooms and bathrooms are required for RESIDENTIAL units.'
        });
      }
      if (usage) {
        return res.status(400).json({
          message: 'Usage field is only applicable for COMMERCIAL units.'
        });
      }
    }

    // Validate COMMERCIAL unit requirements
    if (finalUnitType === 'COMMERCIAL') {
      if (bedrooms || bathrooms) {
        return res.status(400).json({
          message: 'Bedrooms and bathrooms are not applicable for COMMERCIAL units.'
        });
      }
    }

    // Prepare unit data
    const unitData = prepareUnitData(property.usage, finalUnitType, {
      propertyId,
      unitNo,
      floor,
      usage,
      bedrooms,
      bathrooms,
      sizeSqFt: parsedSizeSqFt,
      type,
      status,
      rentType,
      rentAmount: parsedRentAmount
    });

    const unit = await prisma.unit.create({
      data: unitData,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            usage: true,
            form: true
          }
        },
        tenant: true
      }
    });

    // Add calculation info to response for PER_SQFT type
    let response = unit;
    if (rentType === 'PER_SQFT') {
      response = {
        ...unit,
        calculationInfo: {
          ratePerSqFt: parsedRentAmount,
          sizeSqFt: parsedSizeSqFt,
          calculatedRent: unit.rentAmount,
          formula: `KES ${parsedRentAmount} × ${parsedSizeSqFt} sq ft = KES ${unit.rentAmount}`
        }
      };
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Create unit error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update unit
// @route   PUT /api/units/:id
// @access  Private
export const updateUnit = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { 
      unitNo,
      floor,
      unitType: requestedUnitType,
      usage,
      bedrooms, 
      bathrooms, 
      sizeSqFt, 
      type, 
      status, 
      rentType, 
      rentAmount 
    } = req.body;

    // Fetch existing unit with property details
    const existingUnit = await prisma.unit.findUnique({
      where: { id },
      include: {
        property: {
          select: { usage: true, name: true, managerId: true }
        },
        tenant: true
      }
    });

    if (!existingUnit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Check EDIT_UNIT permission
    const hasEditPermission = await checkUnitWriteAccess(userId, userRole, id, 'edit');
    
    if (!hasEditPermission) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to update this unit.',
        requiredPermission: 'EDIT_UNIT'
      });
    }

    // Check if unit has a tenant - if yes, restrict rent amount updates
    if (existingUnit.tenant && rentAmount !== undefined) {
      return res.status(400).json({
        message: 'Cannot update rent amount for an occupied unit. Please update the tenant\'s rent instead.'
      });
    }

    // Determine unit type - use existing if not changing
    const finalUnitType = requestedUnitType 
      ? determineUnitType(existingUnit.property.usage, requestedUnitType)
      : existingUnit.unitType;

    // Validate unit type change for non-MIXED_USE properties
    if (requestedUnitType && requestedUnitType !== existingUnit.unitType) {
      if (existingUnit.property.usage === 'RESIDENTIAL' && requestedUnitType === 'COMMERCIAL') {
        return res.status(400).json({
          message: 'Cannot change to COMMERCIAL unit in a RESIDENTIAL property.'
        });
      }

      if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(existingUnit.property.usage) && requestedUnitType === 'RESIDENTIAL') {
        return res.status(400).json({
          message: `Cannot change to RESIDENTIAL unit in a ${existingUnit.property.usage} property.`
        });
      }
    }

    // Validate RESIDENTIAL unit requirements
    if (finalUnitType === 'RESIDENTIAL') {
      if (usage) {
        return res.status(400).json({
          message: 'Usage field is only applicable for COMMERCIAL units.'
        });
      }
    }

    // Validate COMMERCIAL unit requirements
    if (finalUnitType === 'COMMERCIAL') {
      if (bedrooms || bathrooms) {
        return res.status(400).json({
          message: 'Bedrooms and bathrooms are not applicable for COMMERCIAL units.'
        });
      }
    }

    // Parse and validate size if provided
    let parsedSizeSqFt = undefined;
    if (sizeSqFt !== undefined) {
      parsedSizeSqFt = parseInt(sizeSqFt);
      if (isNaN(parsedSizeSqFt) || parsedSizeSqFt <= 0) {
        return res.status(400).json({
          message: 'Size must be a positive number'
        });
      }
    }

    // Parse and validate rent amount if provided
    let parsedRentAmount = undefined;
    if (rentAmount !== undefined) {
      parsedRentAmount = parseFloat(rentAmount);
      if (isNaN(parsedRentAmount) || parsedRentAmount < 0) {
        return res.status(400).json({
          message: 'Rent amount must be a positive number'
        });
      }
    }

    // Determine final rent type
    const finalRentType = rentType !== undefined ? rentType : existingUnit.rentType;

    // Calculate the final rent amount
    let finalRentAmount;
    if (rentAmount !== undefined || sizeSqFt !== undefined || rentType !== undefined) {
      // If any of these fields are being updated, recalculate rent amount
      const currentSize = parsedSizeSqFt !== undefined ? parsedSizeSqFt : existingUnit.sizeSqFt;
      const currentRate = parsedRentAmount !== undefined ? parsedRentAmount : 
                         (finalRentType === 'PER_SQFT' ? existingUnit.rentAmount / existingUnit.sizeSqFt : existingUnit.rentAmount);
      
      finalRentAmount = calculateRentAmount(finalRentType, currentRate, currentSize);
    } else {
      // No changes to rent-related fields, keep existing rent amount
      finalRentAmount = existingUnit.rentAmount;
    }

    // Prepare update data
    const updateData = {
      unitNo: unitNo !== undefined ? unitNo : existingUnit.unitNo,
      floor: floor !== undefined ? floor : existingUnit.floor,
      unitType: finalUnitType,
      usage: usage !== undefined ? usage : existingUnit.usage,
      bedrooms: bedrooms !== undefined ? bedrooms : existingUnit.bedrooms,
      bathrooms: bathrooms !== undefined ? bathrooms : existingUnit.bathrooms,
      sizeSqFt: parsedSizeSqFt !== undefined ? parsedSizeSqFt : existingUnit.sizeSqFt,
      type: type !== undefined ? type : existingUnit.type,
      status: status !== undefined ? status : existingUnit.status,
      rentType: finalRentType,
      rentAmount: finalRentAmount
    };

    // For RESIDENTIAL units: ensure usage is null
    if (finalUnitType === 'RESIDENTIAL') {
      updateData.usage = null;
    }

    // For COMMERCIAL units: ensure bedrooms and bathrooms are null
    if (finalUnitType === 'COMMERCIAL') {
      updateData.bedrooms = null;
      updateData.bathrooms = null;
    }

    const unit = await prisma.unit.update({
      where: { id },
      data: updateData,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            usage: true,
            form: true
          }
        },
        tenant: {
          include: {
            serviceCharge: true
          }
        }
      }
    });

    // Add calculation info to response for PER_SQFT type
    let response = unit;
    if (finalRentType === 'PER_SQFT') {
      const ratePerSqFt = finalRentAmount / unit.sizeSqFt;
      response = {
        ...unit,
        calculationInfo: {
          ratePerSqFt: ratePerSqFt,
          sizeSqFt: unit.sizeSqFt,
          calculatedRent: unit.rentAmount,
          formula: `KES ${ratePerSqFt.toFixed(2)} × ${unit.sizeSqFt} sq ft = KES ${unit.rentAmount}`
        }
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Update unit error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete unit
// @route   DELETE /api/units/:id
// @access  Private
export const deleteUnit = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check DELETE_UNIT permission
    const hasDeletePermission = await checkUnitWriteAccess(userId, userRole, id, 'delete');
    
    if (!hasDeletePermission) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to delete this unit.',
        requiredPermission: 'DELETE_UNIT'
      });
    }

    // Check if unit has a tenant
    const unit = await prisma.unit.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    if (unit.tenant) {
      return res.status(400).json({
        message: 'Cannot delete unit with active tenant. Please remove tenant first.'
      });
    }

    await prisma.unit.delete({
      where: { id }
    });

    res.json({ message: 'Unit deleted successfully' });
  } catch (error) {
    console.error('Delete unit error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update unit status (vacant/occupied)
// @route   PATCH /api/units/:id/status
// @access  Private
export const updateUnitStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['VACANT', 'OCCUPIED'].includes(status)) {
      return res.status(400).json({ message: 'Valid status (VACANT or OCCUPIED) is required' });
    }

    // Fetch existing unit
    const existingUnit = await prisma.unit.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!existingUnit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Check UPDATE_UNIT_STATUS permission
    const hasUpdateStatusPermission = await checkUnitWriteAccess(userId, userRole, id, 'updateStatus');
    
    if (!hasUpdateStatusPermission) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to update unit status.',
        requiredPermission: 'UPDATE_UNIT_STATUS'
      });
    }

    const updatedUnit = await prisma.unit.update({
      where: { id },
      data: { status },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      }
    });

    res.json({
      message: `Unit status updated to ${status}`,
      unit: updatedUnit
    });
  } catch (error) {
    console.error('Update unit status error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get vacant units
// @route   GET /api/units/vacant
// @access  Private
export const getVacantUnits = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let units;

    if (userRole === 'ADMIN') {
      units = await prisma.unit.findMany({
        where: { status: 'VACANT' },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'MANAGER') {
      units = await prisma.unit.findMany({
        where: {
          status: 'VACANT',
          property: {
            managerId: userId
          }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'USER') {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      // Filter properties where user has VIEW_UNITS permission
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkUnitPermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      units = await prisma.unit.findMany({
        where: {
          status: 'VACANT',
          propertyId: { in: propertiesWithPermission }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(units);
  } catch (error) {
    console.error('Get vacant units error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get occupied units
// @route   GET /api/units/occupied
// @access  Private
export const getOccupiedUnits = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let units;

    if (userRole === 'ADMIN') {
      units = await prisma.unit.findMany({
        where: { status: 'OCCUPIED' },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: {
            include: {
              serviceCharge: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'MANAGER') {
      units = await prisma.unit.findMany({
        where: {
          status: 'OCCUPIED',
          property: {
            managerId: userId
          }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: {
            include: {
              serviceCharge: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else if (userRole === 'USER') {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      // Filter properties where user has VIEW_UNITS permission
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkUnitPermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      units = await prisma.unit.findMany({
        where: {
          status: 'OCCUPIED',
          propertyId: { in: propertiesWithPermission }
        },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              usage: true,
              form: true
            }
          },
          tenant: {
            include: {
              serviceCharge: true
            }
          }
        },
        orderBy: { property: { name: 'asc' } }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(units);
  } catch (error) {
    console.error('Get occupied units error:', error);
    res.status(400).json({ message: error.message });
  }
};