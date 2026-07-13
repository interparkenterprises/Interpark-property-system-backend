import { writeFile, mkdir, unlink } from 'fs/promises';
import { join, dirname, normalize } from 'path';
import { existsSync } from 'fs';

/**
 * Upload document to storage
 * This is a simple file system implementation
 */
export const uploadDocument = async (buffer, filePath) => {
  try {
    const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    const fullPath = join(uploadDir, filePath);
    
    // Create directory if it doesn't exist
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Write file
    await writeFile(fullPath, buffer);

    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const documentUrl = `${baseUrl}/uploads/${filePath}`;

    return { url: documentUrl, fullPath };
  } catch (error) {
    console.error('Upload error:', error);
    throw new Error(`Failed to upload document: ${error.message}`);
  }
};

/**
 * Delete a file from storage
 */
export const deleteDocument = async (filePath) => {
  try {
    const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    // Normalize the path and handle both forward and backward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');
    const fullPath = join(uploadDir, normalizedPath);
    
    if (existsSync(fullPath)) {
      await unlink(fullPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Delete error:', error);
    throw new Error(`Failed to delete document: ${error.message}`);
  }
};

/**
 * Check if file exists
 */
export const fileExists = (filePath) => {
  try {
    const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    // Normalize the path and handle both forward and backward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');
    const fullPath = join(uploadDir, normalizedPath);
    return existsSync(fullPath);
  } catch (error) {
    console.error('fileExists error:', error);
    return false;
  }
};

/**
 * Get file path
 */
export const getFilePath = (filePath) => {
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  // Normalize the path and handle both forward and backward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  return join(uploadDir, normalizedPath);
};
/**
 * Alternative: Upload to AWS S3
 * Uncomment and configure if using AWS S3
 */
/*
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

export const uploadDocument = async (buffer, filePath) => {
  try {
    const bucketName = process.env.AWS_S3_BUCKET;
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: filePath,
      Body: buffer,
      ACL: 'public-read'
    });

    await s3Client.send(command);

    const documentUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
    return { url: documentUrl, fullPath: filePath };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload to S3: ${error.message}`);
  }
};

export const deleteDocument = async (filePath) => {
  try {
    const bucketName = process.env.AWS_S3_BUCKET;
    
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: filePath
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('S3 delete error:', error);
    throw new Error(`Failed to delete from S3: ${error.message}`);
  }
};
*/