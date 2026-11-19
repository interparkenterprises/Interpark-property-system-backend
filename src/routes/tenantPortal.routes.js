import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { requireTenantScope } from '../middleware/portalScopeMiddleware.js';
import {
  getProfile,
  getStatement,
  getPayments,
  getInvoices,
  getBills,
  getDemandLetters,
  getAttachments,
  previewAttachment,
  downloadAttachment,
} from '../controllers/tenantPortal.controller.js';

const router = express.Router();

// Every tenant-portal request must be:
//   1. authenticated (protect)
//   2. role TENANT (authorize)
//   3. linked to a tenant profile + have scope attached
//      (requireTenantScope)
router.use(protect, authorize('TENANT'), requireTenantScope);

// ======================================================
// TENANT PORTAL ROUTES
// ======================================================

router.get('/profile', getProfile);
router.get('/statement', getStatement);

router.get('/payments', getPayments);
router.get('/invoices', getInvoices);
router.get('/bills', getBills);
router.get('/demand-letters', getDemandLetters);

router.get('/attachments', getAttachments);
router.get('/attachments/:attachmentId/preview', previewAttachment);
router.get('/attachments/:attachmentId/download', downloadAttachment);

export default router;