import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage - KEEPING DISK STORAGE
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
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
    'application/x-rar-compressed'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not supported. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

// Configure multer with limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1 // Only one file at a time
  },
  fileFilter: fileFilter
});

// Export the configured multer instance
export default upload;

// Export single file upload middleware with error handling
export const uploadSingle = (fieldName = 'file') => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          // Multer-specific errors
          if (err.code === 'FILE_TOO_LARGE') {
            return res.status(413).json({
              success: false,
              message: `File too large. Maximum size is ${upload.limits.fileSize / 1024 / 1024}MB`
            });
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
              success: false,
              message: 'Only one file can be uploaded at a time'
            });
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
              success: false,
              message: `Unexpected field. Expected field name: '${fieldName}'`
            });
          }
          return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
          });
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
          path: req.file.path
        });
      }
      
      next();
    });
  };
};

// Middleware for multiple files (optional)
export const uploadMultiple = (fieldName = 'files', maxCount = 5) => {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'FILE_TOO_LARGE') {
            return res.status(413).json({
              success: false,
              message: `File too large. Maximum size is ${upload.limits.fileSize / 1024 / 1024}MB`
            });
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
              success: false,
              message: `Maximum ${maxCount} files allowed`
            });
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
              success: false,
              message: `Unexpected field. Expected field name: '${fieldName}'`
            });
          }
          return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      
      // Log files info for debugging (optional)
      if (req.files && req.files.length > 0) {
        console.log('Files uploaded:', req.files.map(f => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path
        })));
      }
      
      next();
    });
  };
};

/**
 * Middleware for handling file uploads with specific field names
 * Useful when you have multiple file fields with different names
 * @param {Array} fields - Array of field configurations [{ name: 'fieldName', maxCount: 1 }]
 * @returns {Function} Express middleware
 */
export const uploadFields = (fields = []) => {
  return (req, res, next) => {
    upload.fields(fields)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'FILE_TOO_LARGE') {
            return res.status(413).json({
              success: false,
              message: `File too large. Maximum size is ${upload.limits.fileSize / 1024 / 1024}MB`
            });
          }
          return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      next();
    });
  };
};

/**
 * Helper function to validate file type
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
 * Helper function to get file extension
 * @param {Object} file - The file object from multer
 * @returns {string} - File extension without the dot
 */
export const getFileExtension = (file) => {
  if (!file) return '';
  const ext = path.extname(file.originalname);
  return ext ? ext.substring(1).toLowerCase() : '';
};

/**
 * Helper function to format file size
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