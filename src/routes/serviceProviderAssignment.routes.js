import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  listAssignments,
  assignProvider,
  unassignProvider,
} from '../controllers/serviceProviderAssignment.controller.js';

const router = express.Router();

// Every route requires an authenticated ADMIN or MANAGER. The
// controller additionally re-checks MANAGER property ownership
// before touching the join table (authorize is only the coarse gate).
//
// Mounted at /api/properties/:propertyId/service-providers (see
// app.js). Because `router` here is mounted inside a route that
// already has `:propertyId`, Express exposes `req.params.propertyId`
// to the handlers automatically.

router.use(protect, authorize('ADMIN', 'MANAGER'));

// GET  /api/properties/:propertyId/service-providers
// POST /api/properties/:propertyId/service-providers/:providerId/assign
// DELETE /api/properties/:propertyId/service-providers/:providerId/unassign

router.get('/', listAssignments);
router.post('/:providerId/assign', assignProvider);
router.delete('/:providerId/unassign', unassignProvider);

export default router;