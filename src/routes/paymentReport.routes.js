import express from 'express';
import {
  getPaymentReports,
  getPaymentsByTenant,
  createPaymentReport,
  getIncomeReports,
  createIncome,
  previewPayment, // added
  updatePaymentReportWithIncome,
  getPropertyArrears,
  getOutstandingInvoices,
  downloadPaymentReceipt
} from '../controllers/paymentReport.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

// Payment Reports
router.route('/')
  .get(getPaymentReports)
  .post(authorize('ADMIN', 'MANAGER'), createPaymentReport);

router.get('/tenant/:tenantId', getPaymentsByTenant);
router.get('/outstanding/:tenantId', getOutstandingInvoices);

// Preview expected charges (useful for frontend before submitting)
router.get('/preview/:tenantId', authorize('ADMIN', 'MANAGER'), previewPayment);
//get Property Arrears
router.get('/properties/:propertyId/arrears', authorize('ADMIN', 'MANAGER'), getPropertyArrears);

// Income Reports
router.route('/income')
  .get(getIncomeReports)
  .post(authorize('ADMIN', 'MANAGER'), createIncome);
router.route('/:id')
  .put(authorize('ADMIN', 'MANAGER'), updatePaymentReportWithIncome);
router.get('/:id/receipt', protect, downloadPaymentReceipt);  
export default router;