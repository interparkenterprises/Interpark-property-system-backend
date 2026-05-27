import express from 'express';
import {
  getTenants,
  getTenant,
  getOverdueTenants,
  getNextPaymentsByProperty,
  getTenantsByProperty,
  createTenant,
  updateTenant,
  deleteTenant,
  updateServiceCharge,
  removeServiceCharge
} from '../controllers/tenant.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET routes - Allow ADMIN, MANAGER, and USER (USER filtered by permissions in controller)
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenants)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createTenant);

router.route('/property/:propertyId')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenantsByProperty);
  
router.route('/property/:propertyId/next-payments')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getNextPaymentsByProperty);

router.route('/overdue')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getOverdueTenants);



router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getTenant)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateTenant)
  .delete(authorize('ADMIN', 'MANAGER'), deleteTenant);

router.route('/:id/service-charge')
  .patch(authorize('ADMIN', 'MANAGER', 'USER'), updateServiceCharge)
  .delete(authorize('ADMIN', 'MANAGER'), removeServiceCharge);

export default router;