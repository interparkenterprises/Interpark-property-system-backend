import prisma from '../lib/prisma.js';
import { generateOtherIncomeInvoiceNumber } from '../utils/invoiceHelpers.js';
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { uploadDocument, deleteDocument, fileExists } from '../utils/uploadHelper.js';
import puppeteer from 'puppeteer';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

// ============================================
// MODULE-LEVEL SETUP
// ============================================

// Load letterhead once at module load
let letterheadBase64 = '';
try {
  const letterheadPath = path.join(process.cwd(), 'src/letterHeads/letterhead.jpg');
  const letterhead = fsSync.readFileSync(letterheadPath);
  // Detect mime type from extension
  const ext = path.extname(letterheadPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  letterheadBase64 = `data:${mime};base64,${letterhead.toString('base64')}`;
} catch (err) {
  console.warn('Letterhead not found, PDF will render without logo:', err.message);
}

// Currency formatter
const formatCurrency = (value) =>
  Number(value ?? 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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

    // If PDF exists, try to serve it from disk
    if (income.pdfUrl) {
      // Use the same path resolution helper used for attachments —
      // it correctly handles absolute URLs, /uploads/ prefixes,
      // and falls back to alternative locations.
      const candidates = [
        getFullFilePath(income.pdfUrl),
        ...getAlternativePaths(income.pdfUrl),
      ];

      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          console.log('Serving existing invoice PDF from:', candidate);
          return res.download(candidate, `invoice-${income.invoiceNumber}.pdf`);
        } catch {
          // try next candidate
        }
      }

      console.warn(
        'PDF URL present in DB but file not found on disk. Regenerating...',
        { pdfUrl: income.pdfUrl, tried: candidates }
      );
    }

    // Generate and return PDF buffer (fallback)
    const pdfBuffer = await generateOtherIncomePDFBuffer(income);

    // Optionally: persist the regenerated PDF so next time it's served from disk.
    try {
      const savedUrl = await generateOtherIncomePDF(income);
      await prisma.otherIncome.update({
        where: { id },
        data: { pdfUrl: savedUrl },
      });
    } catch (persistErr) {
      console.warn('Could not persist regenerated invoice PDF:', persistErr.message);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${income.invoiceNumber}.pdf`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download invoice',
        error: error.message
      });
    }
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

// ============================================
// PDF GENERATION (HTML + Puppeteer)
// ============================================

/**
 * Helper function to generate PDF buffer using HTML + Puppeteer.
 * Renders a professional invoice with letterhead, centered layout, and repeating footer.
 */
async function generateOtherIncomePDFBuffer(income) {
  const html = buildOtherIncomeInvoiceHtml(income);
  const footerTemplate = buildOtherIncomeFooterTemplate();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>', // empty header (letterhead is in body)
      footerTemplate,
      margin: {
        top: '20px',
        bottom: '80px',   // reserve space for footer
        left: '40px',
        right: '40px',
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Build the HTML template for an Other Income invoice.
 * Uses a letterhead image, centered content, and a clean table layout.
 */
function buildOtherIncomeInvoiceHtml(income) {
  const issueDate = income.issueDate
    ? new Date(income.issueDate).toLocaleDateString('en-KE')
    : '-';
  const dueDate = income.dueDate
    ? new Date(income.dueDate).toLocaleDateString('en-KE')
    : '-';

  const hasVat = income.vatType && income.vatType !== 'NOT_APPLICABLE';
  const vatLabel = hasVat
    ? `VAT (${income.vatRate ?? 0}% - ${income.vatType})`
    : 'VAT';

  const statusColor =
    income.status === 'PAID'
      ? '#16a34a'
      : income.status === 'OVERDUE'
      ? '#dc2626'
      : '#f59e0b';

  const bankDetails = [
    income.bankName && `<p><strong>Bank:</strong> ${income.bankName}</p>`,
    income.accountName && `<p><strong>Account Name:</strong> ${income.accountName}</p>`,
    income.accountNumber && `<p><strong>Account Number:</strong> ${income.accountNumber}</p>`,
    income.branch && `<p><strong>Branch:</strong> ${income.branch}</p>`,
    income.bankCode && `<p><strong>Bank Code:</strong> ${income.bankCode}</p>`,
    income.swiftCode && `<p><strong>SWIFT Code:</strong> ${income.swiftCode}</p>`,
  ]
    .filter(Boolean)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    color: #333;
    margin: 0;
    padding: 0;
  }
  .letterhead {
    width: 100%;
    text-align: center;
    margin-bottom: 20px;
  }
  .letterhead img {
    max-width: 100%;
    max-height: 130px;
    object-fit: contain;
  }
  .title {
    text-align: center;
    font-size: 28px;
    font-weight: bold;
    letter-spacing: 2px;
    color: #004f79;
    margin: 20px 0 5px 0;
  }
  .subtitle {
    text-align: center;
    font-size: 13px;
    color: #64748b;
    margin-bottom: 25px;
  }
  .divider {
    border: none;
    border-top: 2px solid #004f79;
    margin: 15px 0 25px 0;
  }
  .meta {
    width: 100%;
    margin: 0 auto 25px auto;
    text-align: center;
  }
  .meta table {
    width: 100%;
    border-collapse: collapse;
  }
  .meta td {
    padding: 6px 10px;
    text-align: center;
    font-size: 12px;
  }
  .meta .label {
    color: #64748b;
    font-weight: bold;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }
  .status {
    display: inline-block;
    padding: 4px 14px;
    border-radius: 4px;
    background: ${statusColor};
    color: #fff;
    font-weight: bold;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  .bill-to {
    text-align: center;
    margin: 25px 0;
    padding: 18px 20px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .bill-to .heading {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #64748b;
    margin-bottom: 8px;
  }
  .bill-to .name {
    font-size: 16px;
    font-weight: bold;
    color: #1e293b;
    margin-bottom: 4px;
  }
  .bill-to p {
    margin: 3px 0;
    font-size: 12px;
    color: #475569;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  table.items thead th {
    background: #004f79;
    color: #fff;
    padding: 12px 10px;
    font-size: 12px;
    text-align: left;
    letter-spacing: 0.5px;
  }
  table.items thead th.center { text-align: center; }
  table.items thead th.right { text-align: right; }
  table.items tbody td {
    padding: 12px 10px;
    border: 1px solid #e2e8f0;
    font-size: 12px;
    vertical-align: top;
  }
  table.items tbody td.center { text-align: center; }
  table.items tbody td.right { text-align: right; }
  table.items tfoot td {
    padding: 10px;
    border: 1px solid #e2e8f0;
    font-size: 12px;
  }
  table.items tfoot td.right { text-align: right; }
  table.items tfoot tr.grand-total td {
    background: #004f79;
    color: #fff;
    font-weight: bold;
    font-size: 14px;
    padding: 12px 10px;
  }
  .bank {
    margin-top: 35px;
    padding: 18px 22px;
    background: #f8fafc;
    border-left: 4px solid #004f79;
    border-radius: 4px;
  }
  .bank h3 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: #004f79;
    letter-spacing: 0.5px;
  }
  .bank p {
    margin: 4px 0;
    font-size: 12px;
    color: #334155;
  }
  .notes {
    margin-top: 25px;
    padding: 15px 18px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 4px;
    font-size: 12px;
    color: #78350f;
    text-align: center;
  }
  .notes strong { display: block; margin-bottom: 5px; }
</style>
</head>
<body>

  ${letterheadBase64 ? `
    <div class="letterhead">
      <img src="${letterheadBase64}" alt="Letterhead">
    </div>
  ` : ''}

  <div class="title">INVOICE</div>
  <div class="subtitle">${income.category ? income.category.replace(/_/g, ' ') : 'Other Income'}</div>

  <hr class="divider">

  <div class="meta">
    <table>
      <tr>
        <td class="label">Invoice No</td>
        <td class="label">Issue Date</td>
        <td class="label">Due Date</td>
        <td class="label">Status</td>
      </tr>
      <tr>
        <td><strong>${income.invoiceNumber ?? '-'}</strong></td>
        <td>${issueDate}</td>
        <td>${dueDate}</td>
        <td><span class="status">${income.status ?? 'UNPAID'}</span></td>
      </tr>
    </table>
  </div>

  <div class="bill-to">
    <div class="heading">Bill To</div>
    <div class="name">${income.clientName ?? '-'}</div>
    ${income.clientCompany ? `<p>${income.clientCompany}</p>` : ''}
    ${income.clientAddress ? `<p>${income.clientAddress}</p>` : ''}
    ${income.clientEmail ? `<p>Email: ${income.clientEmail}</p>` : ''}
    ${income.clientPhone ? `<p>Phone: ${income.clientPhone}</p>` : ''}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="center">Qty</th>
        <th class="right">Amount (${income.currency || 'KES'})</th>
        <th class="right">VAT</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <strong>${income.title ?? '-'}</strong>
          ${income.description ? `<br><span style="color:#64748b;font-size:11px;">${income.description}</span>` : ''}
        </td>
        <td class="center">1</td>
        <td class="right">${formatCurrency(income.amount)}</td>
        <td class="right">${hasVat ? formatCurrency(income.vatAmount) : 'N/A'}</td>
        <td class="right">${formatCurrency(income.totalAmount)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="right"><strong>Subtotal</strong></td>
        <td class="right">${formatCurrency(income.amount)}</td>
      </tr>
      <tr>
        <td colspan="4" class="right"><strong>${vatLabel}</strong></td>
        <td class="right">${hasVat ? formatCurrency(income.vatAmount) : '0.00'}</td>
      </tr>
      <tr class="grand-total">
        <td colspan="4" class="right">TOTAL DUE</td>
        <td class="right"> ${formatCurrency(income.totalAmount)}</td>
      </tr>
    </tfoot>
  </table>

  ${bankDetails ? `
    <div class="bank">
      <h3>Payment Details</h3>
      ${bankDetails}
    </div>
  ` : ''}

  ${income.description ? `
    <div class="notes">
      <strong>Notes</strong>
      ${income.description}
    </div>
  ` : ''}

</body>
</html>
  `;
}

/**
 * Puppeteer footerTemplate for Other Income invoices.
 * Renders on every printed page via page.pdf({ displayHeaderFooter: true, footerTemplate }).
 * Must be self-contained inline CSS.
 */
function buildOtherIncomeFooterTemplate() {
  return `
<div style="font-size:9px; color:#777; width:100%; text-align:center; padding:0 40px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #cbd5e1; padding-top:6px;">
  <strong style="color:#004f79;">INTERPARK PROPERTY MANAGEMENT</strong><br>
  Property Management Solutions
  &nbsp;&middot;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
  `;
}