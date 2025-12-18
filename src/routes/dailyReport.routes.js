import express from 'express';
import DailyReportController from '../controllers/dailyReport.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Create a new daily report
router.post(
  '/',
  authorize('MANAGER', 'ADMIN'), // Only managers and admins can create reports
  DailyReportController.createReport
);

// Get a specific report by ID
router.get(
  '/:id',
  authorize('MANAGER', 'ADMIN'), // Managers, admins, and landlords can view reports
  DailyReportController.getReport
);

// Download report PDF
router.get(
  '/:id/download',
  authorize('MANAGER', 'ADMIN'),
  DailyReportController.downloadReportPDF
);

// Get reports by property - ADD THIS ROUTE
router.get(
  '/property/:propertyId',
  authorize('MANAGER', 'ADMIN'), // Adjust roles as needed
  DailyReportController.getReportsByProperty
);

// Update a report
router.put(
  '/:id',
  authorize('MANAGER', 'ADMIN'), // Only managers and admins can update reports
  DailyReportController.updateReport
);

// Submit a report (change status from DRAFT to SUBMITTED)
router.post(
  '/:id/submit',
  authorize('MANAGER', 'ADMIN'), // Only managers and admins can submit reports
  DailyReportController.submitReport
);

// Delete a report
router.delete(
  '/:id',
  authorize('ADMIN'), // Only admins can delete reports
  DailyReportController.deleteReport
);

export default router;