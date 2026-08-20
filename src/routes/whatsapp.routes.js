// src/routes/whatsapp.routes.js
// ES Modules version

import { Router } from 'express';
import {
  sendDocument,
  bulkSendDocuments,
  sendAllPaymentReports,
  downloadAllPaymentReports,
  getSendStatus,
  getLogs,
  getLogDetails,
  webhookHandler,
  updateLogStatus,
  downloadComprehensiveReport,
  sendComprehensiveReport,
  downloadBillReport,
  sendBillReport,
  resendDocument
} from '../controllers/whatsapp.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = Router();

// ============================================
// PUBLIC ROUTES — must be registered BEFORE `protect`
// Meta's webhook has no auth token, so these must
// stay outside the authenticated section below.
// ============================================
router.post('/webhook', webhookHandler);
router.get('/webhook', webhookHandler);

// ============================================
// Everything below this line requires authentication
// ============================================
router.use(protect);

// Send single document via WhatsApp
// Only accessible to MANAGER and ADMIN
router.post(
  '/send-document',
  authorize('MANAGER', 'ADMIN'),
  sendDocument
);

// Send documents in bulk
// Only accessible to ADMIN
router.post(
  '/bulk-send',
  authorize('ADMIN'),
  bulkSendDocuments
);
//send bill report
router.post('/send-bill-report/:tenantId', authorize('MANAGER', 'ADMIN'), sendBillReport);

//send comprehensive report
router.post('/send-comprehensive-report/:tenantId', authorize('MANAGER', 'ADMIN'), sendComprehensiveReport);


//send all payment reports via whatsapp
router.post(
  '/send-payment-reports/:tenantId',
  authorize('MANAGER', 'ADMIN'),
  sendAllPaymentReports
);
// Get document send status for a tenant
// Accessible to MANAGER, ADMIN, and users with property access
router.get(
  '/status/:tenantId',
  authorize('MANAGER', 'ADMIN'),
  getSendStatus
);
//download allpaayment reports
router.get(
  '/payment-reports/:tenantId/download',
  authorize('MANAGER', 'ADMIN'),
  downloadAllPaymentReports
);

router.get('/bill-report/:tenantId/download', authorize('MANAGER', 'ADMIN'), downloadBillReport);


router.get('/comprehensive-report/:tenantId/download', authorize('MANAGER', 'ADMIN'), downloadComprehensiveReport);

// Get communication logs
// Only accessible to ADMIN and MANAGER
router.get(
  '/logs',
  authorize('ADMIN', 'MANAGER'),
  getLogs
);

// Get single log details
// Only accessible to ADMIN and MANAGER
router.get(
  '/logs/:id',
  authorize('ADMIN', 'MANAGER'),
  getLogDetails
);

// Update log status
// Only accessible to ADMIN
router.patch(
  '/logs/:id/status',
  authorize('ADMIN'),
  updateLogStatus
);

// Resend a document
// Only accessible to MANAGER and ADMIN
router.post(
  '/resend/:logId',
  authorize('MANAGER', 'ADMIN'),
  resendDocument
);

export default router;