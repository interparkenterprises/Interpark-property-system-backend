import express from 'express';
import {
  getTenants,
  getTenant,
  getOverdueTenants,
  getNextPaymentsByProperty,
  getTenantsByProperty,
  createTenant,
  updateTenant,
  deleteTenant,
  updateServiceCharge,
  removeServiceCharge,
  getTenantFinancials,
  // Attachment controllers
  getAttachments,
  uploadAttachment,
  previewAttachment,
  updateAttachment,
  deleteAttachment,
  downloadAttachment
} from '../controllers/tenant.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// =============================================
// MAIN TENANT ROUTES
// =============================================

router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenants)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createTenant);

router.route('/property/:propertyId')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantsByProperty);
  
router.route('/property/:propertyId/next-payments')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getNextPaymentsByProperty);

router.route('/overdue')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getOverdueTenants);

// =============================================
// SINGLE TENANT ROUTES
// =============================================

router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenant)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateTenant)
  .delete(authorize('ADMIN', 'MANAGER'), deleteTenant);

// =============================================
// TENANT FINANCIALS
// =============================================

router.route('/:id/financials')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantFinancials);

// =============================================
// TENANT SERVICE CHARGE ROUTES
// =============================================

router.route('/:id/service-charge')
  .patch(authorize('ADMIN', 'MANAGER', 'USER'), updateServiceCharge)
  .delete(authorize('ADMIN', 'MANAGER'), removeServiceCharge);

// =============================================
// TENANT ATTACHMENT ROUTES
// =============================================

// Get all attachments for a tenant
router.route('/:tenantId/attachments')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getAttachments)
  .post(authorize('ADMIN', 'MANAGER'), upload.single('file'), uploadAttachment);

// Preview an attachment (view in browser)
router.route('/attachments/:attachmentId/preview')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), previewAttachment);

// Download an attachment
router.route('/attachments/:attachmentId/download')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), downloadAttachment);

// Update/Delete an attachment (Admin only)
router.route('/attachments/:attachmentId')
  .put(authorize('ADMIN'), updateAttachment)
  .delete(authorize('ADMIN'), deleteAttachment);

export default router;