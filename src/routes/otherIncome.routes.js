import express from 'express';
import {
  getManagerOtherIncomes,
  getOtherIncomeById,
  createOtherIncome,
  updateOtherIncome,
  deleteOtherIncome,
  markOtherIncomeAsPaid,
  downloadOtherIncomeInvoice,
  uploadOtherIncomeAttachment,
  deleteOtherIncomeAttachment,
  getOtherIncomeStats,
  downloadOtherIncomeAttachment,  // Add this
  previewOtherIncomeAttachment   // Add this
} from '../controllers/otherIncome.controller.js';
import { protect, managerProtect, requirePermission } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { uploadSingleMemory } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes require authentication and manager role
router.use(protect);
router.use(managerProtect);

// ============================================
// STATISTICS ROUTES
// ============================================
/**
 * GET /api/other-income/stats/:managerId
 * Get income statistics for a manager
 * Access: Manager/Admin
 */
router.get('/stats/:managerId', getOtherIncomeStats);

// ============================================
// MAIN CRUD OPERATIONS
// ============================================
/**
 * GET /api/other-income/manager/:managerId
 * Get all other incomes for a specific manager
 * Access: Manager/Admin
 * Query params: status, category, startDate, endDate
 */
router.get('/manager/:managerId', getManagerOtherIncomes);

/**
 * GET /api/other-income/:id
 * Get a single other income by ID
 * Access: Manager/Admin
 */
router.get('/:id', getOtherIncomeById);

/**
 * POST /api/other-income
 * Create a new other income
 * Access: Manager/Admin
 * Body: { title, description, amount, vatRate, vatType, category, clientName, ... }
 */
router.post('/', createOtherIncome);

/**
 * PUT /api/other-income/:id
 * Update an existing other income
 * Access: Manager/Admin
 * Body: Any fields to update
 */
router.put('/:id', updateOtherIncome);

/**
 * DELETE /api/other-income/:id
 * Delete an other income
 * Access: Manager/Admin
 */
router.delete('/:id', deleteOtherIncome);

// ============================================
// STATUS OPERATIONS
// ============================================
/**
 * PATCH /api/other-income/:id/mark-paid
 * Mark an income as paid
 * Access: Manager/Admin
 * Body: { paymentMethod, transactionRef } (optional)
 */
router.patch('/:id/mark-paid', markOtherIncomeAsPaid);

// ============================================
// INVOICE OPERATIONS
// ============================================
/**
 * GET /api/other-income/:id/download
 * Download the invoice PDF
 * Access: Manager/Admin
 * Opens in new tab or downloads file
 */
router.get('/:id/download', downloadOtherIncomeInvoice);

// ============================================
// ATTACHMENT OPERATIONS
// ============================================
/**
 * POST /api/other-income/:id/attachments
 * Upload an attachment for an other income
 * Access: Manager/Admin
 * Content-Type: multipart/form-data
 * Body: file (file), description (string, optional)
 */
router.post(
  '/:id/attachments',
  uploadSingleMemory('file'),
  uploadOtherIncomeAttachment
);

/**
 * GET /api/other-income/attachments/:attachmentId/download
 * Download an attachment
 * Access: Manager/Admin
 */
router.get('/attachments/:attachmentId/download', downloadOtherIncomeAttachment);

/**
 * GET /api/other-income/attachments/:attachmentId/preview
 * Preview an attachment (inline)
 * Access: Manager/Admin
 */
router.get('/attachments/:attachmentId/preview', previewOtherIncomeAttachment);

/**
 * DELETE /api/other-income/attachments/:attachmentId
 * Delete an attachment
 * Access: Manager/Admin
 */
router.delete('/attachments/:attachmentId', deleteOtherIncomeAttachment);

export default router;