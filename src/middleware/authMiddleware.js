import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
      
      // Select only fields that exist in your User model
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
          // Remove requiresPasswordChange - it doesn't exist
        }
      });

      if (!user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // Check if user is approved
      if (user.isApproved === false) {
        return res.status(403).json({ message: 'Account is not approved. Please wait for admin approval.' });
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

// Optional: Middleware to check if user has specific permissions
export const requirePermission = (permissionCode) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              permissions: true
            }
          }
        }
      });
      
      const hasPermission = user?.role?.permissions?.some(
        p => p.code === permissionCode || p.code === '*'
      );
      
      const isAdmin = user?.role === 'ADMIN';
      const isManager = user?.role === 'MANAGER';
      
      if (hasPermission || isAdmin || isManager) {
        next();
      } else {
        res.status(403).json({ 
          message: 'Permission denied',
          requiredPermission: permissionCode
        });
      }
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