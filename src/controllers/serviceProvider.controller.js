import prisma from "../lib/prisma.js";
import fs from 'fs/promises';
import permissionService from "../services/permissionService.js";
import { uploadDocument, deleteDocument, fileExists } from "../utils/uploadHelper.js";
import path from 'path';
import { createReadStream } from 'fs';

// Helper function to check if user has access to a property
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

// Helper function to check if user has write access to a service provider
const checkServiceProviderWriteAccess = async (userId, userRole, providerId = null) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    if (providerId) {
      const provider = await prisma.serviceProvider.findUnique({
        where: { id: providerId },
        include: { property: true }
      });
      if (!provider) return false;
      return provider.property.managerId === userId;
    }
    return true;
  }
  
  if (userRole === 'USER') {
    if (providerId) {
      const provider = await prisma.serviceProvider.findUnique({
        where: { id: providerId },
        include: { property: true }
      });
      if (!provider) return false;
      return await permissionService.checkPropertyAccess(userId, provider.propertyId, 'canEdit');
    }
    return false; // USER needs a specific property to create
  }
  
  return false;
};

// Helper to get service provider with permission check
const getServiceProviderWithAccess = async (id, userId, userRole) => {
  const provider = await prisma.serviceProvider.findUnique({
    where: { id },
    include: { 
      property: true,
      attachments: {
        where: { isActive: true },
        orderBy: { uploadedAt: 'desc' }
      }
    }
  });

  if (!provider) {
    return { error: 'Service provider not found', status: 404 };
  }

  const hasAccess = await checkPropertyAccess(userId, userRole, provider.propertyId, 'canView');
  if (!hasAccess) {
    return { error: 'Access denied to this service provider', status: 403 };
  }

  return { provider };
};

// =============================================
// SERVICE PROVIDER CRUD OPERATIONS
// =============================================

