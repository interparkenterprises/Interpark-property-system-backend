import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { requireServiceProviderScope } from '../middleware/portalScopeMiddleware.js';
import { uploadSingle } from '../middleware/uploadMiddleware.js';
import {
  getProfile,
  getProperties,
  getAttachments,
  uploadAttachment,
  updateAttachment,
  deleteAttachment,
  previewAttachment,
  downloadAttachment,
} from '../controllers/serviceProviderPortal.controller.js';

const router = express.Router();

// Every provider-portal request must be:
//   1. authenticated (protect)
//   2. role SERVICE_PROVIDER (authorize)
//   3. linked to a service-provider profile with scoped property IDs
//      attached (requireServiceProviderScope)
router.use(protect, authorize('SERVICE_PROVIDER'), requireServiceProviderScope);

// ======================================================
// PROVIDER PORTAL ROUTES
// ======================================================
// There is no :providerId anywhere — the provider identity comes from
// the authenticated user.

router.get('/profile', getProfile);
router.get('/properties', getProperties);

// Attachments
router.get('/attachments', getAttachments);
router.post('/attachments', uploadSingle('file'), uploadAttachment);
router.get('/attachments/:attachmentId/preview', previewAttachment);
router.get('/attachments/:attachmentId/download', downloadAttachment);
router.patch('/attachments/:attachmentId', updateAttachment);
router.delete('/attachments/:attachmentId', deleteAttachment);

export default router;