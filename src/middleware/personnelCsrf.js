import {
  csrfTokensEqual,
  hashCsrfToken,
  PERSONNEL_CSRF_COOKIE_NAME,
  readNamedCookie
} from '../utils/personnelSession.js';

export const requirePersonnelCsrf = (req, res, next) => {
  const headerToken = req.get('x-csrf-token');
  const cookieToken = req.cookies?.[PERSONNEL_CSRF_COOKIE_NAME]
    || readNamedCookie(req.headers?.cookie, PERSONNEL_CSRF_COOKIE_NAME);
  const signedHash = req.personnelSession?.csrf;

  if (!headerToken
    || !cookieToken
    || !signedHash
    || !csrfTokensEqual(headerToken, cookieToken)
    || !csrfTokensEqual(hashCsrfToken(headerToken), signedHash)) {
    return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
  }
  return next();
};
