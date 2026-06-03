import express from 'express';
import {
  getPaymentReports,
  getPaymentsByTenant,
  getPropertyBillsPaymentReport,
  getPropertyRentPaymentReport,
  createPaymentReport,
  getIncomeReports,
  createIncome,
  previewPayment,
  updatePaymentReportWithIncome,
  getPropertyArrears,
  getOutstandingInvoices,
  downloadPaymentReceipt,
  deletePaymentReport
} from '../controllers/paymentReport.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ======================================================
// PAYMENT REPORTS - Allow ADMIN, MANAGER, and USER
// (USER filtered by permissions in controller)
// ======================================================

// GET /api/payments - Get all payment reports (with filtering)
// POST /api/payments - Create new payment report
router.route('/')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getPaymentReports)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createPaymentReport);

// GET /api/payments/tenant/:tenantId - Get payments by tenant
router.get('/tenant/:tenantId', authorize('ADMIN', 'MANAGER', 'USER'), getPaymentsByTenant);

// GET /api/payments/outstanding/:tenantId - Get outstanding invoices for a tenant
router.get('/outstanding/:tenantId', authorize('ADMIN', 'MANAGER', 'USER'), getOutstandingInvoices);

// GET /api/payments/property/:propertyId/bills - Get property bills payment report
router.get('/property/:propertyId/bills', authorize('ADMIN', 'MANAGER', 'USER'), getPropertyBillsPaymentReport);

// GET /api/payments/property/:propertyId/rent - Get property rent payment report
router.get('/property/:propertyId/rent', authorize('ADMIN', 'MANAGER', 'USER'), getPropertyRentPaymentReport);

// GET /api/payments/preview/:tenantId - Preview expected charges (useful for frontend before submitting)
router.get('/preview/:tenantId', authorize('ADMIN', 'MANAGER', 'USER'), previewPayment);

// GET /api/payments/properties/:propertyId/arrears - Get property arrears
router.get('/properties/:propertyId/arrears', authorize('ADMIN', 'MANAGER', 'USER'), getPropertyArrears);

// ======================================================
// INCOME REPORTS
// ======================================================

// GET /api/payments/income - Get income reports
// POST /api/payments/income - Create income record
router.route('/income')
  .get(authorize('ADMIN', 'MANAGER', 'USER'), getIncomeReports)
  .post(authorize('ADMIN', 'MANAGER', 'USER'), createIncome);

// ======================================================
// SINGLE PAYMENT REPORT OPERATIONS
// ======================================================

// PUT /api/payments/:id - Update payment report
// DELETE /api/payments/:id - Delete payment report
router.route('/:id')
  .put(authorize('ADMIN', 'MANAGER', 'USER'), updatePaymentReportWithIncome)
  .delete(authorize('ADMIN', 'MANAGER', 'USER'), deletePaymentReport);

// GET /api/payments/:id/receipt - Download payment receipt PDF
router.get('/:id/receipt', authorize('ADMIN', 'MANAGER', 'USER'), downloadPaymentReceipt);

export default router;