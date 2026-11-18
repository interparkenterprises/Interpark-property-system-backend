import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { ERP_JWT_AUDIENCE, PERSONNEL_JWT_AUDIENCE } from '../utils/generateToken.js';

const readCookie = (header, name) => {
  if (!header) return undefined;
  const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
};

const bearerToken = req => {
  const authorization = req.headers?.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
};

const passwordChangedAfterToken = (passwordChangedAt, issuedAt) => Boolean(
  passwordChangedAt && issuedAt && Math.floor(passwordChangedAt.getTime() / 1000) > issuedAt
);

const erpUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isApproved: true,
  isManagedUser: true,
  canManagerLogin: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  passwordChangedAt: true
};

export const createProtect = prismaClient => async (req, res, next) => {
  try {
    const token = bearerToken(req)
      || req.query?.token
      || req.cookies?.token
      || readCookie(req.headers?.cookie, 'token');

    if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.aud && decoded.aud !== ERP_JWT_AUDIENCE) {
      return res.status(401).json({ message: 'Not authorized, invalid token audience' });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: decoded.userId || decoded.id },
      select: erpUserSelect
    });

    if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });
    if (user.role === 'PERSONNEL') {
      return res.status(403).json({ message: 'Personnel accounts cannot access the ERP' });
    }
    if (user.isApproved === false) {
      return res.status(403).json({ message: 'Account is not approved. Please wait for admin approval.' });
    }
    if (passwordChangedAfterToken(user.passwordChangedAt, decoded.iat)) {
      return res.status(401).json({ message: 'Not authorized, password changed after token issuance' });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const createProtectPersonnel = prismaClient => async (req, res, next) => {
  try {
    const token = req.cookies?.personnel_token
      || readCookie(req.headers?.cookie, 'personnel_token');

    if (!token) return res.status(401).json({ message: 'Personnel authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      audience: PERSONNEL_JWT_AUDIENCE
    });
    const user = await prismaClient.user.findUnique({
      where: { id: decoded.userId || decoded.id },
      select: {
        ...erpUserSelect,
        servicePersonnel: { select: { id: true, status: true, portalAccessStatus: true } }
      }
    });

    if (!user || user.role !== 'PERSONNEL' || !user.servicePersonnel) {
      return res.status(401).json({ message: 'Invalid personnel account' });
    }
    if (!user.isApproved || !user.canManagerLogin) {
      return res.status(403).json({ message: 'Personnel portal access is disabled' });
    }
    if (user.servicePersonnel.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'Personnel record is inactive' });
    }
    if (user.servicePersonnel.portalAccessStatus !== 'ACTIVE') {
      return res.status(403).json({ message: 'Personnel portal access is not active' });
    }
    if (passwordChangedAfterToken(user.passwordChangedAt, decoded.iat)) {
      return res.status(401).json({ message: 'Not authorized, password changed after token issuance' });
    }
    if (decoded.pwd && user.passwordChangedAt?.getTime() !== decoded.pwd) {
      return res.status(401).json({ message: 'Not authorized, personnel session is no longer current' });
    }

    req.user = user;
    req.servicePersonnel = user.servicePersonnel;
    req.personnelSession = decoded;
    return next();
  } catch (error) {
    console.error('Personnel token verification error:', error.message);
    return res.status(401).json({ message: 'Personnel authentication failed' });
  }
};

export const protect = createProtect(prisma);
export const protectPersonnel = createProtectPersonnel(prisma);

export const adminProtect = async (req, res, next) => {
  if (req.user?.role === 'ADMIN') return next();
  return res.status(403).json({ message: 'Admin access required' });
};

export const requirePermission = permissionCode => async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { role: { include: { permissions: true } } }
    });
    const hasPermission = user?.role?.permissions?.some(
      permission => permission.code === permissionCode || permission.code === '*'
    );
    if (hasPermission || user?.role === 'ADMIN' || user?.role === 'MANAGER') return next();
    return res.status(403).json({ message: 'Permission denied', requiredPermission: permissionCode });
  } catch (error) {
    console.error('Permission check error:', error);
    return res.status(500).json({ message: 'Server error checking permissions' });
  }
};

export const managerProtect = async (req, res, next) => {
  if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'MANAGER')) return next();
  return res.status(403).json({ message: 'Manager access required' });
};
