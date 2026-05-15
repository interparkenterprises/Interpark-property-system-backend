import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Helper function to get accessible property IDs
async function getAccessiblePropertyIds(userId, userRole) {
  return await permissionService.getAccessiblePropertyIds(userId, userRole);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/properties/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `property-${uniqueSuffix}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// @desc    Get all properties
// @route   GET /api/properties
// @access  Private
export const getProperties = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let properties;

    if (userRole === 'ADMIN') {
      properties = await prisma.property.findMany({
        include: {
          landlord: true,
          manager: { select: { id: true, name: true, email: true } },
          units: true,
          serviceProviders: true,
          _count: {
            select: {
              units: true,
              leads: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } else {
      const accessiblePropertyIds = await getAccessiblePropertyIds(userId, userRole);
      
      properties = await prisma.property.findMany({
        where: {
          id: { in: accessiblePropertyIds }
        },
        include: {
          landlord: true,
          manager: { select: { id: true, name: true, email: true } },
          units: true,
          serviceProviders: true,
          _count: {
            select: {
              units: true,
              leads: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    res.json(properties);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single property
// @route   GET /api/properties/:id
// @access  Private
export const getProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const propertyId = req.params.id;

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } },
        units: {
          include: {
            tenant: {
              include: {
                serviceCharge: true
              }
            }
          }
        },
        serviceProviders: true,
        leads: true,
        incomes: true,
        commissions: true
      }
    });

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Use permission service for access check
    const hasAccess = await permissionService.checkPropertyAccess(userId, propertyId, 'canView');
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this property' });
    }

    res.json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create property
// @route   POST /api/properties
// @access  Private
export const createProperty = async (req, res) => {
  try {
    const { 
      name, 
      address, 
      lrNumber, 
      form, 
      usage, 
      landlordId, 
      landlord, 
      managerId, 
      commissionFee,
      accountNo,
      accountName,
      bank,
      branch,
      branchCode
    } = req.body;
    
    const currentUser = req.user;

    // Check CREATE_PROPERTY permission
    const canCreate = await permissionService.checkPermission(
      currentUser.id, 
      'property', 
      'create'
    );
    
    if (!canCreate) {
      return res.status(403).json({ 
        message: 'You do not have permission to create properties' 
      });
    }

    const formattedForm = form ? form.toUpperCase() : null;
    const formattedUsage = usage ? usage.toUpperCase() : null;

    if (!name || !address || !formattedForm || !formattedUsage) {
      return res.status(400).json({
        message: 'Name, address, form, and usage are required fields.'
      });
    }

    const validForms = ['APARTMENT', 'BUNGALOW', 'VILLA', 'OFFICE', 'SHOP', 'DUPLEX', 'TOWNHOUSE', 'MAISONETTE', 'WAREHOUSE', 'INDUSTRIAL_BUILDING', 'RETAIL_CENTER'];
    const validUsages = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE'];

    if (!validForms.includes(formattedForm)) {
      return res.status(400).json({
        message: `Invalid form value. Must be one of: ${validForms.join(', ')}`
      });
    }

    if (!validUsages.includes(formattedUsage)) {
      return res.status(400).json({
        message: `Invalid usage value. Must be one of: ${validUsages.join(', ')}`
      });
    }

    if (commissionFee && (commissionFee < 0 || commissionFee > 100)) {
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    if (currentUser.role === 'MANAGER' && !landlordId && !landlord) {
      return res.status(400).json({
        message: 'A landlord (ID or details) is required when creating a property.'
      });
    }

    const propertyData = {
      name,
      address,
      lrNumber: lrNumber || null,
      form: formattedForm,
      usage: formattedUsage,
      commissionFee: commissionFee ? parseFloat(commissionFee) : null,
      accountNo: accountNo || null,
      accountName: accountName || null,
      bank: bank || null,
      branch: branch || null,
      branchCode: branchCode || null
    };

    if (req.file) {
      propertyData.image = req.file.path;
    }

    if (landlord) {
      const landlordData = typeof landlord === 'string' ? JSON.parse(landlord) : landlord;
      const { name: landlordName, email, phone, address: landlordAddress, idNumber } = landlordData;

      if (!landlordName) {
        return res.status(400).json({ message: 'Landlord name is required.' });
      }

      propertyData.landlord = {
        create: {
          name: landlordName,
          email: email || null,
          phone: phone || null,
          address: landlordAddress || null,
          idNumber: idNumber || null
        }
      };
    } else if (landlordId) {
      const existingLandlord = await prisma.landlord.findUnique({
        where: { id: landlordId }
      });
      if (!existingLandlord) {
        return res.status(400).json({ message: 'Landlord not found.' });
      }
      
      propertyData.landlord = {
        connect: { id: landlordId }
      };
    } else if (currentUser.role !== 'ADMIN') {
      return res.status(400).json({
        message: 'Only ADMIN can create a property without a landlord.'
      });
    }

    if (currentUser.role === 'MANAGER') {
      propertyData.manager = {
        connect: { id: currentUser.id }
      };
    } else if (currentUser.role === 'ADMIN' && managerId) {
      propertyData.manager = {
        connect: { id: managerId }
      };
    }

    const property = await prisma.property.create({
      data: propertyData,
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } },
        units: true,
        serviceProviders: true
      }
    });

    // Invalidate cache for the new property
    await permissionService.invalidatePropertyAccessCache(property.id);

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property
    });
  } catch (error) {
    console.error('Create property error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Update property
// @route   PUT /api/properties/:id
// @access  Private
export const updateProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const propertyId = req.params.id;
    
    const { 
      name, 
      address, 
      lrNumber, 
      form, 
      usage, 
      landlordId, 
      managerId, 
      commissionFee,
      accountNo,
      accountName,
      bank,
      branch,
      branchCode
    } = req.body;

    // Check EDIT_PROPERTY permission
    const canEdit = await permissionService.checkPermission(
      userId, 
      'property', 
      'edit', 
      propertyId
    );
    
    if (!canEdit) {
      return res.status(403).json({ 
        message: 'You do not have permission to edit this property' 
      });
    }

    const existingProperty = await prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        units: true
      }
    });

    if (!existingProperty) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Property not found' });
    }

    const formattedForm = form ? form.toUpperCase() : existingProperty.form;
    const formattedUsage = usage ? usage.toUpperCase() : existingProperty.usage;

    if (form) {
      const validForms = ['APARTMENT', 'BUNGALOW', 'VILLA', 'OFFICE', 'SHOP', 'DUPLEX', 'TOWNHOUSE', 'MAISONETTE', 'WAREHOUSE', 'INDUSTRIAL_BUILDING', 'RETAIL_CENTER'];
      if (!validForms.includes(formattedForm)) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          message: `Invalid form value. Must be one of: ${validForms.join(', ')}`
        });
      }
    }

    if (usage) {
      const validUsages = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE'];
      if (!validUsages.includes(formattedUsage)) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          message: `Invalid usage value. Must be one of: ${validUsages.join(', ')}`
        });
      }
    }

    if (usage && formattedUsage !== existingProperty.usage) {
      const hasUnits = existingProperty.units.length > 0;
      
      if (hasUnits) {
        const residentialUnits = existingProperty.units.filter(u => u.unitType === 'RESIDENTIAL');
        const commercialUnits = existingProperty.units.filter(u => u.unitType === 'COMMERCIAL');
        
        if (formattedUsage === 'RESIDENTIAL' && commercialUnits.length > 0) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            message: 'Cannot change to RESIDENTIAL usage type. Property has COMMERCIAL units.'
          });
        }
        
        if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(formattedUsage) && residentialUnits.length > 0) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            message: `Cannot change to ${formattedUsage} usage type. Property has RESIDENTIAL units.`
          });
        }
      }
    }

    if (commissionFee && (commissionFee < 0 || commissionFee > 100)) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    let imagePath = existingProperty.image;
    if (req.file) {
      if (existingProperty.image && fs.existsSync(existingProperty.image)) {
        fs.unlinkSync(existingProperty.image);
      }
      imagePath = req.file.path;
    }

    const updateData = {
      name: name !== undefined ? name : undefined,
      address: address !== undefined ? address : undefined,
      lrNumber: lrNumber !== undefined ? lrNumber : undefined,
      form: formattedForm,
      usage: formattedUsage,
      commissionFee: commissionFee !== undefined ? parseFloat(commissionFee) : undefined,
      image: imagePath,
      accountNo: accountNo !== undefined ? accountNo : undefined,
      accountName: accountName !== undefined ? accountName : undefined,
      bank: bank !== undefined ? bank : undefined,
      branch: branch !== undefined ? branch : undefined,
      branchCode: branchCode !== undefined ? branchCode : undefined
    };

    if (landlordId !== undefined) {
      if (landlordId === null || landlordId === '') {
        updateData.landlord = { disconnect: true };
      } else {
        const existingLandlord = await prisma.landlord.findUnique({
          where: { id: landlordId }
        });
        if (!existingLandlord) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: 'Landlord not found.' });
        }
        
        updateData.landlord = { connect: { id: landlordId } };
      }
    }

    if (managerId !== undefined) {
      if (managerId === null || managerId === '') {
        updateData.manager = { disconnect: true };
      } else {
        const existingManager = await prisma.user.findUnique({
          where: { id: managerId }
        });
        if (!existingManager) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: 'Manager not found.' });
        }
        
        updateData.manager = { connect: { id: managerId } };
      }
    }

    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const property = await prisma.property.update({
      where: { id: propertyId },
      data: updateData,
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } },
        units: {
          include: {
            tenant: {
              include: {
                serviceCharge: true
              }
            }
          }
        },
        serviceProviders: true
      }
    });

    // Invalidate cache for this property
    await permissionService.invalidatePropertyAccessCache(propertyId);
    await permissionService.invalidateUserCache(userId);

    res.json({
      success: true,
      message: 'Property updated successfully',
      data: property
    });
  } catch (error) {
    console.error('Update property error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Delete property
// @route   DELETE /api/properties/:id
// @access  Private (Admin only with DELETE_PROPERTY permission)
export const deleteProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const propertyId = req.params.id;

    // Check DELETE_PROPERTY permission
    const canDelete = await permissionService.checkPermission(
      userId, 
      'property', 
      'delete', 
      propertyId
    );
    
    if (!canDelete) {
      return res.status(403).json({ 
        message: 'You do not have permission to delete this property' 
      });
    }

    const existingProperty = await prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!existingProperty) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (existingProperty.image && fs.existsSync(existingProperty.image)) {
      fs.unlinkSync(existingProperty.image);
    }

    await prisma.property.delete({
      where: { id: propertyId }
    });

    // Invalidate cache
    await permissionService.invalidatePropertyAccessCache(propertyId);
    await permissionService.invalidateUserCache(userId);

    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get properties by manager
// @route   GET /api/properties/manager/my-properties
// @access  Private (Manager only)
export const getManagerProperties = async (req, res) => {
  try {
    const currentUser = req.user;

    if (currentUser.role !== 'MANAGER') {
      return res.status(403).json({ message: 'Access denied. Manager role required.' });
    }

    const properties = await prisma.property.findMany({
      where: { managerId: currentUser.id },
      include: {
        landlord: true,
        units: {
          include: {
            tenant: true
          }
        },
        serviceProviders: true,
        _count: {
          select: {
            units: true,
            leads: true,
            incomes: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(properties);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update property image only
// @route   PATCH /api/properties/:id/image
// @access  Private
export const updatePropertyImage = async (req, res) => {
  try {
    const userId = req.user.id;
    const propertyId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required.' });
    }

    // Check EDIT_PROPERTY permission
    const canEdit = await permissionService.checkPermission(
      userId, 
      'property', 
      'edit', 
      propertyId
    );
    
    if (!canEdit) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ 
        message: 'You do not have permission to update this property\'s image' 
      });
    }

    const existingProperty = await prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!existingProperty) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Property not found' });
    }

    if (existingProperty.image && fs.existsSync(existingProperty.image)) {
      fs.unlinkSync(existingProperty.image);
    }

    const property = await prisma.property.update({
      where: { id: propertyId },
      data: { image: req.file.path },
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(property);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update property commission fee only
// @route   PATCH /api/properties/:id/commission
// @access  Private (Admin only with APPROVE_COMMISSIONS permission)
export const updatePropertyCommission = async (req, res) => {
  try {
    const userId = req.user.id;
    const propertyId = req.params.id;
    const { commissionFee } = req.body;

    // Check PROCESS_COMMISSIONS or APPROVE_COMMISSIONS permission
    const canUpdateCommission = await permissionService.hasAnyPermission(
      userId,
      ['PROCESS_COMMISSIONS', 'APPROVE_COMMISSIONS'],
      propertyId
    );
    
    if (!canUpdateCommission) {
      return res.status(403).json({ 
        message: 'You do not have permission to update commission fees' 
      });
    }

    if (commissionFee === undefined || commissionFee === null) {
      return res.status(400).json({ message: 'Commission fee is required.' });
    }

    if (commissionFee < 0 || commissionFee > 100) {
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    const existingProperty = await prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!existingProperty) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const property = await prisma.property.update({
      where: { id: propertyId },
      data: { commissionFee: parseFloat(commissionFee) },
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } }
      }
    });

    // Invalidate cache
    await permissionService.invalidatePropertyAccessCache(propertyId);

    res.json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Serve property image
// @route   GET /api/properties/:id/image
// @access  Public
export const getPropertyImage = async (req, res) => {
  try {
    const property = await prisma.property.findUnique({
      where: { id: req.params.id },
      select: { image: true }
    });

    if (!property || !property.image) {
      return res.status(404).json({ message: 'Image not found' });
    }

    if (!fs.existsSync(property.image)) {
      return res.status(404).json({ message: 'Image file not found on server' });
    }

    res.sendFile(path.resolve(property.image));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};