import express from 'express';
import {
  // ── Existing handlers ──
  registerUser,
  loginUser,
  getProfile,
  registerAdmin,
  registerFirstAdmin,
  updateUserRole,
  approveUser,
  getPendingUsers,
  getAllUsers,
  changePassword,
  // ── Stage 2 portal handlers ──
  invitePortalUser,
  acceptInvitation,
  resendInvitation,
  suspendPortalUser,
  reactivatePortalUser,
  requestPasswordReset,
  resetPassword,
} from '../controllers/auth.controller.js';
import { protect, adminProtect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// ======================================================
// PUBLIC ROUTES
// ======================================================
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/register-first-admin', registerFirstAdmin);

// Public token-gated flows (no `protect`):
//   - accept-invitation  : portal user sets their own password
//   - forgot-password    : issue a reset token (always returns 200)
//   - reset-password     : consume a reset token, set a new password
router.post('/accept-invitation', acceptInvitation);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

// ======================================================
// PROTECTED ROUTES
// ======================================================
router.get('/profile', protect, getProfile);
router.post('/change-password', protect, changePassword);

// ======================================================
// ADMIN-ONLY ROUTES (unchanged)
// ======================================================
router.post('/register-admin', protect, adminProtect, registerAdmin);
router.get('/users', protect, adminProtect, getAllUsers);
router.get('/users/pending', protect, adminProtect, getPendingUsers);
router.put('/users/:id/role', protect, adminProtect, updateUserRole);
router.put('/users/:id/approve', protect, adminProtect, approveUser);

// ======================================================
// PORTAL ONBOARDING / MANAGEMENT (Stage 2)
// ======================================================
// ADMIN and MANAGER can call these. The controller enforces
// MANAGER scope (must manage the property behind the profile),
// so `authorize('ADMIN','MANAGER')` here is only the coarse gate.
router.post(
  '/invite-portal-user',
  protect,
  authorize('ADMIN', 'MANAGER'),
  invitePortalUser
);

router.post(
  '/resend-invitation',
  protect,
  authorize('ADMIN', 'MANAGER'),
  resendInvitation
);

router.post(
  '/users/:id/suspend',
  protect,
  authorize('ADMIN', 'MANAGER'),
  suspendPortalUser
);

router.post(
  '/users/:id/reactivate',
  protect,
  authorize('ADMIN', 'MANAGER'),
  reactivatePortalUser
);

export default router;