import prisma from '../lib/prisma.js';
import { generateOtherIncomeInvoiceNumber } from '../utils/invoiceHelpers.js';
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { uploadDocument, deleteDocument, fileExists } from '../utils/uploadHelper.js';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import fs from 'fs/promises';
import path from 'path';

/**
 * Get all other incomes for a manager
 */
export const getManagerOtherIncomes = async (req, res) => {
  try {
    const { managerId } = req.params;
    const { status, category, startDate, endDate } = req.query;

    // Build filter conditions
    const where = { managerId };
    
    if (status) where.status = status;
    if (category) where.category = category;
    if (startDate && endDate) {
      where.issueDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const incomes = await prisma.otherIncome.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
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

    // Get statistics
    const stats = await prisma.otherIncome.aggregate({
      where: { managerId },
      _sum: {
        amount: true,
        vatAmount: true,
        totalAmount: true
      },
      _count: true
    });

    // Get status breakdown
    const statusBreakdown = await prisma.otherIncome.groupBy({
      by: ['status'],
      where: { managerId },
      _count: true,
      _sum: {
        totalAmount: true
      }
    });

    res.status(200).json({
      success: true,
      data: incomes,
      stats: {
        totalCount: stats._count,
        totalAmount: stats._sum.totalAmount || 0,
        totalVat: stats._sum.vatAmount || 0,
        totalBaseAmount: stats._sum.amount || 0
      },
      statusBreakdown
    });
  } catch (error) {
    console.error('Error fetching other incomes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch other incomes',
      error: error.message
    });
  }
};

/**
 * Get a single other income by ID
 */
export const getOtherIncomeById = async (req, res) => {
  try {
    const { id } = req.params;

    const income = await prisma.otherIncome.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        attachments: {
          where: { isActive: true },
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    res.status(200).json({
      success: true,
      data: income
    });
  } catch (error) {
    console.error('Error fetching other income:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch other income',
      error: error.message
    });
  }
};

/**
 * Create a new other income
 */
export const createOtherIncome = async (req, res) => {
  try {
    const {
      title,
      description,
      amount,
      vatRate,
      vatType,
      category,
      subCategory,
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      clientCompany,
      dueDate,
      bankName,
      accountName,
      accountNumber,
      branch,
      bankCode,
      swiftCode,
      currency,
      managerId
    } = req.body;

    // Validate required fields
    if (!title || !amount || !clientName || !managerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, amount, clientName, managerId'
      });
    }

    // Check if manager exists
    const manager = await prisma.user.findUnique({
      where: { id: managerId }
    });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: 'Manager not found'
      });
    }

    // Calculate VAT and total
    let vatAmount = 0;
    let totalAmount = amount;

    if (vatType === 'EXCLUSIVE' && vatRate) {
      vatAmount = (amount * vatRate) / 100;
      totalAmount = amount + vatAmount;
    } else if (vatType === 'INCLUSIVE' && vatRate) {
      vatAmount = (amount * vatRate) / (100 + vatRate);
      totalAmount = amount; // Amount already includes VAT
    }

    // Generate invoice number
    const invoiceNumber = await generateOtherIncomeInvoiceNumber();

    // Create the other income
    const newIncome = await prisma.otherIncome.create({
      data: {
        invoiceNumber,
        title,
        description,
        amount,
        vatRate: vatType !== 'NOT_APPLICABLE' ? vatRate : null,
        vatAmount: vatType !== 'NOT_APPLICABLE' ? vatAmount : null,
        vatType,
        totalAmount,
        category,
        subCategory,
        clientName,
        clientEmail,
        clientPhone,
        clientAddress,
        clientCompany,
        dueDate: dueDate ? new Date(dueDate) : null,
        bankName,
        accountName,
        accountNumber,
        branch,
        bankCode,
        swiftCode,
        currency: currency || 'KES',
        managerId,
        createdById: req.user?.id || managerId
      }
    });

    // Generate PDF invoice
    try {
      const pdfUrl = await generateOtherIncomePDF(newIncome);
      await prisma.otherIncome.update({
        where: { id: newIncome.id },
        data: { pdfUrl }
      });
      newIncome.pdfUrl = pdfUrl;
    } catch (pdfError) {
      console.error('Error generating PDF:', pdfError);
      // Continue even if PDF generation fails
    }

    res.status(201).json({
      success: true,
      message: 'Other income created successfully',
      data: newIncome
    });
  } catch (error) {
    console.error('Error creating other income:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create other income',
      error: error.message
    });
  }
};

