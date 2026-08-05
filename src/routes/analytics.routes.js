import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { requireAnalyticsPermissions } from '../middleware/analyticsPermissionMiddleware.js';
import {
  getCollectionsTrend,
  getOccupancySummary,
  getOverview,
  getReceivablesStatusDistribution,
  getReceivablesSummary,
  getReceivablesTrend,
  getRevenueByProperty,
  getTenantsSummary
} from '../controllers/analytics.controller.js';

const router = express.Router();

router.use(protect);
router.use(authorize('ADMIN', 'MANAGER', 'USER'));

router.get(
  '/overview',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS', 'VIEW_ARREARS', 'VIEW_UNITS', 'VIEW_TENANTS'),
  getOverview
);
router.get(
  '/receivables/summary',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS', 'VIEW_ARREARS'),
  getReceivablesSummary
);
router.get(
  '/receivables/status-distribution',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS'),
  getReceivablesStatusDistribution
);
router.get(
  '/receivables/trend',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS'),
  getReceivablesTrend
);
router.get(
  '/collections/trend',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS'),
  getCollectionsTrend
);
router.get(
  '/revenue/by-property',
  requireAnalyticsPermissions('VIEW_PAYMENT_REPORTS'),
  getRevenueByProperty
);
router.get(
  '/occupancy/summary',
  requireAnalyticsPermissions('VIEW_UNITS'),
  getOccupancySummary
);
router.get(
  '/tenants/summary',
  requireAnalyticsPermissions('VIEW_TENANTS'),
  getTenantsSummary
);

export default router;
