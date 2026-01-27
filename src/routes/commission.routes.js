import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  getManagerCommissions,
  getCommissionStats,
  getCommissionById,
  updateCommissionStatus,
  getCommissionsByProperty,
  markAsProcessing,
  markAsPaid,
  generateCommissionInvoice,
  downloadCommissionInvoice,
} from '../controllers/commission.controller.js';

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// Get all commissions for a specific manager (accessible by manager themselves or admin)
router.get('/manager/:managerId', getManagerCommissions);

// Get commission statistics for a manager (accessible by manager themselves or admin)
router.get('/manager/:managerId/stats', getCommissionStats);

// Get commissions by property for a manager (accessible by manager themselves or admin)
router.get('/manager/:managerId/property/:propertyId', getCommissionsByProperty);

// Get a specific commission by ID (accessible by the commission owner or admin)
router.get('/:id', getCommissionById);

// Update commission status (admin only)
router.patch('/:id', authorize('ADMIN'), updateCommissionStatus);

// Mark commission as processsing
router.patch('/:id/processing', authorize('ADMIN', 'MANAGER'), markAsProcessing);
// Mark commission as paid
router.patch('/:id/paid', authorize('ADMIN', 'MANAGER'), markAsPaid);
// Generate commission invoice PDF
router.post('/:id/commission-invoice', authorize('ADMIN', 'MANAGER'), generateCommissionInvoice);

//Download commission invoice PDF
router.get('/:id/commission-invoice/download', authorize('ADMIN', 'MANAGER'), downloadCommissionInvoice);
export default router;