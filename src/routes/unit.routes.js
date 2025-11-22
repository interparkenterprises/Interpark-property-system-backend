import express from 'express';
import {
  getUnits,
  getUnitsByProperty,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit
} from '../controllers/unit.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getUnits)
  .post(authorize('ADMIN', 'MANAGER'), createUnit);

router.get('/property/:propertyId', getUnitsByProperty);

router.route('/:id')
  .get(getUnit)
  .put(authorize('ADMIN', 'MANAGER'), updateUnit)
  .delete(authorize('ADMIN'), deleteUnit);

export default router;