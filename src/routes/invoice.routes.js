import express from 'express';
import {
  generateInvoice,
  getInvoicesByTenant,
  getInvoiceById,
  updateInvoiceStatus,
  downloadInvoice
} from '../controllers/invoice.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes that need authentication
router.use(protect);

// Routes that require specific roles
router.post('/generate', authorize('ADMIN', 'MANAGER'), generateInvoice);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), updateInvoiceStatus);

// Routes that are accessible to authenticated users (no specific role required)
router.get('/tenant/:tenantId', getInvoicesByTenant);
router.get('/:id', getInvoiceById);
router.get('/:id/download', downloadInvoice);

export default router;