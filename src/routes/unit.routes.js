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

// All routes require authentication
router.use(protect);

// Get all units & create unit - Allow ADMIN, MANAGER, and USER
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getUnits)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createUnit);

// Get vacant & occupied units - Allow ADMIN, MANAGER, and USER
router.get('/vacant', authorize('ADMIN', 'MANAGER', 'USER'), getVacantUnits);
router.get('/occupied', authorize('ADMIN', 'MANAGER', 'USER'), getOccupiedUnits);

// Get units by property - Allow ADMIN, MANAGER, and USER
router.get('/property/:propertyId', authorize('ADMIN', 'MANAGER', 'USER'), getUnitsByProperty);

// Get / Update / Delete single unit - Allow ADMIN, MANAGER, and USER
router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getUnit)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateUnit)
  .delete(authorize('ADMIN', 'MANAGER', 'USER'), deleteUnit);

export default router;