import express from 'express';
import {
  generateInvoice,
  getInvoicesByTenant,
  getAllInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  downloadInvoice,
  generateInvoiceFromPartialPayment,
  getPartialPayments,
  updateInvoicePaymentPolicy,
  deleteInvoice,
  deleteInvoicePDF
} from '../controllers/invoice.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes that need authentication
router.use(protect);

// ======================================================
// INVOICE GENERATION & MANAGEMENT (Requires CREATE_INVOICES permission)
// ======================================================
router.post('/generate', authorize('ADMIN', 'MANAGER', 'USER'), generateInvoice);
router.post('/generate-from-partial', authorize('ADMIN', 'MANAGER', 'USER'), generateInvoiceFromPartialPayment);

// ======================================================
// INVOICE UPDATES (Requires EDIT_INVOICES permission)
// ======================================================
router.patch('/:id/status', authorize('ADMIN', 'MANAGER', 'USER'), updateInvoiceStatus);
router.patch('/:id/payment-policy', authorize('ADMIN', 'MANAGER', 'USER'), updateInvoicePaymentPolicy);

// ======================================================
// INVOICE DELETION (Requires DELETE_INVOICES permission)
// ======================================================
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'USER'), deleteInvoice);
router.delete('/:id/pdf', authorize('ADMIN', 'MANAGER', 'USER'), deleteInvoicePDF);

// ======================================================
// INVOICE VIEWING (Requires VIEW_INVOICES permission)
// ======================================================
router.get('/', authorize('ADMIN', 'MANAGER', 'USER'), getAllInvoices);
router.get('/tenant/:tenantId', authorize('ADMIN', 'MANAGER', 'USER'), getInvoicesByTenant);
router.get('/partial-payments', authorize('ADMIN', 'MANAGER', 'USER'), getPartialPayments);
router.get('/:id', authorize('ADMIN', 'MANAGER', 'USER'), getInvoiceById);
router.get('/:id/download', authorize('ADMIN', 'MANAGER', 'USER'), downloadInvoice);

export default router;