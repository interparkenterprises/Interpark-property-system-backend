import express from 'express';
import {
  generateBillInvoice,
  getAllBillInvoices,
  getBillInvoicesByTenant,
  getBillInvoiceById,
  updateBillInvoicePayment,
  downloadBillInvoice,
  deleteBillInvoice,
  recordBillInvoicePayment,
  deleteBillInvoicePDF
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


// Get bill invoices by tenant - ADMIN and MANAGER can view all, you might want to add tenant-specific restrictions
router.get('/tenant/:tenantId', authorize('ADMIN', 'MANAGER'), getBillInvoicesByTenant);

// Get single bill invoice - ADMIN and MANAGER can view all
router.get('/:id', authorize('ADMIN', 'MANAGER'), getBillInvoiceById);

// Update payment - Only ADMIN and MANAGER can process payments
router.patch('/:id/payment', authorize('ADMIN', 'MANAGER'), updateBillInvoicePayment);

// Record payment - Only ADMIN and MANAGER can process payments
router.post('/:id/record-payment', authorize('ADMIN', 'MANAGER'), recordBillInvoicePayment);

// Download PDF - ADMIN and MANAGER can download
router.get('/:id/download', authorize('ADMIN', 'MANAGER'), downloadBillInvoice);

// Delete bill invoice - Only ADMIN and MANAGER can delete
router.delete('/:id', authorize('ADMIN', 'MANAGER'), deleteBillInvoice);

// delete bill invoice pdf
router.delete('/:id/pdf', authorize('ADMIN', 'MANAGER'), deleteBillInvoicePDF);

export default router;