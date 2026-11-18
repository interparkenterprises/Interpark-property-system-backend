import express from 'express';
import {
  activatePersonnelAccount,
  forgotPersonnelPassword,
  getPersonnelSession,
  loginPersonnel,
  logoutPersonnel,
  resetPersonnelPassword
} from '../controllers/personnelAuth.controller.js';
import { protectPersonnel } from '../middleware/authMiddleware.js';
import { requirePersonnelCsrf } from '../middleware/personnelCsrf.js';
import {
  personnelActivationRateLimit,
  personnelForgotPasswordRateLimit,
  personnelLoginRateLimit,
  personnelResetPasswordRateLimit
} from '../middleware/personnelAuthRateLimits.js';

const router = express.Router();

router.post('/activate', personnelActivationRateLimit, activatePersonnelAccount);
router.post('/login', personnelLoginRateLimit, loginPersonnel);
router.post('/forgot-password', personnelForgotPasswordRateLimit, forgotPersonnelPassword);
router.post('/reset-password', personnelResetPasswordRateLimit, resetPersonnelPassword);
router.get('/session', protectPersonnel, getPersonnelSession);
router.post('/logout', protectPersonnel, requirePersonnelCsrf, logoutPersonnel);

export default router;