/**
 * Update an other income
 */
export const updateOtherIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Check if income exists
    const existingIncome = await prisma.otherIncome.findUnique({
      where: { id }
    });

    if (!existingIncome) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    // Recalculate VAT if amount, vatRate, or vatType changed
    let vatAmount = existingIncome.vatAmount;
    let totalAmount = existingIncome.totalAmount;
    const amount = updateData.amount || existingIncome.amount;
    const vatRate = updateData.vatRate !== undefined ? updateData.vatRate : existingIncome.vatRate;
    const vatType = updateData.vatType || existingIncome.vatType;

    if (vatType === 'EXCLUSIVE' && vatRate) {
      vatAmount = (amount * vatRate) / 100;
      totalAmount = amount + vatAmount;
    } else if (vatType === 'INCLUSIVE' && vatRate) {
      vatAmount = (amount * vatRate) / (100 + vatRate);
      totalAmount = amount;
    } else if (vatType === 'NOT_APPLICABLE') {
      vatAmount = 0;
      totalAmount = amount;
    }

    // Update the income
    const updatedIncome = await prisma.otherIncome.update({
      where: { id },
      data: {
        ...updateData,
        vatAmount,
        totalAmount,
        vatRate: vatType !== 'NOT_APPLICABLE' ? vatRate : null,
        dueDate: updateData.dueDate ? new Date(updateData.dueDate) : existingIncome.dueDate
      }
    });

    // Regenerate PDF if significant changes
    if (updateData.title || updateData.amount || updateData.clientName) {
      try {
        const pdfUrl = await generateOtherIncomePDF(updatedIncome);
        await prisma.otherIncome.update({
          where: { id },
          data: { pdfUrl }
        });
        updatedIncome.pdfUrl = pdfUrl;
      } catch (pdfError) {
        console.error('Error regenerating PDF:', pdfError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Other income updated successfully',
      data: updatedIncome
    });
  } catch (error) {
    console.error('Error updating other income:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update other income',
      error: error.message
    });
  }
};

/**
 * Delete an other income
 */
export const deleteOtherIncome = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if income exists
    const existingIncome = await prisma.otherIncome.findUnique({
      where: { id },
      include: {
        attachments: true
      }
    });

    if (!existingIncome) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    // Delete attachments from storage
    for (const attachment of existingIncome.attachments) {
      try {
        await deleteDocument(attachment.fileUrl);
      } catch (error) {
        console.error(`Error deleting attachment ${attachment.id}:`, error);
      }
    }

    // Delete the income
    await prisma.otherIncome.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Other income deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting other income:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete other income',
      error: error.message
    });
  }
};

/**
 * Mark other income as paid
 */
export const markOtherIncomeAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, transactionRef } = req.body;

    const income = await prisma.otherIncome.findUnique({
      where: { id }
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    if (income.status === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Income is already marked as paid'
      });
    }

    const updatedIncome = await prisma.otherIncome.update({
      where: { id },
      data: {
        status: 'PAID',
        paidDate: new Date(),
        paymentMethod,
        transactionRef
      }
    });

    res.status(200).json({
      success: true,
      message: 'Income marked as paid successfully',
      data: updatedIncome
    });
  } catch (error) {
    console.error('Error marking income as paid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark income as paid',
      error: error.message
    });
  }
};

/**
 * Download other income invoice PDF
 */
