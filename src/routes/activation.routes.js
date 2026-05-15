import express from 'express';
import {
  createActivationRequest,
  getActivationRequests,
  getActivationRequest,
  updateActivationRequest,
  generateActivationPDFController,
  submitActivationRequest,
  deleteActivationRequest,
  downloadActivationPDF,
  getActivationStats,
  getVATSummary
} from '../controllers/activation.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ======================================================
// ACTIVATION REQUEST ROUTES
// ======================================================

// GET /api/activations - View all activation requests
// POST /api/activations - Create new activation request
router.route('/')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getActivationRequests
  )
  .post(
    authorize('ADMIN', 'MANAGER', 'USER'),
    createActivationRequest
  );

// GET /api/activations/stats - Get activation statistics
router.get(
  '/stats',
  authorize('ADMIN', 'MANAGER', 'USER'),
  getActivationStats
);

// GET /api/activations/vat-summary - Get VAT summary
router.get(
  '/vat-summary',
  authorize('ADMIN', 'MANAGER', 'USER'),
  getVATSummary
);

// Routes for specific activation request by ID
router.route('/:id')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getActivationRequest
  )
  .put(
    authorize('ADMIN', 'MANAGER', 'USER'),
    updateActivationRequest
  )
  .delete(
    authorize('ADMIN', 'MANAGER', 'USER'),
    deleteActivationRequest
  );

// Special operations
router.post(
  '/:id/generate-pdf',
  authorize('ADMIN', 'MANAGER', 'USER'),
  generateActivationPDFController
);

router.get(
  '/:id/download',
  authorize('ADMIN', 'MANAGER', 'USER'),
  downloadActivationPDF
);

router.post(
  '/:id/submit',
  authorize('ADMIN', 'MANAGER', 'USER'),
  submitActivationRequest
);

export default router;