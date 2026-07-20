import express from 'express';
import {
  getServiceProviders,
  getServiceProvidersByProperty,
  getServiceProvider,
  createServiceProvider,
  updateServiceProvider,
  deleteServiceProvider,
  // Attachment controllers
  getAttachments,
  uploadAttachment,
  updateAttachment,
  deleteAttachment,
  getAttachment,
  getAttachmentsByCategory,
  previewAttachment,      // NEW
  downloadAttachment,     // NEW
  getAttachmentUrl        // NEW
} from '../controllers/serviceProvider.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { uploadSingle } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// =============================================
// SERVICE PROVIDER ROUTES
// =============================================

// GET routes - Allow ADMIN, MANAGER, and USER (USER filtered by permissions in controller)
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getServiceProviders)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createServiceProvider);

// Get service providers by property - Allow ADMIN, MANAGER, and USER
router.get('/property/:propertyId', authorize('ADMIN', 'MANAGER', 'USER'), getServiceProvidersByProperty);

// Individual service provider routes
router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getServiceProvider)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateServiceProvider)
  .delete(authorize('ADMIN', 'MANAGER'), deleteServiceProvider);

// =============================================
// SERVICE PROVIDER ATTACHMENT ROUTES
// =============================================

// Get all attachments for a service provider
router.get('/:id/attachments', authorize('ADMIN', 'MANAGER', 'USER'), getAttachments);

// Get attachments by category
router.get('/:id/attachments/category/:category', authorize('ADMIN', 'MANAGER', 'USER'), getAttachmentsByCategory);

// Upload attachment for a service provider
router.post(
  '/:id/attachments',
  authorize('ADMIN', 'MANAGER', 'USER'),
  uploadSingle('file'),
  uploadAttachment
);

// =============================================
// ATTACHMENT PREVIEW & DOWNLOAD ROUTES
// =============================================

// Preview attachment (inline display)
router.get('/attachments/:attachmentId/preview', authorize('ADMIN', 'MANAGER', 'USER'), previewAttachment);

// Download attachment
router.get('/attachments/:attachmentId/download', authorize('ADMIN', 'MANAGER', 'USER'), downloadAttachment);

// Get attachment URL (returns JSON with download/preview URLs)
router.get('/attachments/:attachmentId/url', authorize('ADMIN', 'MANAGER', 'USER'), getAttachmentUrl);

// Individual attachment routes
router.route('/attachments/:attachmentId')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getAttachment)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateAttachment)
  .delete(authorize('ADMIN', 'MANAGER', 'USER'), deleteAttachment);

export default router;