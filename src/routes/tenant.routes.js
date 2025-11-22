import express from 'express';
import {
  getTenants,
  getTenant,
  createTenant,
  updateTenant,
  deleteTenant,
  updateServiceCharge,
  removeServiceCharge
} from '../controllers/tenant.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getTenants)
  .post(authorize('ADMIN', 'MANAGER'), createTenant);

router.route('/:id')
  .get(getTenant)
  .put(authorize('ADMIN', 'MANAGER'), updateTenant)
  .delete(authorize('ADMIN', 'MANAGER'), deleteTenant);

router.route('/:id/service-charge')
  .patch(authorize('ADMIN', 'MANAGER'), updateServiceCharge)
  .delete(authorize('ADMIN', 'MANAGER'), removeServiceCharge);

export default router;