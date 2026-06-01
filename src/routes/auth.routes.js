import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getProfile, 
  registerAdmin,
  registerFirstAdmin,
  updateUserRole,
  approveUser,
  getPendingUsers,
  getAllUsers,
  changePassword
} from '../controllers/auth.controller.js';
import { protect, adminProtect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/register-first-admin', registerFirstAdmin);  // New route for first admin

// Protected routes
router.get('/profile', protect, getProfile);
router.post('/change-password', protect, changePassword);

// Admin only routes
router.post('/register-admin', protect, adminProtect, registerAdmin);  // Now protected
router.get('/users', protect, adminProtect, getAllUsers);
router.get('/users/pending', protect, adminProtect, getPendingUsers);
router.put('/users/:id/role', protect, adminProtect, updateUserRole);
router.put('/users/:id/approve', protect, adminProtect, approveUser);

export default router;