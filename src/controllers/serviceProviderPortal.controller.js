import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma.js';
import { uploadDocument, deleteDocument } from '../utils/uploadHelper.js';
import { assertIn } from '../middleware/portalScopeMiddleware.js';

// ======================================================
// HELPERS
// ======================================================

// Same content-type map as the staff provider controller, kept local
// so the portal file is self-contained.
const getContentType = (extension) => {
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.ico': 'image/x-icon',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
    '.xml': 'application/xml', '.json': 'application/json',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
  };
  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
};

// Resolve a stored fileUrl (`/uploads/...` or `uploads/...`) to a
// filesystem path under UPLOAD_DIR. Mirrors the logic in the staff
// provider controller so both portals find the same files.
const resolveUploadPath = (fileUrl) => {
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const relativePath = String(fileUrl || '')
    .replace(/^\/+/, '')          // strip leading slashes
    .replace(/^uploads\//i, '');  // strip the `uploads/` prefix if present
  return path.resolve(uploadDir, relativePath);
};

// ======================================================
// PROFILE
// ======================================================

// @desc    Get own service provider profile + property count
// @route   GET /api/portal/provider/profile
// @access  Private (SERVICE_PROVIDER)
export const getProfile = async (req, res) => {
  try {
    const provider = req.serviceProviderProfile;

    // Safe subset — everything else (propertyId legacy FK, propertyLinks,
    // createdAt/updatedAt full objects) is derived metadata, not needed
    // for a portal view.
    const providerSafe = {
      id: provider.id,
      name: provider.name,
      contact: provider.contact,
      contractPeriod: provider.contractPeriod,
      serviceContract: provider.serviceContract,
      chargeAmount: provider.chargeAmount,
      chargeFrequency: provider.chargeFrequency,
    };

    // Property count = union of join-table rows + legacy single-property FK.
    const propertyCount = req.serviceProviderPropertyIds.length;

    // Attachment count for a quick dashboard stat.
    const attachmentCount = await prisma.serviceProviderAttachment.count({
      where: {
        serviceProviderId: req.serviceProviderProfileId,
        isActive: true,
      }
    });

    res.json({
      success: true,
      data: {
        provider: providerSafe,
        stats: {
          propertyCount,
          attachmentCount,
        }
      }
    });
  } catch (error) {
    console.error('Provider portal getProfile error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// PROPERTIES
// ======================================================

// @desc    List properties the provider serves
// @route   GET /api/portal/provider/properties
// @access  Private (SERVICE_PROVIDER)
//
// The provider's reachable property IDs come from requireServiceProviderScope
// (union of ServiceProviderProperty + legacy propertyId). We re-verify by
// applying that set as a `where` filter — belt and suspenders.
export const getProperties = async (req, res) => {
  try {
    const propertyIds = req.serviceProviderPropertyIds;

    if (!propertyIds || propertyIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const properties = await prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: {
        id: true,
        name: true,
        address: true,
        lrNumber: true,
        form: true,
        usage: true,
        image: true,
        // Explicitly NOT selected: accountName, accountNo, bank, branch,
        // branchCode, commissionFee, managerId, manager, landlord, landlordId.
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      count: properties.length,
      data: properties
    });
  } catch (error) {
    console.error('Provider portal getProperties error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS — list
// ======================================================

// @desc    List own attachments
// @route   GET /api/portal/provider/attachments
// @access  Private (SERVICE_PROVIDER)
export const getAttachments = async (req, res) => {
  try {
    const providerId = req.serviceProviderProfileId;

    const attachments = await prisma.serviceProviderAttachment.findMany({
      where: { serviceProviderId: providerId, isActive: true },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        description: true,
        category: true,
        version: true,
        expiryDate: true,
        uploadedAt: true,
        isActive: true,
        // Do not return uploadedById; do not return fileUrl raw.
      },
      orderBy: { uploadedAt: 'desc' }
    });

    const withLinks = attachments.map(a => ({
      ...a,
      previewUrl: `/api/portal/provider/attachments/${a.id}/preview`,
      downloadUrl: `/api/portal/provider/attachments/${a.id}/download`,
    }));

    res.json({
      success: true,
      count: withLinks.length,
      data: withLinks
    });
  } catch (error) {
    console.error('Provider portal getAttachments error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS — upload
// ======================================================

// @desc    Upload own attachment
// @route   POST /api/portal/provider/attachments
// @access  Private (SERVICE_PROVIDER)
//
// Reuses the SAME disk path convention as the staff provider controller:
//   service-providers/{providerId}/{timestamp-random-ext}
// and the SAME `uploadDocument` storage helper. This keeps files
// co-located so ADMIN/MANAGER can view a provider's uploads through the
// existing staff serviceProvider.routes.js.
export const uploadAttachment = async (req, res) => {
  try {
    const providerId = req.serviceProviderProfileId;
    const userId = req.user.id;
    const { description, category, expiryDate, version } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Confirm the provider row exists (defense in depth — scope
    // middleware already verified it, but this catches the very rare
    // race where the row was deleted between middleware and handler).
    const provider = await prisma.serviceProvider.findUnique({
      where: { id: providerId },
      select: { id: true }
    });
    if (!provider) {
      return res.status(404).json({ message: 'Service provider profile not found' });
    }

    // Read the temp file that multer wrote to disk, then re-upload via
    // uploadDocument to the canonical provider path. Same pipeline as
    // the staff provider controller.
    const fileBuffer = await fs.promises.readFile(req.file.path);

    const fileExtension = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExtension}`;
    const filePath = `service-providers/${providerId}/${fileName}`;

    const { url } = await uploadDocument(fileBuffer, filePath);

    // Clean up multer's temp file. If it fails, log but continue — the
    // canonical upload already succeeded.
    try {
      await fs.promises.unlink(req.file.path);
    } catch (unlinkErr) {
      console.warn('Failed to delete temporary file:', unlinkErr);
    }

    const attachment = await prisma.serviceProviderAttachment.create({
      data: {
        serviceProviderId: providerId,
        fileName: req.file.originalname,
        fileUrl: url,
        fileType: (fileExtension.substring(1).toUpperCase() || 'UNKNOWN'),
        fileSize: req.file.size,
        description: description || null,
        category: category || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        version: version || null,
        uploadedById: userId,
        isActive: true,
      },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        description: true,
        category: true,
        version: true,
        expiryDate: true,
        uploadedAt: true,
        isActive: true,
      }
    });

    res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: {
        ...attachment,
        previewUrl: `/api/portal/provider/attachments/${attachment.id}/preview`,
        downloadUrl: `/api/portal/provider/attachments/${attachment.id}/download`,
      }
    });
  } catch (error) {
    console.error('Provider portal uploadAttachment error:', error);
    // Best-effort cleanup if multer wrote a temp file and we failed
    // after reading it (e.g., uploadDocument threw).
    try {
      if (req.file?.path) await fs.promises.unlink(req.file.path);
    } catch (_) { /* ignore */ }
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS — update metadata
// ======================================================

// @desc    Update own attachment metadata
// @route   PATCH /api/portal/provider/attachments/:attachmentId
// @access  Private (SERVICE_PROVIDER)
export const updateAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const providerId = req.serviceProviderProfileId;
    const { description, category, expiryDate, version } = req.body;

    // Anti-IDOR: single query scoped by both id and providerId.
    const existing = await prisma.serviceProviderAttachment.findFirst({
      where: { id: attachmentId, serviceProviderId: providerId, isActive: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const updated = await prisma.serviceProviderAttachment.update({
      where: { id: attachmentId },
      data: {
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        expiryDate: expiryDate !== undefined
          ? (expiryDate ? new Date(expiryDate) : null)
          : existing.expiryDate,
        version: version !== undefined ? version : existing.version,
      },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        description: true,
        category: true,
        version: true,
        expiryDate: true,
        uploadedAt: true,
        isActive: true,
      }
    });

    res.json({
      success: true,
      message: 'Attachment updated successfully',
      data: {
        ...updated,
        previewUrl: `/api/portal/provider/attachments/${updated.id}/preview`,
        downloadUrl: `/api/portal/provider/attachments/${updated.id}/download`,
      }
    });
  } catch (error) {
    console.error('Provider portal updateAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS — delete
// ======================================================

// @desc    Delete own attachment (soft-delete row + hard-delete file)
// @route   DELETE /api/portal/provider/attachments/:attachmentId
// @access  Private (SERVICE_PROVIDER)
//
// We soft-delete the row (isActive = false) so staff still see an
// audit trail if needed, but we hard-delete the file from disk to
// avoid orphan storage. Matches the staff provider controller's
// physical-file deletion behavior.
export const deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const providerId = req.serviceProviderProfileId;

    const existing = await prisma.serviceProviderAttachment.findFirst({
      where: { id: attachmentId, serviceProviderId: providerId, isActive: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Best-effort: delete the physical file. If it's already gone,
    // don't fail the request — the DB state is what matters.
    try {
      const fullPath = resolveUploadPath(existing.fileUrl);
      if (fs.existsSync(fullPath)) {
        await deleteDocument(existing.fileUrl.replace(/^\/+/, ''));
      }
    } catch (fileErr) {
      console.warn('Failed to delete attachment file:', fileErr);
    }

    // Soft-delete the row.
    await prisma.serviceProviderAttachment.update({
      where: { id: attachmentId },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Provider portal deleteAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ATTACHMENTS — preview / download
// ======================================================

// @desc    Preview own attachment inline
// @route   GET /api/portal/provider/attachments/:attachmentId/preview
// @access  Private (SERVICE_PROVIDER)
export const previewAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const providerId = req.serviceProviderProfileId;

    const attachment = await prisma.serviceProviderAttachment.findFirst({
      where: { id: attachmentId, serviceProviderId: providerId, isActive: true },
    });
    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const fullPath = resolveUploadPath(attachment.fileUrl);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    const stats = await fs.promises.stat(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = getContentType(ext);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');

    const stream = createReadStream(fullPath);
    stream.on('error', (err) => {
      console.error('Preview stream error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Provider portal previewAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Download own attachment
// @route   GET /api/portal/provider/attachments/:attachmentId/download
// @access  Private (SERVICE_PROVIDER)
export const downloadAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const providerId = req.serviceProviderProfileId;

    const attachment = await prisma.serviceProviderAttachment.findFirst({
      where: { id: attachmentId, serviceProviderId: providerId, isActive: true },
    });
    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const fullPath = resolveUploadPath(attachment.fileUrl);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.download(fullPath, attachment.fileName);
  } catch (error) {
    console.error('Provider portal downloadAttachment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// Suppress unused import warning for assertIn — kept here so future
// endpoints (e.g., when ServiceJob lands) can use it without touching
// the import block again.
void assertIn;