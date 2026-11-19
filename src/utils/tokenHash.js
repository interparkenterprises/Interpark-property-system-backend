import crypto from 'crypto';

/**
 * Generate an opaque, URL-safe random token.
 *
 * The raw token is what you email to the user (or return in a dev-only
 * response). It is NEVER stored in the database. Only its SHA-256 hash
 * is persisted, in the existing User.passwordResetToken column.
 *
 * 32 random bytes => 256 bits of entropy. Base64url keeps it URL-safe
 * so it can be embedded directly in a link without escaping.
 */
export const generateOpaqueToken = () => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Hash a raw token for storage / comparison.
 *
 * SHA-256 is sufficient here (not bcrypt) because:
 *   - the token is high-entropy (256 bits), not a low-entropy password;
 *   - we compare it on every accept/reset attempt and bcrypt's cost
 *     would add up without adding meaningful brute-force resistance
 *     against a 256-bit random string.
 *
 * Both sides must be hashed the same way (raw token from the user,
 * stored hash in the DB). Comparison must be constant-time to avoid
 * timing oracles — use crypto.timingSafeEqual on equal-length buffers.
 */
export const hashToken = (rawToken) => {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
};

/**
 * Constant-time comparison of a raw token against a stored hash.
 * Returns false (never throws) for missing inputs or length mismatch.
 */
export const verifyToken = (rawToken, storedHash) => {
  if (!rawToken || !storedHash) return false;

  const candidateHash = hashToken(rawToken);

  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(String(storedHash), 'hex');

  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

/**
 * Convenience: build a fresh (rawToken, hashedToken, expiresAt) triple.
 * Default expiry is 72 hours, matching the invitation window we agreed on.
 */
export const issueToken = ({ ttlHours = 72 } = {}) => {
  const rawToken = generateOpaqueToken();
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return { rawToken, hashedToken, expiresAt };
};