export const downloadOtherIncomeInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const income = await prisma.otherIncome.findUnique({
      where: { id },
      include: {
        manager: {
          select: {
            name: true,
            email: true
          }
        },
        createdBy: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    // If PDF exists and is accessible, return it
    if (income.pdfUrl) {
      const pdfPath = path.join(process.cwd(), income.pdfUrl);
      try {
        await fs.access(pdfPath);
        return res.download(pdfPath, `invoice-${income.invoiceNumber}.pdf`);
      } catch (error) {
        // If PDF doesn't exist, regenerate it
        console.log('PDF not found, regenerating...');
      }
    }

    // Generate and return PDF
    const pdfBuffer = await generateOtherIncomePDFBuffer(income);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${income.invoiceNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download invoice',
      error: error.message
    });
  }
};

/**
 * Upload attachment for other income
 */
export const uploadOtherIncomeAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Check if income exists
    const income = await prisma.otherIncome.findUnique({
      where: { id }
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Other income not found'
      });
    }

    // Get file data - works with both memory and disk storage
    let fileBuffer;
    let fileOriginalName = file.originalname;
    let fileMimeType = file.mimetype;
    let fileSize = file.size;

    // Check if we have buffer (memory storage) or need to read from disk
    if (file.buffer) {
      // Memory storage
      fileBuffer = file.buffer;
    } else if (file.path) {
      // Disk storage - read the file
      const fsModule = await import('fs/promises');
      fileBuffer = await fsModule.readFile(file.path);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid file data'
      });
    }

    // Generate a unique filename with original extension
    const ext = path.extname(fileOriginalName);
    const baseName = path.basename(fileOriginalName, ext);
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${safeBaseName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    
    // Store in the correct subdirectory: other-income/{id}/filename
    const filePath = `other-income/${id}/${fileName}`;
    const { url } = await uploadDocument(fileBuffer, filePath);

    // Save attachment record
    const attachment = await prisma.otherIncomeAttachment.create({
      data: {
        otherIncomeId: id,
        fileName: fileOriginalName,
        fileUrl: url, // Now stores /uploads/other-income/id/filename
        fileType: fileMimeType,
        fileSize: fileSize,
        uploadedById: req.user?.id || income.createdById,
        description: req.body.description || null
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

    // Clean up disk file if it was saved locally (from disk storage)
    if (file.path) {
      try {
        const fsModule = await import('fs/promises');
        await fsModule.unlink(file.path);
      } catch (cleanupError) {
        console.warn('Could not clean up temporary file:', cleanupError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: attachment
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload attachment',
      error: error.message
    });
  }
};

/**
 * Delete attachment
 */
export const deleteOtherIncomeAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const attachment = await prisma.otherIncomeAttachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Delete file from storage
    try {
      await deleteDocument(attachment.fileUrl);
    } catch (error) {
      console.error('Error deleting file:', error);
    }

    // Delete attachment record
    await prisma.otherIncomeAttachment.delete({
      where: { id: attachmentId }
    });

    res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete attachment',
      error: error.message
    });
  }
};

/**
 * Get income statistics for dashboard
 */
