import express from 'express';
import {
  getLandlords,
  getLandlord,
  createLandlord,
  updateLandlord,
  deleteLandlord
} from '../controllers/landlord.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getLandlords)
  .post(authorize('ADMIN', 'MANAGER'), createLandlord);

router.route('/:id')
  .get(getLandlord)
  .put(authorize('ADMIN', 'MANAGER'), updateLandlord)
  .delete(authorize('ADMIN'), deleteLandlord);

export default router;