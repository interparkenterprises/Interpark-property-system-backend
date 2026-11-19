import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import permissionService from '../services/permissionService.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Check Authorization header (Bearer token)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // 2. Check query parameter (for preview and download from new tab)
    else if (req.query && req.query.token) {
      token = req.query.token;
    }
    // 3. Check cookies (if you're using cookie-based auth)
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // If no token found, return unauthorized
    if (!token) {
      return res.status(401).json({
        message: 'Not authorized, no token',
        debug: {
          hasAuthHeader: !!req.headers.authorization,
          hasQueryToken: !!(req.query && req.query.token),
          hasCookie: !!(req.cookies && req.cookies.token)
        }
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Handle both userId and id from token
      const userId = decoded.userId || decoded.id;

      // Select only fields that exist in your User model.
      // accountStatus + *ProfileId are new (Stage 1 migration) and are
      // what the portal scope middleware will read downstream.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
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
          passwordChangedAt: true,
          // ── New: portal plumbing ──────────────────────
          accountStatus: true,
          landlordProfileId: true,
          tenantProfileId: true,
          serviceProviderProfileId: true,
        }
      });

      if (!user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // Account-status gate (defense in depth). A user who is suspended,
      // disabled, or still pending invitation MUST NOT be able to use any
      // endpoint, even with an unexpired JWT. For staff roles this field
      // is always 'ACTIVE', so staff behavior is unchanged.
      if (user.accountStatus && user.accountStatus !== 'ACTIVE') {
        return res.status(403).json({
          message: 'Account is not active. Please contact your administrator.',
          accountStatus: user.accountStatus,
        });
      }

      // Check if user is approved
      if (user.isApproved === false) {
        return res.status(403).json({
          message: 'Account is not approved. Please wait for admin approval.'
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Token verification error:', error.message);
      return res.status(401).json({
        message: 'Not authorized, token failed',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Server error in authentication' });
  }
};

export const adminProtect = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'ADMIN') {
      next();
    } else {
      res.status(403).json({ message: 'Admin access required' });
    }
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

// Middleware to check if the user has a specific permission code.
//
// Delegates to permissionService.hasPermission, which already knows how
// to (a) grant ADMIN unconditionally, (b) honour custom-role permissions
// granted via CustomRolePermission, and (c) honour property-scoped
// overrides when a propertyId is supplied. The previous implementation
// tried to `include: { role: ... }` on User, which is a Prisma error
// because `User.role` is an enum, not a relation — so every route using
// this middleware previously returned a 500. This rewrite is a strict
// fix; the call signature requirePermission('CODE') is unchanged.
export const requirePermission = (permissionCode) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Not authorized' });
      }

      // Allow callers to scope by property when they have it.
      // Falls back to a global check when not supplied.
      const propertyId =
        req.params?.propertyId ||
        req.params?.id ||
        req.body?.propertyId ||
        null;

      const has = await permissionService.hasPermission(
        req.user.id,
        permissionCode,
        propertyId || null
      );

      if (has) return next();

      return res.status(403).json({
        message: 'Permission denied',
        requiredPermission: permissionCode,
      });
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Server error checking permissions' });
    }
  };
};

export const managerProtect = async (req, res, next) => {
  try {
    if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'MANAGER')) {
      next();
    } else {
      res.status(403).json({ message: 'Manager access required' });
    }
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};