export const getOtherIncomeStats = async (req, res) => {
  try {
    const { managerId } = req.params;
    const { year } = req.query;

    const startDate = new Date(year || new Date().getFullYear(), 0, 1);
    const endDate = new Date(year || new Date().getFullYear(), 11, 31);

    // Get all incomes for the year
    const incomes = await prisma.otherIncome.findMany({
      where: {
        managerId,
        issueDate: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    // Calculate monthly totals
    const monthlyData = {};
    for (let i = 0; i < 12; i++) {
      monthlyData[i] = 0;
    }

    incomes.forEach(income => {
      const month = new Date(income.issueDate).getMonth();
      monthlyData[month] += income.totalAmount;
    });

    // Calculate category breakdown
    const categoryData = {};
    incomes.forEach(income => {
      if (!categoryData[income.category]) {
        categoryData[income.category] = 0;
      }
      categoryData[income.category] += income.totalAmount;
    });

    // Calculate status breakdown
    const statusData = {};
    incomes.forEach(income => {
      if (!statusData[income.status]) {
        statusData[income.status] = 0;
      }
      statusData[income.status] += income.totalAmount;
    });

    res.status(200).json({
      success: true,
      data: {
        monthlyData,
        categoryData,
        statusData,
        totalIncome: incomes.reduce((sum, i) => sum + i.totalAmount, 0),
        count: incomes.length
      }
    });
  } catch (error) {
    console.error('Error fetching income stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch income statistics',
      error: error.message
    });
  }
};

/**
 * Download an attachment
 */
export const downloadOtherIncomeAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;

    // Find the attachment
    const attachment = await prisma.otherIncomeAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        otherIncome: {
          select: {
            managerId: true,
            createdById: true
          }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Check if user has access to this attachment
    const user = req.user;
    if (!user || (user.id !== attachment.otherIncome.managerId && user.id !== attachment.otherIncome.createdById)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download this attachment'
      });
    }

    // Get the file path from the URL
    const fullPath = getFullFilePath(attachment.fileUrl);

    console.log('Downloading file at:', fullPath);
    console.log('File URL from DB:', attachment.fileUrl);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch (error) {
      console.error('File not found:', fullPath);
      
      // Try alternative paths
      const altPaths = getAlternativePaths(attachment.fileUrl);
      
      let found = false;
      for (const altPath of altPaths) {
        try {
          await fs.access(altPath);
          fullPath = altPath;
          found = true;
          console.log('Found file at alternative path:', altPath);
          break;
        } catch (e) {
          // Continue to next alternative
        }
      }
      
      if (!found) {
        return res.status(404).json({
          success: false,
          message: 'File not found on server',
          debug: {
            searchedPaths: [fullPath, ...altPaths],
            fileUrl: attachment.fileUrl
          }
        });
      }
    }

    // Send the file
    res.download(fullPath, attachment.fileName, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Failed to download file'
          });
        }
      }
    });
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download attachment',
      error: error.message
    });
  }
};

/**
 * Preview an attachment (serve file inline)
 */
export const previewOtherIncomeAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;

    // Find the attachment
    const attachment = await prisma.otherIncomeAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        otherIncome: {
          select: {
            managerId: true,
            createdById: true
          }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Check if user has access to this attachment
    const user = req.user;
    if (!user || (user.id !== attachment.otherIncome.managerId && user.id !== attachment.otherIncome.createdById)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this attachment'
      });
    }

    // Get the full file path (absolute path)
    const fullPath = getFullFilePath(attachment.fileUrl);

    console.log('Previewing file at:', fullPath);
    console.log('File URL from DB:', attachment.fileUrl);
    console.log('File type:', attachment.fileType);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch (error) {
      console.error('File not found:', fullPath);
      
      // Try alternative paths
      const altPaths = getAlternativePaths(attachment.fileUrl);
      
      let found = false;
      let foundPath = fullPath;
      for (const altPath of altPaths) {
        try {
          await fs.access(altPath);
          foundPath = altPath;
          found = true;
          console.log('Found file at alternative path:', altPath);
          break;
        } catch (e) {
          // Continue to next alternative
        }
      }
      
      if (!found) {
        return res.status(404).json({
          success: false,
          message: 'File not found on server',
          debug: {
            searchedPaths: [fullPath, ...altPaths],
            fileUrl: attachment.fileUrl,
            fileType: attachment.fileType
          }
        });
      }
      
      // Use the found path with absolute path
      return sendFileForPreview(res, foundPath, attachment);
    }

    // Send the file for preview
    sendFileForPreview(res, fullPath, attachment);
  } catch (error) {
    console.error('Error previewing attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview attachment',
      error: error.message
    });
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get full file path from URL - returns ABSOLUTE path
 */
function getFullFilePath(fileUrl) {
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  
  // Extract the relative path from the URL
  let relativePath = extractFilePathFromUrl(fileUrl);
  
  // Build the absolute full path
  return path.resolve(uploadDir, relativePath);
}

/**
 * Extract file path from URL
 */
