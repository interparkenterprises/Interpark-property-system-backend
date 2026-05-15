import express from 'express';
import {
  createBill,
  getLastBillInfo,
  getAllBills,
  getBillById,
  updateBill,
  deleteBill,
  payBill
} from '../controllers/bill.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// ======================================================
// BILL ROUTES (ALLOWING USER ROLE WITH PERMISSION CHECKS)
// ======================================================

// POST /bills - Create bill (ADMIN, MANAGER, USER with CREATE_BILL permission)
// Controller will check granular permissions
router.post('/', authorize('ADMIN', 'MANAGER', 'USER'), createBill);

// GET /bills/last-info - Get last bill info (ADMIN, MANAGER, USER with VIEW_BILLS permission)
// Controller will check granular permissions
router.get('/last-info', authorize('ADMIN', 'MANAGER', 'USER'), getLastBillInfo);

// GET /bills - Get all bills with filtering
// ADMIN and MANAGER can view all
// USER will be filtered by accessible properties in controller
router.get('/', authorize('ADMIN', 'MANAGER', 'USER'), getAllBills);

// GET /bills/:id - Get single bill by ID
// Controller will check VIEW_BILLS permission
router.get('/:id', authorize('ADMIN', 'MANAGER', 'USER'), getBillById);

// PUT /bills/:id - Update bill (ADMIN, MANAGER, USER with EDIT_BILL permission)
// Controller will check granular permissions
router.put('/:id', authorize('ADMIN', 'MANAGER', 'USER'), updateBill);

// POST /bills/:id/pay - Pay bill (ADMIN, MANAGER, USER with PAY_BILL permission)
// Controller will check granular permissions
router.post('/:id/pay', authorize('ADMIN', 'MANAGER', 'USER'), payBill);

// DELETE /bills/:id - Delete bill (ADMIN, MANAGER, USER with DELETE_BILL permission)
// Controller will check granular permissions
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'USER'), deleteBill);

export default router;