import express from 'express';
import {
  generateInvoice,
  getInvoicesByTenant,
  getAllInvoices,  //  - Added from updated controller
  getInvoiceById,
  updateInvoiceStatus,
  downloadInvoice,
  generateInvoiceFromPartialPayment,
  getPartialPayments,
  updateInvoicePaymentPolicy  // - Added from updated controller
} from '../controllers/invoice.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes that need authentication
router.use(protect);

// Routes that require specific roles
router.post('/generate', authorize('ADMIN', 'MANAGER'), generateInvoice);
router.post('/generate-from-partial', authorize('ADMIN', 'MANAGER'), generateInvoiceFromPartialPayment);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), updateInvoiceStatus);
router.patch('/:id/payment-policy', authorize('ADMIN', 'MANAGER'), updateInvoicePaymentPolicy); // NEW

// Routes that are accessible to authenticated users (no specific role required)
router.get('/', getAllInvoices); // NEW - Get all invoices with filters
router.get('/tenant/:tenantId', getInvoicesByTenant);
router.get('/partial-payments', getPartialPayments);
router.get('/:id', getInvoiceById);
router.get('/:id/download', downloadInvoice);

export default router;