// @desc    Get all service providers
// @route   GET /api/service-providers
// @access  Private
export const getServiceProviders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let providers;

    if (userRole === 'ADMIN') {
      // Admin sees all service providers with their attachments
      providers = await prisma.serviceProvider.findMany({
        include: { 
          property: true,
          attachments: {
            where: { isActive: true },
            orderBy: { uploadedAt: 'desc' }
          }
        },
        orderBy: { name: 'asc' }
      });
    } else if (userRole === 'MANAGER') {
      // Manager sees service providers for their properties
      providers = await prisma.serviceProvider.findMany({
        where: {
          property: {
            managerId: userId
          }
        },
        include: { 
          property: true,
          attachments: {
            where: { isActive: true },
            orderBy: { uploadedAt: 'desc' }
          }
        },
        orderBy: { name: 'asc' }
      });
    } else if (userRole === 'USER') {
      // USER sees service providers for accessible properties
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      providers = await prisma.serviceProvider.findMany({
        where: {
          propertyId: { in: accessiblePropertyIds }
        },
        include: { 
          property: true,
          attachments: {
            where: { isActive: true },
            orderBy: { uploadedAt: 'desc' }
          }
        },
        orderBy: { name: 'asc' }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(providers);
  } catch (error) {
    console.error('Get service providers error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get service providers by property
// @route   GET /api/service-providers/property/:propertyId
// @access  Private
export const getServiceProvidersByProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;

    // Check property access
    const hasAccess = await checkPropertyAccess(userId, userRole, propertyId, 'canView');
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this property' });
    }

    const providers = await prisma.serviceProvider.findMany({
      where: { propertyId },
      include: { 
        property: true,
        attachments: {
          where: { isActive: true },
          orderBy: { uploadedAt: 'desc' }
        }
      }
    });

    res.json(providers);
  } catch (error) {
    console.error('Get service providers by property error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single service provider
// @route   GET /api/service-providers/:id
// @access  Private
export const getServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const result = await getServiceProviderWithAccess(id, userId, userRole);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    res.json(result.provider);
  } catch (error) {
    console.error('Get service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create service provider
// @route   POST /api/service-providers
// @access  Private
export const createServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      propertyId,
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

    // Check if user has write access to the property
    const hasWriteAccess = await checkPropertyAccess(userId, userRole, propertyId, 'canEdit');
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to create service providers for this property.' });
    }

    const provider = await prisma.serviceProvider.create({
      data: {
        propertyId,
        name,
        contact,
        contractPeriod,
        serviceContract,
        chargeAmount: parseFloat(chargeAmount),
        chargeFrequency,
      },
      include: { 
        property: true,
        attachments: true
      }
    });

    res.status(201).json(provider);
  } catch (error) {
    console.error('Create service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update service provider
// @route   PUT /api/service-providers/:id
// @access  Private
export const updateServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const {
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

    // Check if service provider exists and get property info
    const existingProvider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!existingProvider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, id);
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to update this service provider.' });
    }

    const provider = await prisma.serviceProvider.update({
      where: { id },
      data: {
        name,
        contact,
        contractPeriod,
        serviceContract,
        chargeAmount: chargeAmount ? parseFloat(chargeAmount) : undefined,
        chargeFrequency,
      },
      include: { 
        property: true,
        attachments: {
          where: { isActive: true },
          orderBy: { uploadedAt: 'desc' }
        }
      }
    });

    res.json(provider);
  } catch (error) {
    console.error('Update service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete service provider
// @route   DELETE /api/service-providers/:id
// @access  Private
export const deleteServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check if service provider exists and get property info
    const existingProvider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { 
        property: true,
        attachments: true // Include attachments to delete them
      }
    });

    if (!existingProvider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, id);
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to delete this service provider.' });
    }

    // Delete all associated attachments from storage
    for (const attachment of existingProvider.attachments) {
      try {
        await deleteDocument(attachment.fileUrl);
      } catch (error) {
        console.warn(`Failed to delete attachment file: ${attachment.fileUrl}`, error);
      }
    }

    // Delete the service provider (cascade will delete attachments)
    await prisma.serviceProvider.delete({
      where: { id }
    });

    res.json({ 
      message: 'Service provider deleted successfully',
      attachmentsDeleted: existingProvider.attachments.length
    });
  } catch (error) {
    console.error('Delete service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// =============================================
// SERVICE PROVIDER ATTACHMENT OPERATIONS
// =============================================

// @desc    Get all attachments for a service provider
// @route   GET /api/service-providers/:id/attachments
// @access  Private
export const getAttachments = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const result = await getServiceProviderWithAccess(id, userId, userRole);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    res.json({
      success: true,
      data: result.provider.attachments
    });
  } catch (error) {
    console.error('Get attachments error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Upload attachment for a service provider
// @route   POST /api/service-providers/:id/attachments
// @access  Private
export const uploadAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { description, category, expiryDate, version } = req.body;

    // Check if service provider exists and user has access
    const provider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!provider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, id);
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to upload attachments for this service provider.' });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // READ THE FILE FROM DISK (since we're using diskStorage)
    const fileBuffer = await fs.readFile(req.file.path);

    // Generate file path
    const fileExtension = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
    const filePath = `service-providers/${id}/${fileName}`;

    // Upload to storage (this will save the file to the final location)
    const { url } = await uploadDocument(fileBuffer, filePath);

    // Clean up the temporary file from multer's upload directory
    try {
      await fs.unlink(req.file.path);
    } catch (unlinkError) {
      console.warn('Failed to delete temporary file:', unlinkError);
      // Don't throw error, just log it
    }

    // Create attachment record
    const attachment = await prisma.serviceProviderAttachment.create({
      data: {
        serviceProviderId: id,
        fileName: req.file.originalname,
        fileUrl: url,
        fileType: path.extname(req.file.originalname).substring(1).toUpperCase() || 'UNKNOWN',
        fileSize: req.file.size,
        description: description || null,
        category: category || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        version: version || null,
        uploadedById: userId,
        isActive: true
      },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: attachment,
      message: 'Attachment uploaded successfully'
    });
  } catch (error) {
    console.error('Upload attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update attachment metadata
// @route   PUT /api/service-providers/attachments/:attachmentId
// @access  Private
export const updateAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;
    const { description, category, expiryDate, version, isActive } = req.body;

    // Get the attachment with service provider info
    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, attachment.serviceProviderId);
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to update this attachment.' });
    }

    // Update attachment
    const updatedAttachment = await prisma.serviceProviderAttachment.update({
      where: { id: attachmentId },
      data: {
        description: description !== undefined ? description : attachment.description,
        category: category !== undefined ? category : attachment.category,
        expiryDate: expiryDate ? new Date(expiryDate) : attachment.expiryDate,
        version: version !== undefined ? version : attachment.version,
        isActive: isActive !== undefined ? isActive : attachment.isActive
      },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        serviceProvider: {
          select: {
            id: true,
            name: true,
            propertyId: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: updatedAttachment,
      message: 'Attachment updated successfully'
    });
  } catch (error) {
    console.error('Update attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete attachment
// @route   DELETE /api/service-providers/attachments/:attachmentId
// @access  Private
export const deleteAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;

    // Get the attachment with service provider info
    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, attachment.serviceProviderId);
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to delete this attachment.' });
    }

    // Delete file from storage
    try {
      await deleteDocument(attachment.fileUrl);
    } catch (error) {
      console.warn(`Failed to delete file from storage: ${attachment.fileUrl}`, error);
    }

    // Delete attachment record (hard delete or soft delete)
    // Option 1: Hard delete
    await prisma.serviceProviderAttachment.delete({
      where: { id: attachmentId }
    });

    // Option 2: Soft delete (uncomment if you want soft delete)
    // await prisma.serviceProviderAttachment.update({
    //   where: { id: attachmentId },
    //   data: { isActive: false }
    // });

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single attachment details
// @route   GET /api/service-providers/attachments/:attachmentId
// @access  Private
export const getAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;

    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        },
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check view access
    const hasAccess = await checkPropertyAccess(userId, userRole, attachment.serviceProvider.propertyId, 'canView');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this attachment' });
    }

    res.json({
      success: true,
      data: attachment
    });
  } catch (error) {
    console.error('Get attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get attachments by category
// @route   GET /api/service-providers/:id/attachments/category/:category
// @access  Private
export const getAttachmentsByCategory = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id, category } = req.params;

    const result = await getServiceProviderWithAccess(id, userId, userRole);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const attachments = result.provider.attachments.filter(
      att => att.category === category
    );

    res.json({
      success: true,
      data: attachments
    });
  } catch (error) {
    console.error('Get attachments by category error:', error);
    res.status(400).json({ message: error.message });
  }
};


