import jwt from 'jsonwebtoken';

export const ERP_JWT_AUDIENCE = 'interpark-erp';
export const PERSONNEL_JWT_AUDIENCE = 'interpark-personnel';
export const ERP_SESSION_EXPIRY = '30d';
export const PERSONNEL_SESSION_EXPIRY = '8h';

const signToken = (userId, role, { audience, expiresIn, claims = {} }) => {
  return jwt.sign(
    { userId, role, ...claims },
    process.env.JWT_SECRET,
    { audience, expiresIn }
  );
};

const generateToken = (userId, role) => signToken(userId, role, {
  audience: ERP_JWT_AUDIENCE,
  expiresIn: ERP_SESSION_EXPIRY
});

export const generatePersonnelToken = (userId, { csrfHash, passwordChangedAt } = {}) => signToken(userId, 'PERSONNEL', {
  audience: PERSONNEL_JWT_AUDIENCE,
  expiresIn: PERSONNEL_SESSION_EXPIRY,
  claims: {
    ...(csrfHash ? { csrf: csrfHash } : {}),
    ...(passwordChangedAt ? { pwd: passwordChangedAt.getTime() } : {})
  }
});

export default generateToken;
