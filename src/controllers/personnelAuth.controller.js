import prisma from '../lib/prisma.js';
import { PersonnelActivationService } from '../services/personnelActivation.service.js';
import { PersonnelSessionService } from '../services/personnelSession.service.js';
import {
  PERSONNEL_PASSWORD_RESET_RESPONSE,
  PersonnelPasswordResetService
} from '../services/personnelPasswordReset.service.js';
import {
  clearPersonnelCookieOptions,
  clearPersonnelCsrfCookieOptions,
  csrfTokensEqual,
  hashCsrfToken,
  personnelCookieOptions,
  personnelCsrfCookieOptions,
  PERSONNEL_COOKIE_NAME,
  PERSONNEL_CSRF_COOKIE_NAME,
  readNamedCookie
} from '../utils/personnelSession.js';

const activationService = new PersonnelActivationService(prisma);
const sessionService = new PersonnelSessionService(prisma);
const passwordResetService = new PersonnelPasswordResetService(prisma);

export const forgotPersonnelPassword = async (req, res) => {
  try {
    await passwordResetService.request(req.body?.email);
  } catch {
    // Deliberately return the same response for unknown, ineligible and delivery-failed accounts.
  }
  return res.status(200).json({ success: true, message: PERSONNEL_PASSWORD_RESET_RESPONSE });
};

export const resetPersonnelPassword = async (req, res) => {
  try {
    const result = await passwordResetService.reset(
      req.body?.token,
      req.body?.password,
      { ipAddress: req.ip || null, userAgent: req.get('user-agent') || null }
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to reset the personnel account password'
    });
  }
};

export const loginPersonnel = async (req, res) => {
  try {
    const result = await sessionService.login(req.body?.email, req.body?.password);
    res.cookie(PERSONNEL_COOKIE_NAME, result.token, personnelCookieOptions());
    res.cookie(PERSONNEL_CSRF_COOKIE_NAME, result.csrfToken, personnelCsrfCookieOptions());
    return res.status(200).json({
      success: true,
      data: { user: result.user, csrfToken: result.csrfToken, expiresInSeconds: 8 * 60 * 60 }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to authenticate personnel account'
    });
  }
};

export const logoutPersonnel = async (_req, res) => {
  res.clearCookie(PERSONNEL_COOKIE_NAME, clearPersonnelCookieOptions());
  res.clearCookie(PERSONNEL_CSRF_COOKIE_NAME, clearPersonnelCsrfCookieOptions());
  return res.status(200).json({ success: true, message: 'Personnel session ended' });
};

export const getPersonnelSession = async (req, res) => {
  const csrfToken = req.cookies?.[PERSONNEL_CSRF_COOKIE_NAME]
    || readNamedCookie(req.headers?.cookie, PERSONNEL_CSRF_COOKIE_NAME);
  const signedHash = req.personnelSession?.csrf;
  if (!csrfToken || !signedHash || !csrfTokensEqual(hashCsrfToken(csrfToken), signedHash)) {
    return res.status(401).json({ success: false, message: 'Personnel session security token is unavailable' });
  }
  return res.status(200).json({
    success: true,
    data: { csrfToken, expiresAt: new Date(req.personnelSession.exp * 1000) }
  });
};

export const activatePersonnelAccount = async (req, res) => {
  try {
    const result = await activationService.activate(
      req.body?.token,
      req.body?.password,
      { ipAddress: req.ip || null, userAgent: req.get('user-agent') || null }
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to activate the personnel account'
    });
  }
};
