import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  getEmployeesDueForPayment,
  getUpcomingPayments,
  recordSalaryPayment,
  getPaymentHistory,
  updateEmployee,
  updateEmployeeStatus,
  getStatistics,
  getReminders,
  sendManualReminders,
  getPaymentStatusSummary
} from '../controllers/employee.controller.js';

const router = express.Router();

// All employee routes require authentication
router.use(protect);

// Create employee - ADMIN and MANAGER only
router.post('/', authorize('ADMIN', 'MANAGER'), createEmployee);

// View employees - ADMIN and MANAGER only
router.get('/', authorize('ADMIN', 'MANAGER'), getEmployees);

// Statistics - ADMIN and MANAGER only
router.get('/statistics', authorize('ADMIN', 'MANAGER'), getStatistics);

// Payment status summary - ADMIN and MANAGER only
router.get('/payment-summary', authorize('ADMIN', 'MANAGER'), getPaymentStatusSummary);

// Due employees - ADMIN and MANAGER only
router.get('/due', authorize('ADMIN', 'MANAGER'), getEmployeesDueForPayment);

// Upcoming payments - ADMIN and MANAGER only
router.get('/upcoming', authorize('ADMIN', 'MANAGER'), getUpcomingPayments);

// Get reminders - ADMIN and MANAGER only
router.get('/reminders', authorize('ADMIN', 'MANAGER'), getReminders);

// Send manual reminders - ADMIN only
router.post('/reminders/send', authorize('ADMIN'), sendManualReminders);

// Get single employee - ADMIN and MANAGER only
router.get('/:id', authorize('ADMIN', 'MANAGER'), getEmployeeById);

// Update employee - ADMIN and MANAGER only
router.put('/:id', authorize('ADMIN', 'MANAGER'), updateEmployee);

// Update employee status - ADMIN and MANAGER only
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), updateEmployeeStatus);

// Record salary payment - ADMIN and MANAGER only
router.post('/:employeeId/payments', authorize('ADMIN', 'MANAGER'), recordSalaryPayment);

// View payment history - ADMIN and MANAGER only
router.get('/:employeeId/payments', authorize('ADMIN', 'MANAGER'), getPaymentHistory);

export default router;