import express from 'express';
import {
  generateBillInvoice,
  getAllBillInvoices,
  getBillInvoicesByTenant,
  getBillInvoicesByPaymentPolicy,  // NEW - Added from updated controller
  getBillInvoiceById,
  updateBillInvoicePayment,
  updateBillInvoicePaymentPolicy,  // NEW - Added from updated controller
  downloadBillInvoice,
  deleteBillInvoice,
  recordBillInvoicePayment,
  getBillInvoiceStatsByPaymentPolicy  // NEW - Added from updated controller
} from '../controllers/billinvoice.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// Generate bill invoice - Only ADMIN and MANAGER can create
router.post('/generate', authorize('ADMIN', 'MANAGER'), generateBillInvoice);

// Get all bill invoices with filtering - ADMIN and MANAGER can view all, others might need restrictions
router.get('/', authorize('ADMIN', 'MANAGER'), getAllBillInvoices);

// Get bill invoices by payment policy - NEW
router.get('/payment-policy/:policy', authorize('ADMIN', 'MANAGER'), getBillInvoicesByPaymentPolicy);

// Get bill invoice statistics by payment policy - NEW
router.get('/stats/payment-policy', authorize('ADMIN', 'MANAGER'), getBillInvoiceStatsByPaymentPolicy);

// Get bill invoices by tenant - ADMIN and MANAGER can view all, you might want to add tenant-specific restrictions
router.get('/tenant/:tenantId', authorize('ADMIN', 'MANAGER'), getBillInvoicesByTenant);

// Get single bill invoice - ADMIN and MANAGER can view all
router.get('/:id', authorize('ADMIN', 'MANAGER'), getBillInvoiceById);

// Update payment - Only ADMIN and MANAGER can process payments
router.patch('/:id/payment', authorize('ADMIN', 'MANAGER'), updateBillInvoicePayment);

// Update payment policy - NEW
router.patch('/:id/payment-policy', authorize('ADMIN', 'MANAGER'), updateBillInvoicePaymentPolicy);

// Record payment - Only ADMIN and MANAGER can process payments
router.post('/:id/record-payment', authorize('ADMIN', 'MANAGER'), recordBillInvoicePayment);

// Download PDF - ADMIN and MANAGER can download
router.get('/:id/download', authorize('ADMIN', 'MANAGER'), downloadBillInvoice);

// Delete bill invoice - Only ADMIN and MANAGER can delete
router.delete('/:id', authorize('ADMIN'), deleteBillInvoice);

export default router;