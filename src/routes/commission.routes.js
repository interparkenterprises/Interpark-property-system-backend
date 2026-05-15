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

// ======================================================
// COMMISSION PERMISSIONS SUMMARY:
// - VIEW_COMMISSIONS: View commissions, stats, and download invoices
// - GENERATE_COMMISSION_INVOICES: Generate commission invoices  
// - PROCESS_COMMISSIONS: Mark commissions as PROCESSING
// - APPROVE_COMMISSIONS: Mark commissions as PAID or update status
// ======================================================

// Get all commissions for a specific manager
// Accessible by: ADMIN, MANAGER (their own), or users with VIEW_COMMISSIONS permission
router.get('/manager/:managerId', getManagerCommissions);

// Get commission statistics for a manager
// Accessible by: ADMIN, MANAGER (their own), or users with VIEW_COMMISSIONS permission
router.get('/manager/:managerId/stats', getCommissionStats);

// Get commissions by property for a manager
// Accessible by: ADMIN, MANAGER (their own), or users with VIEW_COMMISSIONS permission
router.get('/manager/:managerId/property/:propertyId', getCommissionsByProperty);

// Get a specific commission by ID
// Accessible by: ADMIN, MANAGER (their own), or users with VIEW_COMMISSIONS permission
router.get('/:id', getCommissionById);

// Update commission status
// ADMIN only - requires APPROVE_COMMISSIONS permission
router.patch('/:id', authorize('ADMIN'), updateCommissionStatus);

// Mark commission as processing
// Accessible by: ADMIN, MANAGER (their own), or users with PROCESS_COMMISSIONS permission
router.patch('/:id/processing', authorize('ADMIN', 'MANAGER'), markAsProcessing);

// Mark commission as paid
// Accessible by: ADMIN, MANAGER (their own), or users with APPROVE_COMMISSIONS permission
router.patch('/:id/paid', authorize('ADMIN', 'MANAGER'), markAsPaid);

// Generate commission invoice PDF
// Accessible by: ADMIN, MANAGER (their own), or users with GENERATE_COMMISSION_INVOICES permission
router.post('/:id/commission-invoice', authorize('ADMIN', 'MANAGER'), generateCommissionInvoice);

// Download commission invoice PDF
// Accessible by: ADMIN, MANAGER (their own), or users with VIEW_COMMISSIONS or GENERATE_COMMISSION_INVOICES permission
router.get('/:id/commission-invoice/download', authorize('ADMIN', 'MANAGER'), downloadCommissionInvoice);

export default router;