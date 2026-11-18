import { createHash, randomBytes } from 'node:crypto';

export const ACCOUNT_TOKEN_EXPIRY_MS = Object.freeze({
  PERSONNEL_ACTIVATION: 24 * 60 * 60 * 1000,
  PERSONNEL_PASSWORD_RESET: 30 * 60 * 1000
});

export const hashAccountToken = rawToken => {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    throw new TypeError('Account token must be a non-empty string');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
};

export const generateAccountToken = (type, now = new Date()) => {
  const lifetime = ACCOUNT_TOKEN_EXPIRY_MS[type];
  if (!lifetime) throw new TypeError(`Unsupported account token type: ${type}`);
  const rawToken = randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: hashAccountToken(rawToken),
    expiresAt: new Date(now.getTime() + lifetime)
  };
};
