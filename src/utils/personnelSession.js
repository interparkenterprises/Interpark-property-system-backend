import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PERSONNEL_COOKIE_NAME = 'personnel_token';
export const PERSONNEL_CSRF_COOKIE_NAME = 'personnel_csrf';
export const PERSONNEL_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export const personnelCookieOptions = () => {
  const production = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/api',
    maxAge: PERSONNEL_SESSION_MAX_AGE_MS
  };
};

export const personnelCsrfCookieOptions = () => {
  const { httpOnly: _ignored, ...options } = personnelCookieOptions();
  return { ...options, httpOnly: false };
};

export const clearPersonnelCookieOptions = () => {
  const { maxAge: _ignored, ...options } = personnelCookieOptions();
  return options;
};

export const clearPersonnelCsrfCookieOptions = () => {
  const { maxAge: _ignored, ...options } = personnelCsrfCookieOptions();
  return options;
};

export const generateCsrfToken = () => randomBytes(32).toString('base64url');
export const hashCsrfToken = token => createHash('sha256').update(token, 'utf8').digest('hex');

export const csrfTokensEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const readNamedCookie = (header, name) => {
  if (!header) return undefined;
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : undefined;
};
