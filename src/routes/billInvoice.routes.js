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
import { filterByAccessibleProperties } from '../middleware/propertyAccessMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// ======================================================
// BILL INVOICE ROUTES (ALLOWING USER ROLE WITH PERMISSION CHECKS)
// ======================================================

// Generate bill invoice - Allow USER with CREATE_BILL_INVOICE permission
// (Controller will check granular permissions)
router.post('/generate', authorize('ADMIN', 'MANAGER', 'USER'), generateBillInvoice);

// Get all bill invoices with filtering
// ADMIN and MANAGER can view all
// USER will be filtered by accessible properties in controller
router.get('/', authorize('ADMIN', 'MANAGER', 'USER'), getAllBillInvoices);

// Get bill invoices by tenant
// Controller will check VIEW_BILL_INVOICES permission for the tenant's property
router.get('/tenant/:tenantId', authorize('ADMIN', 'MANAGER', 'USER'), getBillInvoicesByTenant);

// Get single bill invoice by ID
// Controller will check VIEW_BILL_INVOICES permission
router.get('/:id', authorize('ADMIN', 'MANAGER', 'USER'), getBillInvoiceById);

// Update payment - Allow USER with EDIT_BILL_INVOICE_PAYMENT permission
// (Controller will check granular permissions)
router.patch('/:id/payment', authorize('ADMIN', 'MANAGER', 'USER'), updateBillInvoicePayment);

// Record payment - Allow USER with EDIT_BILL_INVOICE_PAYMENT permission
// (Controller will check granular permissions)
router.post('/:id/record-payment', authorize('ADMIN', 'MANAGER', 'USER'), recordBillInvoicePayment);

// Download PDF - Allow USER with DOWNLOAD_BILL_INVOICE permission
// (Controller will check granular permissions)
router.get('/:id/download', authorize('ADMIN', 'MANAGER', 'USER'), downloadBillInvoice);

// Delete bill invoice - Allow USER with DELETE_BILL_INVOICE permission
// (Controller will check granular permissions)
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'USER'), deleteBillInvoice);

// Delete bill invoice PDF - Allow USER with DELETE_BILL_INVOICE permission
// (Controller will check granular permissions)
router.delete('/:id/pdf', authorize('ADMIN', 'MANAGER', 'USER'), deleteBillInvoicePDF);

export default router;