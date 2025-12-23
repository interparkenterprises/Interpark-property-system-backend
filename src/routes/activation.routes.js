import express from 'express';
import {
  createActivationRequest,
  getActivationRequests,
  getActivationRequest,
  updateActivationRequest,
  generateActivationPDFController,
  submitActivationRequest,
  deleteActivationRequest,
  downloadActivationPDF
} from '../controllers/activation.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication and MANAGER role
router.use(protect);
router.use(authorize('MANAGER', 'ADMIN'));

// CRUD operations
router.route('/')
  .get(getActivationRequests)      // Get all activation requests
  .post(createActivationRequest);   // Create new activation request

router.route('/:id')
  .get(getActivationRequest)        // Get single activation request
  .put(updateActivationRequest)     // Update activation request
  .delete(deleteActivationRequest); // Delete activation request

// Special operations
router.post('/:id/generate-pdf',  generateActivationPDFController);  // Generate PDF
router.get('/:id/download', downloadActivationPDF);    //Download PDF
router.post('/:id/submit', submitActivationRequest);      // Submit for review

export default router;