// @desc    Preview an attachment (serve file inline)
// @route   GET /api/service-providers/attachments/:attachmentId/preview
// @access  Private
export const previewAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;

    // Get the attachment with service provider info
    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check view access
    const hasAccess = await checkPropertyAccess(userId, userRole, attachment.serviceProvider.propertyId, 'canView');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this attachment' });
    }

    // Get the file path from the URL
    const filePath = attachment.fileUrl.replace(/^.*\/uploads\//, '');
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.join(uploadDir, filePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch (error) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    // Get file stats
    const stats = await fs.stat(fullPath);

    // Determine content type
    const fileExtension = path.extname(fullPath).toLowerCase();
    const contentType = getContentType(fileExtension);

    // Set headers for inline preview
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    
    // For images, allow caching
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the file - USING IMPORTED createReadStream
    const fileStream = createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Preview attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Download an attachment
// @route   GET /api/service-providers/attachments/:attachmentId/download
// @access  Private
export const downloadAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;

    // Get the attachment with service provider info
    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check view access
    const hasAccess = await checkPropertyAccess(userId, userRole, attachment.serviceProvider.propertyId, 'canView');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this attachment' });
    }

    // Get the file path from the URL
    const filePath = attachment.fileUrl.replace(/^.*\/uploads\//, '');
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.join(uploadDir, filePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch (error) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    // Get file stats
    const stats = await fs.stat(fullPath);

    // Determine content type
    const fileExtension = path.extname(fullPath).toLowerCase();
    const contentType = getContentType(fileExtension);

    // Set headers for download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.fileName)}"`);
    
    // No caching for downloads
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Stream the file - USING IMPORTED createReadStream
    const fileStream = createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download attachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get attachment download URL (for frontend use)
// @route   GET /api/service-providers/attachments/:attachmentId/url
// @access  Private
export const getAttachmentUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { attachmentId } = req.params;

    // Get the attachment with service provider info
    const attachment = await prisma.serviceProviderAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        serviceProvider: {
          include: { property: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check view access
    const hasAccess = await checkPropertyAccess(userId, userRole, attachment.serviceProvider.propertyId, 'canView');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this attachment' });
    }

    // Generate a temporary download URL (you can add expiry time if needed)
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const downloadUrl = `${baseUrl}/api/service-providers/attachments/${attachmentId}/download`;
    const previewUrl = `${baseUrl}/api/service-providers/attachments/${attachmentId}/preview`;

    res.json({
      success: true,
      data: {
        id: attachment.id,
        fileName: attachment.fileName,
        fileUrl: attachment.fileUrl,
        downloadUrl: downloadUrl,
        previewUrl: previewUrl,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        isActive: attachment.isActive
      }
    });
  } catch (error) {
    console.error('Get attachment URL error:', error);
    res.status(400).json({ message: error.message });
  }
};

// Helper function to get content type based on file extension
const getContentType = (extension) => {
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.ico': 'image/x-icon',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  return contentTypes[extension] || 'application/octet-stream';
};