import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

/**
 * Upload document to storage
 * This is a simple file system implementation
 * Replace with AWS S3, Google Cloud Storage, or other cloud storage in production
 */
export const uploadDocument = async (buffer, filePath) => {
  try {
    // Define upload directory (adjust based on your setup)
    const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    const fullPath = join(uploadDir, filePath);
    
    // Create directory if it doesn't exist
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Write file
    await writeFile(fullPath, buffer);

    // Return URL (adjust based on your server configuration)
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const documentUrl = `${baseUrl}/uploads/${filePath}`;

    return documentUrl;
  } catch (error) {
    console.error('Upload error:', error);
    throw new Error(`Failed to upload document: ${error.message}`);
  }
};

/**
 * Alternative: Upload to AWS S3
 * Uncomment and configure if using AWS S3
 */
/*
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
      ContentType: 'application/pdf',
      ACL: 'public-read'
    });

    await s3Client.send(command);

    const documentUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
    return documentUrl;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload to S3: ${error.message}`);
  }
};
*/
