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

// All routes require authentication
router.use(protect);

// ======================================================
// LANDLORD ROUTES WITH PERMISSION CHECKS
// ======================================================

// GET /api/landlords - View all landlords
// POST /api/landlords - Create new landlord
router.route('/')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getLandlords
  )
  .post(
    authorize('ADMIN', 'MANAGER', 'USER'),
    createLandlord
  );

// GET /api/landlords/:id - Get single landlord
// PUT /api/landlords/:id - Update landlord
// DELETE /api/landlords/:id - Delete landlord
router.route('/:id')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getLandlord
  )
  .put(
    authorize('ADMIN', 'MANAGER', 'USER'),
    updateLandlord
  )
  .delete(
    authorize('ADMIN', 'MANAGER', 'USER'),
    deleteLandlord
  );

export default router;