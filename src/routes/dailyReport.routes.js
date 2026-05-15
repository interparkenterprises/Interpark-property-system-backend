import express from 'express';
import DailyReportController from '../controllers/dailyReport.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { requirePropertyAccess, filterByAccessibleProperties } from '../middleware/propertyAccessMiddleware.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// ======================================================
// REPORT LISTING ROUTES
// ======================================================

// Get all reports (admin only - with permission check in controller)
router.get(
  '/all',
  authorize('ADMIN', 'MANAGER'),
  DailyReportController.getAllReports
);

// Get my reports (for managed users)
router.get(
  '/my-reports',
  authorize('USER'),
  DailyReportController.getMyReports
);

// Get reports by manager
router.get(
  '/manager/reports',
  authorize('MANAGER', 'ADMIN'),
  DailyReportController.getReportsByManager
);

// Get reports by property - with property access middleware
router.get(
  '/property/:propertyId',
  authorize('MANAGER', 'ADMIN', 'USER'),
  requirePropertyAccess('canView'),
  DailyReportController.getReportsByProperty
);

// ======================================================
// SINGLE REPORT OPERATIONS
// ======================================================

// Create a new daily report (requires property access and create permission)
router.post(
  '/',
  authorize('MANAGER', 'ADMIN', 'USER'),
  requirePropertyAccess('canEdit'),
  DailyReportController.createReport
);

// Get a specific report by ID
router.get(
  '/:id',
  authorize('MANAGER', 'ADMIN', 'USER'),
  DailyReportController.getReport
);

// Download report PDF
router.get(
  '/:id/download',
  authorize('MANAGER', 'ADMIN', 'USER'),
  DailyReportController.downloadReportPDF
);

// Update a report (requires property edit access and update permission)
router.put(
  '/:id',
  authorize('MANAGER', 'ADMIN', 'USER'),
  DailyReportController.updateReport
);

// Submit a report (change status from DRAFT to SUBMITTED)
router.post(
  '/:id/submit',
  authorize('MANAGER', 'ADMIN', 'USER'),
  DailyReportController.submitReport
);

// Delete a report (requires property delete access and delete permission)
router.delete(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  DailyReportController.deleteReport
);

// Review report (approve/reject)
router.post(
  '/:id/review',
  authorize('ADMIN', 'MANAGER'),
  DailyReportController.reviewReport
);

export default router;