import express from 'express';
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  getManagerProperties,
  updatePropertyImage,
  updatePropertyCommission,
  getPropertyImage,
  upload
} from '../controllers/property.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes below require authentication
router.use(protect);

// ======================================================
// PROPERTY MANAGEMENT ROUTES
// ======================================================

// @route   GET /api/properties
// @route   POST /api/properties
// @access  Private
router.route('/')
  .get(authorize('ADMIN', 'MANAGER'), getProperties)
  .post(authorize('ADMIN', 'MANAGER'), upload.single('image'), createProperty);

// @route   GET /api/properties/:id
// @route   PUT /api/properties/:id
// @route   DELETE /api/properties/:id
// @access  Private
router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER'), getProperty)
  .put(authorize('ADMIN', 'MANAGER'), upload.single('image'), updateProperty)
  .delete(authorize('ADMIN'), deleteProperty);

// ======================================================
// MANAGER-SPECIFIC ROUTES
// ======================================================

// @route   GET /api/properties/manager/my-properties
// @access  Private (Manager only)
router.get('/manager/my-properties', authorize('MANAGER'), getManagerProperties);

// ======================================================
// PROPERTY IMAGE MANAGEMENT
// ======================================================

// @route   PATCH /api/properties/:id/image
// @access  Private
router.patch('/:id/image', authorize('ADMIN', 'MANAGER'), upload.single('image'), updatePropertyImage);

// @route   GET /api/properties/:id/image
// @access  Public (or Private if needed)
router.get('/:id/image', getPropertyImage);

// ======================================================
// COMMISSION MANAGEMENT
// ======================================================

// @route   PATCH /api/properties/:id/commission
// @access  Private (Admin only)
router.patch('/:id/commission', authorize('ADMIN'), updatePropertyCommission);

export default router;
