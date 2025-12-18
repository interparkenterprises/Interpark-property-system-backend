import fs from 'fs/promises';
import path from 'path';

// Simple file system storage - Replace with S3/Cloud Storage in production
export async function uploadToStorage(buffer, fileName, type = 'invoices') {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads', type);
    
    // Ensure directory exists
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const filePath = path.join(uploadsDir, fileName);
    await fs.writeFile(filePath, buffer);
    
    // Return URL path (adjust based on your server setup)
    return `/uploads/${type}/${fileName}`;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload file');
  }
}

// Helper to generate unique filename
export function generateFileName(prefix = 'report') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${prefix}_${timestamp}_${random}.pdf`;
}