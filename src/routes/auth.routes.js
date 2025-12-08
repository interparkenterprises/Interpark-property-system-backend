import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getProfile, 
  registerAdmin,
  updateUserRole,
  approveUser,
  getPendingUsers,
  getAllUsers
} from '../controllers/auth.controller.js';
import { protect, adminProtect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.get('/profile', protect, getProfile);

// Admin only routes
router.post('/register-admin',  registerAdmin);
router.get('/users', protect, adminProtect, getAllUsers);
router.get('/users/pending', protect, adminProtect, getPendingUsers);
router.put('/users/:id/role', protect, adminProtect, updateUserRole);
router.put('/users/:id/approve', protect, adminProtect, approveUser);

export default router;