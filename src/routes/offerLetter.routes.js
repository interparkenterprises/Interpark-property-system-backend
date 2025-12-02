import express from 'express';
import {
  getOfferLetters,
  getOfferLetter,
  createOfferLetter,
  createMixedUseOfferLetter,
  generateOfferLetterPDF,
  downloadOfferLetterPDF,
  updateOfferLetter,
  updateOfferLetterStatus,
  deleteOfferLetter
} from '../controllers/offerLetter.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

// Base routes
router.route('/')
  .get(getOfferLetters)
  .post(authorize('ADMIN', 'MANAGER'), createOfferLetter);

// Mixed-use property route
router.route('/mixed-use')
  .post(authorize('ADMIN', 'MANAGER'), createMixedUseOfferLetter);

// Individual offer letter routes
router.route('/:id')
  .get(getOfferLetter)
  .put(authorize('ADMIN', 'MANAGER'), updateOfferLetter)
  .delete(authorize('ADMIN', 'MANAGER'), deleteOfferLetter);

// Status update
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), updateOfferLetterStatus);

// PDF generation and download
router.post('/:id/generate-pdf', authorize('ADMIN', 'MANAGER'), generateOfferLetterPDF);
router.get('/:id/download', downloadOfferLetterPDF);

export default router;
