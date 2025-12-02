import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/properties/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: property-{timestamp}-{randomString}.{extension}
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `property-${uniqueSuffix}${extension}`);
  }
});

// File filter for images only
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
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// @desc    Get all properties
// @route   GET /api/properties
// @access  Private
export const getProperties = async (req, res) => {
  try {
    const properties = await prisma.property.findMany({
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
    const property = await prisma.property.findUnique({
      where: { id: req.params.id },
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

    res.json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create property (with optional inline landlord creation)
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

    // Convert enum values to uppercase
    const formattedForm = form ? form.toUpperCase() : null;
    const formattedUsage = usage ? usage.toUpperCase() : null;

    // Validate required fields
    if (!name || !address || !formattedForm || !formattedUsage) {
      return res.status(400).json({
        message: 'Name, address, form, and usage are required fields.'
      });
    }

    // Validate form and usage enums
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

    // Validate commission fee if provided
    if (commissionFee && (commissionFee < 0 || commissionFee > 100)) {
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    // Enforce: MANAGER must associate property with a landlord (existing or new)
    if (currentUser.role === 'MANAGER' && !landlordId && !landlord) {
      return res.status(400).json({
        message: 'A landlord (ID or details) is required when creating a property.'
      });
    }

    // Prepare data object for Prisma
    const propertyData = {
      name,
      address,
      lrNumber: lrNumber || null,
      form: formattedForm,
      usage: formattedUsage,
      commissionFee: commissionFee ? parseFloat(commissionFee) : null,
      // Bank details
      accountNo: accountNo || null,
      accountName: accountName || null,
      bank: bank || null,
      branch: branch || null,
      branchCode: branchCode || null
    };

    // Handle image file
    if (req.file) {
      propertyData.image = req.file.path;
    }

    // Handle landlord relation
    if (landlord) {
      // Case 1: Create new landlord inline
      const landlordData = typeof landlord === 'string' ? JSON.parse(landlord) : landlord;
      const { name: landlordName, email, phone, address: landlordAddress, idNumber } = landlordData;

      // Validate required landlord fields
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
      // Case 2: Connect to existing landlord
      // Verify landlord exists
      const existingLandlord = await prisma.landlord.findUnique({
        where: { id: landlordId }
      });
      if (!existingLandlord) {
        return res.status(400).json({ message: 'Landlord not found.' });
      }
      
      propertyData.landlord = {
        connect: { id: landlordId }
      };
    }
    // Case 3: No landlord - only allowed for ADMIN
    else if (currentUser.role !== 'ADMIN') {
      return res.status(400).json({
        message: 'Only ADMIN can create a property without a landlord.'
      });
    }

    // Handle manager assignment
    if (currentUser.role === 'MANAGER') {
      propertyData.manager = {
        connect: { id: currentUser.id }
      };
    } else if (currentUser.role === 'ADMIN' && managerId) {
      // Admin can assign to a specific manager
      propertyData.manager = {
        connect: { id: managerId }
      };
    }

    // Create the property
    const property = await prisma.property.create({
      data: propertyData,
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } },
        units: true,
        serviceProviders: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property
    });
  } catch (error) {
    console.error('Create property error:', error);
    
    // Clean up uploaded file if creation fails
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

    // Check if property exists
    const existingProperty = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: {
        units: true
      }
    });

    if (!existingProperty) {
      // Clean up uploaded file if property doesn't exist
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Property not found' });
    }

    // Convert enum values to uppercase if provided
    const formattedForm = form ? form.toUpperCase() : existingProperty.form;
    const formattedUsage = usage ? usage.toUpperCase() : existingProperty.usage;

    // Validate form and usage enums if they're being updated
    if (form) {
      const validForms = ['APARTMENT', 'BUNGALOW', 'VILLA', 'OFFICE', 'SHOP', 'DUPLEX', 'TOWNHOUSE', 'MAISONETTE', 'WAREHOUSE', 'INDUSTRIAL_BUILDING', 'RETAIL_CENTER'];
      if (!validForms.includes(formattedForm)) {
        // Clean up uploaded file if validation fails
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
        // Clean up uploaded file if validation fails
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          message: `Invalid usage value. Must be one of: ${validUsages.join(', ')}`
        });
      }
    }

    // Check if usage type is changing
    if (usage && formattedUsage !== existingProperty.usage) {
      // Validate existing units against new usage type
      const hasUnits = existingProperty.units.length > 0;
      
      if (hasUnits) {
        // Check if there are issues with existing units based on the new usage type
        const residentialUnits = existingProperty.units.filter(u => u.unitType === 'RESIDENTIAL');
        const commercialUnits = existingProperty.units.filter(u => u.unitType === 'COMMERCIAL');
        
        // If changing to pure RESIDENTIAL and there are COMMERCIAL units
        if (formattedUsage === 'RESIDENTIAL' && commercialUnits.length > 0) {
          // Clean up uploaded file if validation fails
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            message: 'Cannot change to RESIDENTIAL usage type. Property has COMMERCIAL units. Please update or remove them first.'
          });
        }
        
        // If changing to COMMERCIAL/INDUSTRIAL/INSTITUTIONAL and there are RESIDENTIAL units
        if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(formattedUsage) && residentialUnits.length > 0) {
          // Clean up uploaded file if validation fails
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            message: `Cannot change to ${formattedUsage} usage type. Property has RESIDENTIAL units. Please update or remove them first.`
          });
        }
      }
    }

    // Validate commission fee if provided
    if (commissionFee && (commissionFee < 0 || commissionFee > 100)) {
      // Clean up uploaded file if validation fails
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    // Handle image file - if new image uploaded
    let imagePath = existingProperty.image;
    if (req.file) {
      // Delete old image if it exists
      if (existingProperty.image && fs.existsSync(existingProperty.image)) {
        fs.unlinkSync(existingProperty.image);
      }
      imagePath = req.file.path;
    }

    // Prepare update data object
    const updateData = {
      name: name !== undefined ? name : undefined,
      address: address !== undefined ? address : undefined,
      lrNumber: lrNumber !== undefined ? lrNumber : undefined,
      form: formattedForm,
      usage: formattedUsage,
      commissionFee: commissionFee !== undefined ? parseFloat(commissionFee) : undefined,
      image: imagePath,
      // Bank details
      accountNo: accountNo !== undefined ? accountNo : undefined,
      accountName: accountName !== undefined ? accountName : undefined,
      bank: bank !== undefined ? bank : undefined,
      branch: branch !== undefined ? branch : undefined,
      branchCode: branchCode !== undefined ? branchCode : undefined
    };

    // Handle landlord relation if provided
    if (landlordId !== undefined) {
      if (landlordId === null || landlordId === '') {
        // Remove landlord association
        updateData.landlord = {
          disconnect: true
        };
      } else {
        // Verify landlord exists before connecting
        const existingLandlord = await prisma.landlord.findUnique({
          where: { id: landlordId }
        });
        if (!existingLandlord) {
          // Clean up uploaded file if validation fails
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: 'Landlord not found.' });
        }
        
        // Connect to existing landlord
        updateData.landlord = {
          connect: { id: landlordId }
        };
      }
    }

    // Handle manager relation if provided
    if (managerId !== undefined) {
      if (managerId === null || managerId === '') {
        // Remove manager association
        updateData.manager = {
          disconnect: true
        };
      } else {
        // Verify manager exists before connecting
        const existingManager = await prisma.user.findUnique({
          where: { id: managerId }
        });
        if (!existingManager) {
          // Clean up uploaded file if validation fails
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: 'Manager not found.' });
        }
        
        // Connect to existing manager
        updateData.manager = {
          connect: { id: managerId }
        };
      }
    }

    // Remove undefined values from updateData
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const property = await prisma.property.update({
      where: { id: req.params.id },
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

    res.json({
      success: true,
      message: 'Property updated successfully',
      data: property
    });
  } catch (error) {
    console.error('Update property error:', error);
    // Clean up uploaded file if update fails
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
// @access  Private (Admin only)
export const deleteProperty = async (req, res) => {
  try {
    // Check if property exists
    const existingProperty = await prisma.property.findUnique({
      where: { id: req.params.id }
    });

    if (!existingProperty) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Delete associated image file if it exists
    if (existingProperty.image && fs.existsSync(existingProperty.image)) {
      fs.unlinkSync(existingProperty.image);
    }

    await prisma.property.delete({
      where: { id: req.params.id }
    });

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
    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required.' });
    }

    // Check if property exists
    const existingProperty = await prisma.property.findUnique({
      where: { id: req.params.id }
    });

    if (!existingProperty) {
      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Property not found' });
    }

    // Delete old image if it exists
    if (existingProperty.image && fs.existsSync(existingProperty.image)) {
      fs.unlinkSync(existingProperty.image);
    }

    const property = await prisma.property.update({
      where: { id: req.params.id },
      data: { image: req.file.path },
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(property);
  } catch (error) {
    // Clean up uploaded file if update fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update property commission fee only
// @route   PATCH /api/properties/:id/commission
// @access  Private (Admin only)
export const updatePropertyCommission = async (req, res) => {
  try {
    const { commissionFee } = req.body;

    if (commissionFee === undefined || commissionFee === null) {
      return res.status(400).json({ message: 'Commission fee is required.' });
    }

    if (commissionFee < 0 || commissionFee > 100) {
      return res.status(400).json({
        message: 'Commission fee must be between 0 and 100 percent.'
      });
    }

    // Check if property exists
    const existingProperty = await prisma.property.findUnique({
      where: { id: req.params.id }
    });

    if (!existingProperty) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const property = await prisma.property.update({
      where: { id: req.params.id },
      data: { commissionFee: parseFloat(commissionFee) },
      include: {
        landlord: true,
        manager: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Serve property image
// @route   GET /api/properties/:id/image
// @access  Public (or Private based on your needs)
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
