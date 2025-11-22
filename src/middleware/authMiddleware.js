import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, name: true, role: true }
        });

        if (!user) {
          return res.status(401).json({ message: 'Not authorized, user not found' });
        }

        req.user = user;
        next();
      } catch (error) {
        return res.status(401).json({ message: 'Not authorized, token failed' });
      }
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }
  } catch (error) {
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