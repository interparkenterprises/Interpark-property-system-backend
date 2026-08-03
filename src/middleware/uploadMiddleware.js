
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create subdirectories for different upload types
const subDirectories = [
  'invoices',
  'invoices/other-income',
  'receipts',
  'attachments',
  'attachments/other-income',
  'profiles',
  'documents',
  'temp'
];

subDirectories.forEach(subDir => {
  const dirPath = path.join(uploadDir, subDir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Configure multer storage - DISK STORAGE (for most cases)
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine subdirectory based on route or file type
    let subDir = '';
    
    if (req.path.includes('/other-income')) {
      subDir = 'attachments/other-income';
    } else if (req.path.includes('/invoice')) {
      subDir = 'invoices';
    } else if (req.path.includes('/profile')) {
      subDir = 'profiles';
    } else if (req.path.includes('/receipt')) {
      subDir = 'receipts';
    } else {
      subDir = 'attachments';
    }
    
    const destinationPath = path.join(uploadDir, subDir);
    
    // Ensure the subdirectory exists
    if (!fs.existsSync(destinationPath)) {
      fs.mkdirSync(destinationPath, { recursive: true });
    }
    
    cb(null, destinationPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    // Sanitize filename
    const safeBasename = basename.replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${safeBasename}-${uniqueSuffix}${ext}`);
  }
});

// Memory storage (for buffer operations like PDF generation)
const memoryStorage = multer.memoryStorage();

// File filter for allowed types
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    // Images
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text files
    'text/plain',
    'text/csv',
    'text/html',
    'application/json',
    'application/xml',
    // Archive
    'application/zip',
    'application/x-rar-compressed',
    // Additional formats
    'application/vnd.oasis.opendocument.text', // ODT
    'application/vnd.oasis.opendocument.spreadsheet', // ODS
    'application/vnd.oasis.opendocument.presentation' // ODP
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not supported. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

// Create multer instances
const diskUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1 // Only one file at a time
  },
  fileFilter: fileFilter
});

const memoryUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for memory storage (smaller to prevent memory issues)
    files: 1
  },
  fileFilter: fileFilter
});

// Export the configured multer instances
export default diskUpload;

// ============================================
// EXPORT: Disk Storage Upload Middlewares
// ============================================

/**
 * Single file upload with disk storage
 * @param {string} fieldName - The field name in the form
 * @param {string} subDir - Optional subdirectory within uploads
 * @returns {Function} Express middleware
 */
export const uploadSingle = (fieldName = 'file', subDir = null) => {
  return (req, res, next) => {
    // Dynamically set destination if subDir is provided
    if (subDir) {
      const destinationPath = path.join(uploadDir, subDir);
      if (!fs.existsSync(destinationPath)) {
        fs.mkdirSync(destinationPath, { recursive: true });
      }
      // Override destination for this request
      const customStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, destinationPath),
        filename: diskStorage.filename
      });
      const customUpload = multer({
        storage: customStorage,
        limits: {
          fileSize: 50 * 1024 * 1024,
          files: 1
        },
        fileFilter: fileFilter
      });
      
      customUpload.single(fieldName)(req, res, (err) => {
        handleMulterError(err, req, res, next, fieldName);
      });
    } else {
      diskUpload.single(fieldName)(req, res, (err) => {
        handleMulterError(err, req, res, next, fieldName);
      });
    }
  };
};

/**
 * Multiple file upload with disk storage
 * @param {string} fieldName - The field name in the form
 * @param {number} maxCount - Maximum number of files
 * @param {string} subDir - Optional subdirectory within uploads
 * @returns {Function} Express middleware
 */
export const uploadMultiple = (fieldName = 'files', maxCount = 5, subDir = null) => {
  return (req, res, next) => {
    if (subDir) {
      const destinationPath = path.join(uploadDir, subDir);
      if (!fs.existsSync(destinationPath)) {
        fs.mkdirSync(destinationPath, { recursive: true });
      }
      const customStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, destinationPath),
        filename: diskStorage.filename
      });
      const customUpload = multer({
        storage: customStorage,
        limits: {
          fileSize: 50 * 1024 * 1024,
          files: maxCount
        },
        fileFilter: fileFilter
      });
      
      customUpload.array(fieldName, maxCount)(req, res, (err) => {
        handleMulterError(err, req, res, next, fieldName);
      });
    } else {
      diskUpload.array(fieldName, maxCount)(req, res, (err) => {
        handleMulterError(err, req, res, next, fieldName);
      });
    }
  };
};

/**
 * Upload fields with disk storage
 * @param {Array} fields - Array of field configurations [{ name: 'fieldName', maxCount: 1 }]
 * @param {string} subDir - Optional subdirectory within uploads
 * @returns {Function} Express middleware
 */
export const uploadFields = (fields = [], subDir = null) => {
  return (req, res, next) => {
    if (subDir) {
      const destinationPath = path.join(uploadDir, subDir);
      if (!fs.existsSync(destinationPath)) {
        fs.mkdirSync(destinationPath, { recursive: true });
      }
      const customStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, destinationPath),
        filename: diskStorage.filename
      });
      const customUpload = multer({
        storage: customStorage,
        limits: {
          fileSize: 50 * 1024 * 1024
        },
        fileFilter: fileFilter
      });
      
      customUpload.fields(fields)(req, res, (err) => {
        handleMulterError(err, req, res, next);
      });
    } else {
      diskUpload.fields(fields)(req, res, (err) => {
        handleMulterError(err, req, res, next);
      });
    }
  };
};

// ============================================
// EXPORT: Memory Storage Upload Middlewares
// ============================================

/**
 * Single file upload with memory storage (useful for buffer operations)
 * @param {string} fieldName - The field name in the form
 * @returns {Function} Express middleware
 */
export const uploadSingleMemory = (fieldName = 'file') => {
  return (req, res, next) => {
    memoryUpload.single(fieldName)(req, res, (err) => {
      handleMulterError(err, req, res, next, fieldName);
    });
  };
};

/**
 * Multiple file upload with memory storage
 * @param {string} fieldName - The field name in the form
 * @param {number} maxCount - Maximum number of files
 * @returns {Function} Express middleware
 */
export const uploadMultipleMemory = (fieldName = 'files', maxCount = 5) => {
  return (req, res, next) => {
    memoryUpload.array(fieldName, maxCount)(req, res, (err) => {
      handleMulterError(err, req, res, next, fieldName);
    });
  };
};

/**
 * Upload fields with memory storage
 * @param {Array} fields - Array of field configurations
 * @returns {Function} Express middleware
 */
export const uploadFieldsMemory = (fields = []) => {
  return (req, res, next) => {
    memoryUpload.fields(fields)(req, res, (err) => {
      handleMulterError(err, req, res, next);
    });
  };
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Handle multer errors consistently
 * @param {Error} err - The error from multer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @param {string} fieldName - The field name for error messages
 */
const handleMulterError = (err, req, res, next, fieldName = 'file') => {
  if (err) {
    if (err instanceof multer.MulterError) {
      // Multer-specific errors
      switch (err.code) {
        case 'FILE_TOO_LARGE':
          return res.status(413).json({
            success: false,
            message: `File too large. Maximum size is ${diskUpload.limits.fileSize / 1024 / 1024}MB`
          });
        case 'LIMIT_FILE_COUNT':
          return res.status(400).json({
            success: false,
            message: 'Too many files uploaded'
          });
        case 'LIMIT_UNEXPECTED_FILE':
          return res.status(400).json({
            success: false,
            message: `Unexpected field. Expected field name: '${fieldName}'`
          });
        case 'LIMIT_FILE_SIZE':
          return res.status(413).json({
            success: false,
            message: 'File size exceeds the limit'
          });
        default:
          return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
          });
      }
    }
    // Non-multer errors
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  // Log file info for debugging (optional)
  if (req.file) {
    console.log('File uploaded:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path || 'memory'
    });
  }
  
  if (req.files && req.files.length > 0) {
    console.log('Files uploaded:', req.files.map(f => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      path: f.path || 'memory'
    })));
  }
  
  next();
};

/**
 * Validate file type
 * @param {Object} file - The file object from multer
 * @param {Array} allowedTypes - Array of allowed MIME types
 * @returns {boolean} - True if file type is allowed
 */
export const isValidFileType = (file, allowedTypes = []) => {
  if (!file) return false;
  if (allowedTypes.length === 0) return true;
  return allowedTypes.includes(file.mimetype);
};

/**
 * Get file extension
 * @param {Object} file - The file object from multer
 * @returns {string} - File extension without the dot
 */
export const getFileExtension = (file) => {
  if (!file) return '';
  const ext = path.extname(file.originalname);
  return ext ? ext.substring(1).toLowerCase() : '';
};

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted file size (e.g., "1.5 MB")
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get the full path for a file URL
 * @param {string} fileUrl - The URL path (e.g., /uploads/file.pdf)
 * @returns {string} - Full file system path
 */
export const getFilePath = (fileUrl) => {
  const relativePath = fileUrl.replace(/^\/uploads\//, '');
  return path.join(uploadDir, relativePath);
};

/**
 * Check if a file exists
 * @param {string} fileUrl - The URL path (e.g., /uploads/file.pdf)
 * @returns {boolean} - True if file exists
 */
export const fileExists = (fileUrl) => {
  try {
    const fullPath = getFilePath(fileUrl);
    return fs.existsSync(fullPath);
  } catch (error) {
    console.error('fileExists error:', error);
    return false;
  }
};

/**
 * Delete a file from storage
 * @param {string} fileUrl - The URL path (e.g., /uploads/file.pdf)
 * @returns {Promise<boolean>} - True if deleted successfully
 */
export const deleteFile = async (fileUrl) => {
  try {
    const fullPath = getFilePath(fileUrl);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('deleteFile error:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

/**
 * Generate a unique filename
 * @param {string} prefix - Prefix for the filename
 * @param {string} extension - File extension (without dot)
 * @returns {string} - Generated filename
 */
export const generateFileName = (prefix = 'file', extension = 'pdf') => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
};

/**
 * Get file info for response
 * @param {Object} file - The file object from multer
 * @param {string} baseUrl - Base URL for the file
 * @returns {Object} - Formatted file info
 */
export const getFileInfo = (file, baseUrl = '') => {
  if (!file) return null;
  
  const fileInfo = {
    originalName: file.originalname,
    fileName: file.filename || file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    sizeFormatted: formatFileSize(file.size),
    extension: getFileExtension(file)
  };
  
  if (file.path) {
    // Disk storage
    const relativePath = path.relative(uploadDir, file.path);
    fileInfo.path = file.path;
    fileInfo.url = `${baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;
  } else if (file.buffer) {
    // Memory storage
    fileInfo.buffer = file.buffer;
  }
  
  return fileInfo;
};