function extractFilePathFromUrl(fileUrl) {
  let relativePath = '';
  
  // If the URL starts with http:// or https://
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    try {
      const urlObj = new URL(fileUrl);
      let pathname = urlObj.pathname;
      if (pathname.startsWith('/')) {
        pathname = pathname.substring(1);
      }
      // Remove 'uploads/' if present at the start
      if (pathname.startsWith('uploads/')) {
        pathname = pathname.substring(7);
      }
      relativePath = pathname;
    } catch (e) {
      console.error('Error parsing URL:', e);
      // Fallback: try to extract path after /uploads/
      const uploadsIndex = fileUrl.indexOf('/uploads/');
      if (uploadsIndex !== -1) {
        let pathname = fileUrl.substring(uploadsIndex + 9);
        relativePath = pathname;
      } else {
        relativePath = fileUrl;
      }
    }
  } 
  // If the URL starts with /uploads/
  else if (fileUrl.startsWith('/uploads/')) {
    relativePath = fileUrl.substring(9);
  } 
  // If the URL starts with uploads/
  else if (fileUrl.startsWith('uploads/')) {
    relativePath = fileUrl.substring(8);
  } 
  // If the URL contains the IP address pattern
  else if (fileUrl.includes(':5000/uploads/') || fileUrl.match(/\d+\.\d+\.\d+\.\d+/)) {
    // Extract path after the last /uploads/
    const uploadsIndex = fileUrl.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
      relativePath = fileUrl.substring(uploadsIndex + 9);
    } else {
      // Try to find 'uploads' in the path
      const uploadsMatch = fileUrl.match(/uploads\/(.+)/);
      if (uploadsMatch) {
        relativePath = uploadsMatch[1];
      } else {
        relativePath = fileUrl;
      }
    }
  } 
  // Default: use as is
  else {
    relativePath = fileUrl;
  }
  
  // Clean up the path
  relativePath = relativePath.replace(/^\/+/, '');
  relativePath = relativePath.replace(/\\/g, '/');
  
  return relativePath;
}

/**
 * Get alternative paths to try if file not found
 */
function getAlternativePaths(fileUrl) {
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const relativePath = extractFilePathFromUrl(fileUrl);
  
  // Get the filename from the path
  const filename = path.basename(relativePath);
  const dirPath = path.dirname(relativePath);
  
  // Build alternative paths (absolute paths)
  const altPaths = [
    // Try with the full path from the URL
    path.resolve(uploadDir, relativePath),
    // Try without the subdirectory prefix (just in the uploads root)
    path.resolve(uploadDir, filename),
    // Try in the attachments directory
    path.resolve(uploadDir, 'attachments', filename),
    // Try in the other-income attachments directory
    path.resolve(uploadDir, 'attachments', 'other-income', filename),
    // Try with the directory name from the URL
    path.resolve(uploadDir, dirPath, filename),
    // Try with the original relative path from the URL
    path.resolve(process.cwd(), 'uploads', relativePath)
  ];
  
  // Remove duplicates
  return [...new Set(altPaths)];
}

/**
 * Send file for preview
 */
function sendFileForPreview(res, filePath, attachment) {
  // Determine content type for preview
  let contentType = attachment.fileType;
  
  // Check if the file is an image
  if (attachment.fileType && attachment.fileType.startsWith('image/')) {
    res.setHeader('Content-Type', attachment.fileType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.fileName}"`);
  } 
  // Check if it's a PDF
  else if (attachment.fileType === 'application/pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.fileName}"`);
  } 
  // For other file types that can be previewed in browser
  else if (['text/plain', 'text/html', 'application/json', 'text/css', 'text/javascript'].includes(attachment.fileType)) {
    res.setHeader('Content-Type', attachment.fileType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.fileName}"`);
  }
  // For other file types, force download
  else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
  }
  
  // Send the file using absolute path
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to send file',
          error: err.message
        });
      }
    }
  });
}

// Helper function to generate PDF (saves to file)
async function generateOtherIncomePDF(income) {
  const pdfBuffer = await generateOtherIncomePDFBuffer(income);
  const fileName = `other-income-${income.invoiceNumber}.pdf`;
  const filePath = `invoices/other-income/${fileName}`;
  const { url } = await uploadDocument(pdfBuffer, filePath);
  return url;
}

