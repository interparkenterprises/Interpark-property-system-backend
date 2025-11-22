import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getProfile, 
  registerAdmin,
  updateUserRole 
} from '../controllers/auth.controller.js';
import { protect, adminProtect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.get('/profile', protect, getProfile);

// Admin only routes
router.post('/register-admin', protect, adminProtect, registerAdmin);
router.put('/users/:id/role', protect, adminProtect, updateUserRole);

export default router;