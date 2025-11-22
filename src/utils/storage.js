import fs from 'fs/promises';
import path from 'path';

// Simple file system storage - Replace with S3/Cloud Storage in production
export async function uploadToStorage(buffer, fileName) {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'invoices');
    
    // Ensure directory exists
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const filePath = path.join(uploadsDir, fileName);
    await fs.writeFile(filePath, buffer);
    
    // Return URL path (adjust based on your server setup)
    return `/uploads/invoices/${fileName}`;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload file');
  }
}
