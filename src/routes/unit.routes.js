import express from 'express';
import {
  getUnits,
  getUnitsByProperty,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  getVacantUnits,
  getOccupiedUnits
} from '../controllers/unit.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

// Get all units & create unit
router.route('/')
  .get(getUnits)
  .post(authorize('ADMIN', 'MANAGER'), createUnit);

// Get vacant & occupied units **must be before /:id**
router.get('/vacant', getVacantUnits);
router.get('/occupied', getOccupiedUnits);

// Get units by property
router.get('/property/:propertyId', getUnitsByProperty);

// Get / Update / Delete single unit
router.route('/:id')
  .get(getUnit)
  .put(authorize('ADMIN', 'MANAGER'), updateUnit)
  .delete(authorize('ADMIN', 'MANAGER'), deleteUnit);

export default router;
