import express from 'express';
import {
  // Main tenant operations
  getTenants,
  getTenant,
  getOverdueTenants,
  getNextPaymentsByProperty,
  getTenantsByProperty,
  createTenant,
  updateTenant,
  deleteTenant,
  restoreTenant,
  getLeftTenants,
  getTenantStats,
  
  // Service charge operations
  updateServiceCharge,
  removeServiceCharge,
  
  // Financial operations
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

// Get all tenants (with optional includeLeft query param)
// Create a new tenant
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenants)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createTenant);

// =============================================
// TENANT STATISTICS
// =============================================

// Get tenant statistics by status
router.route('/stats')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantStats);

// =============================================
// LEFT TENANTS (Departed tenants)
// =============================================

// Get all tenants who have left (departed tenants)
router.route('/left')
  .get(authorize('ADMIN', 'MANAGER'), getLeftTenants);

// =============================================
// OVERDUE TENANTS
// =============================================

// Get all tenants with overdue payments
// Query params: propertyId, daysOverdue, customDays
router.route('/overdue')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getOverdueTenants);

// =============================================
// TENANTS BY PROPERTY
// =============================================

// Get tenants by property ID (active tenants only by default)
// Query param: includeLeft=true to include LEFT tenants
router.route('/property/:propertyId')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantsByProperty);

// Get tenants with their next upcoming payment due date
router.route('/property/:propertyId/next-payments')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getNextPaymentsByProperty);

// =============================================
// SINGLE TENANT ROUTES
// =============================================

// Get, update, or delete a specific tenant
router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenant)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateTenant)
  .delete(authorize('ADMIN', 'MANAGER', 'USER'), deleteTenant);

// =============================================
// RESTORE TENANT (Admin only)
// =============================================

// Restore a tenant (reactivate) - Admin only
router.route('/:id/restore')
  .patch(authorize('ADMIN'), restoreTenant);

// =============================================
// TENANT FINANCIALS
// =============================================

// Get tenant financials (requires VIEW_TENANT_FINANCIALS permission)
router.route('/:id/financials')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantFinancials);

// =============================================
// TENANT SERVICE CHARGE ROUTES
// =============================================

// Update or remove tenant service charge
router.route('/:id/service-charge')
  .patch(authorize('ADMIN', 'MANAGER', 'USER'), updateServiceCharge)
  .delete(authorize('ADMIN', 'MANAGER', 'USER'), removeServiceCharge);

// =============================================
// TENANT ATTACHMENT ROUTES
// =============================================

// Get all attachments for a tenant
// Upload a new attachment for a tenant (Managers and Admins only)
router.route('/:tenantId/attachments')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getAttachments)
  .post(authorize('ADMIN', 'MANAGER'), upload.single('file'), uploadAttachment);

// Preview an attachment (view in browser)
router.route('/attachments/:attachmentId/preview')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), previewAttachment);

// Download an attachment
router.route('/attachments/:attachmentId/download')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), downloadAttachment);

// Update an attachment (rename) - Admin only
// Delete an attachment - Admin only
router.route('/attachments/:attachmentId')
  .put(authorize('ADMIN'), updateAttachment)
  .delete(authorize('ADMIN'), deleteAttachment);

export default router;