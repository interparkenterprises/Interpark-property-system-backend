import express from 'express';
import {
  getServiceProviders,
  getServiceProvidersByProperty,
  getServiceProvider,
  createServiceProvider,
  updateServiceProvider,
  deleteServiceProvider
} from '../controllers/serviceProvider.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET routes - Allow ADMIN, MANAGER, and USER (USER filtered by permissions in controller)
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getServiceProviders)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createServiceProvider);

// Get service providers by property - Allow ADMIN, MANAGER, and USER
router.get('/property/:propertyId', authorize('ADMIN', 'MANAGER', 'USER'), getServiceProvidersByProperty);

router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getServiceProvider)
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updateServiceProvider)
  .delete(authorize('ADMIN', 'MANAGER'), deleteServiceProvider);

export default router;