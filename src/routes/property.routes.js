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
import { requirePropertyAccess, filterByAccessibleProperties } from '../middleware/propertyAccessMiddleware.js';

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
  .get(authorize('ADMIN', 'MANAGER', 'USER'), filterByAccessibleProperties(), getProperties)
  .post(authorize('ADMIN', 'MANAGER'), upload.single('image'), createProperty);

// @route   GET /api/properties/:id
// @route   PUT /api/properties/:id
// @route   DELETE /api/properties/:id
// @access  Private
router.route('/:id')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), requirePropertyAccess('canView'), getProperty)
  .put(authorize('ADMIN', 'MANAGER'), requirePropertyAccess('canEdit'), upload.single('image'), updateProperty)
  .delete(authorize('ADMIN'), requirePropertyAccess('canDelete'), deleteProperty);

// ======================================================
// MANAGER-SPECIFIC ROUTES
// ======================================================

router.get('/manager/my-properties', authorize('MANAGER'), getManagerProperties);

// ======================================================
// PROPERTY IMAGE MANAGEMENT
// ======================================================

router.patch('/:id/image', authorize('ADMIN', 'MANAGER'), requirePropertyAccess('canEdit'), upload.single('image'), updatePropertyImage);
router.get('/:id/image', getPropertyImage);

// ======================================================
// COMMISSION MANAGEMENT
// ======================================================

router.patch('/:id/commission', authorize('ADMIN'), updatePropertyCommission);

// ======================================================
// RELATED MODEL ROUTES (with property-based access)
// ======================================================

// Unit routes
router.get('/:propertyId/units', authorize('ADMIN', 'MANAGER', 'USER'), requirePropertyAccess('canView'), async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { propertyId: req.params.propertyId },
      include: { tenant: true }
    });
    res.json(units);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Tenant routes
router.get('/:propertyId/tenants', authorize('ADMIN', 'MANAGER', 'USER'), requirePropertyAccess('canView'), async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      where: {
        unit: { propertyId: req.params.propertyId }
      },
      include: { unit: true, invoices: true }
    });
    res.json(tenants);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Daily Report routes
router.get('/:propertyId/daily-reports', authorize('ADMIN', 'MANAGER', 'USER'), requirePropertyAccess('canView'), async (req, res) => {
  try {
    const reports = await prisma.dailyReport.findMany({
      where: { propertyId: req.params.propertyId },
      orderBy: { reportDate: 'desc' }
    });
    res.json(reports);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Invoice routes
router.get('/:propertyId/invoices', authorize('ADMIN', 'MANAGER', 'USER'), requirePropertyAccess('canView'), async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        tenant: {
          unit: { propertyId: req.params.propertyId }
        }
      },
      include: { tenant: true }
    });
    res.json(invoices);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;