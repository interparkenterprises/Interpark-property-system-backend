import { rateLimit } from 'express-rate-limit';

const common = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
};

export const personnelActivationRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5
});

export const personnelLoginRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5
});

export const personnelInvitationResendRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5
});

export const personnelForgotPasswordRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5
});

export const personnelResetPasswordRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5
});