// Helper function to generate PDF buffer
async function generateOtherIncomePDFBuffer(income) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('INVOICE', { align: 'center' });
      doc.moveDown();

      // Invoice details
      doc.fontSize(10);
      doc.text(`Invoice Number: ${income.invoiceNumber}`, { align: 'right' });
      doc.text(`Date: ${new Date(income.issueDate).toLocaleDateString()}`, { align: 'right' });
      if (income.dueDate) {
        doc.text(`Due Date: ${new Date(income.dueDate).toLocaleDateString()}`, { align: 'right' });
      }
      doc.moveDown();

      // Bill To
      doc.fontSize(12).text('Bill To:', { underline: true });
      doc.fontSize(10);
      doc.text(income.clientName);
      if (income.clientCompany) doc.text(income.clientCompany);
      if (income.clientAddress) doc.text(income.clientAddress);
      if (income.clientEmail) doc.text(`Email: ${income.clientEmail}`);
      if (income.clientPhone) doc.text(`Phone: ${income.clientPhone}`);
      doc.moveDown();

      // Invoice items
      const tableTop = doc.y;
      doc.fontSize(10);
      
      // Table headers
      const headers = ['Description', 'Amount', 'VAT', 'Total'];
      const colWidths = [250, 100, 80, 100];
      const xPositions = [50, 300, 400, 480];
      
      doc.font('Helvetica-Bold');
      headers.forEach((header, i) => {
        doc.text(header, xPositions[i], tableTop, { width: colWidths[i] });
      });
      
      doc.moveDown();
      const lineY = doc.y;
      doc.moveTo(50, lineY).lineTo(550, lineY).stroke();
      doc.moveDown();
      
      // Item row
      doc.font('Helvetica');
      const desc = income.description || income.title;
      doc.text(desc, 50, doc.y, { width: 250 });
      doc.text(`KES ${income.amount.toFixed(2)}`, 300, doc.y, { width: 100, align: 'right' });
      
      const vatText = income.vatType !== 'NOT_APPLICABLE' 
        ? `${income.vatRate}% (KES ${(income.vatAmount || 0).toFixed(2)})`
        : 'N/A';
      doc.text(vatText, 400, doc.y, { width: 80 });
      doc.text(`KES ${income.totalAmount.toFixed(2)}`, 480, doc.y, { width: 100, align: 'right' });
      
      doc.moveDown(2);
      
      // Total
      const totalY = doc.y;
      doc.moveTo(350, totalY).lineTo(550, totalY).stroke();
      doc.moveDown();
      
      doc.font('Helvetica-Bold');
      doc.text('Total Amount:', 350, doc.y, { width: 100, align: 'right' });
      doc.text(`KES ${income.totalAmount.toFixed(2)}`, 480, doc.y, { width: 100, align: 'right' });
      
      // VAT Summary
      if (income.vatType !== 'NOT_APPLICABLE') {
        doc.moveDown();
        doc.font('Helvetica');
        doc.fontSize(9);
        doc.text(`VAT (${income.vatRate}%): KES ${(income.vatAmount || 0).toFixed(2)}`, 350, doc.y, { align: 'right' });
        doc.text(`VAT Type: ${income.vatType}`, 350, doc.y, { align: 'right' });
      }
      
      doc.moveDown(2);
      
      // Payment Information
      if (income.bankName || income.accountName) {
        doc.fontSize(10).text('Payment Information:', { underline: true });
        if (income.bankName) doc.text(`Bank: ${income.bankName}`);
        if (income.accountName) doc.text(`Account Name: ${income.accountName}`);
        if (income.accountNumber) doc.text(`Account Number: ${income.accountNumber}`);
        if (income.branch) doc.text(`Branch: ${income.branch}`);
        if (income.bankCode) doc.text(`Bank Code: ${income.bankCode}`);
        if (income.swiftCode) doc.text(`SWIFT Code: ${income.swiftCode}`);
      }
      
      doc.moveDown();
      
      // Footer
      doc.fontSize(8);
      doc.text('Thank you for your business!', { align: 'center' });
      doc.text(`Generated by ${income.manager?.name || 'System'}`, { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}