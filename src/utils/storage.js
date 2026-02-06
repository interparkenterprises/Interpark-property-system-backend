import fs from 'fs/promises';
import path from 'path';

/**
 * Upload file to storage with automatic directory creation
 * @param {Buffer} buffer - File buffer
 * @param {string} fileName - Filename (can include subdirectories like 'receipts/file.pdf')
 * @param {string} type - Base directory type ('invoices', 'receipts', etc.)
 * @returns {string} URL path to the file
 */
export async function uploadToStorage(buffer, fileName, type = 'invoices') {
  try {
    // Handle subdirectories in filename (e.g., "receipts/RCP-123.pdf")
    const uploadsDir = path.join(process.cwd(), 'uploads', type);
    const filePath = path.join(uploadsDir, fileName);
    
    // Ensure full directory path exists (including subdirectories)
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    
    // Write file
    await fs.writeFile(filePath, buffer);
    
    // Return URL path
    return `/uploads/${type}/${fileName}`;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

// Helper to generate unique filename
export function generateFileName(prefix = 'report') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${prefix}_${timestamp}_${random}.pdf`;
}