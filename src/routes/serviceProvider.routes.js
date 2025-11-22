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

router.use(protect);

router.route('/')
  .get(getServiceProviders)
  .post(authorize('ADMIN', 'MANAGER'), createServiceProvider);

router.get('/property/:propertyId', getServiceProvidersByProperty);

router.route('/:id')
  .get(getServiceProvider)
  .put(authorize('ADMIN', 'MANAGER'), updateServiceProvider)
  .delete(authorize('ADMIN', 'MANAGER'), deleteServiceProvider);

export default router;