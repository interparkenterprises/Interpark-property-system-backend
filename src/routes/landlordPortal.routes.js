import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { requireLandlordScope } from '../middleware/portalScopeMiddleware.js';
import {
  getProfile,
  getProperties,
  getProperty,
  getPropertyUnits,
  getPropertyTenants,
  getPropertyDemandLetters,
  getPropertyDailyReports,
  getCommissions,
} from '../controllers/landlordPortal.controller.js';

const router = express.Router();

// Every landlord-portal request must be:
//   1. authenticated (protect)
//   2. role LANDLORD (authorize)
//   3. linked to a landlord profile + have scoped property IDs
//      attached (requireLandlordScope)
// If any of these fails, the request stops before the controller.
router.use(protect, authorize('LANDLORD'), requireLandlordScope);

// ======================================================
// LANDLORD PORTAL ROUTES
// ======================================================


router.get('/profile', getProfile);

// Properties
router.get('/properties', getProperties);
router.get('/properties/:propertyId', getProperty);
router.get('/properties/:propertyId/units', getPropertyUnits);
router.get('/properties/:propertyId/tenants', getPropertyTenants);
router.get('/properties/:propertyId/demand-letters', getPropertyDemandLetters);
router.get('/properties/:propertyId/daily-reports', getPropertyDailyReports);

// Commissions (across all own properties; ?propertyId= can narrow)
router.get('/commissions', getCommissions);

export default router;