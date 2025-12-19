import express from 'express';
const router = express.Router();
import {
  createBill,
  getAllBills,
  getBillById,
  updateBill,
  deleteBill,
  payBill
} from '../controllers/bill.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

// Apply protect middleware to all routes
router.use(protect);

// POST /bills - Only ADMIN or MANAGER can create bills
router.post('/', authorize('ADMIN', 'MANAGER'), createBill);

// GET /bills - ADMIN, MANAGER can see all, TENANT can only see their own
router.get('/', authorize('ADMIN', 'MANAGER', ), getAllBills);

// GET /bills/:id - ADMIN, MANAGER can see any, TENANT can only see their own
router.get('/:id', authorize('ADMIN', 'MANAGER'), getBillById);

// PUT /bills/:id - Only ADMIN can update bills
router.put('/:id', authorize('ADMIN'), updateBill);
// POST /bills/:id/pay - ADMIN,MANAGER can mark as paid
router.post('/:id/pay', authorize( 'ADMIN', 'MANAGER'), payBill);

// DELETE /bills/:id - Only ADMIN can delete bills
router.delete('/:id', authorize('ADMIN' ), deleteBill);

export default router;