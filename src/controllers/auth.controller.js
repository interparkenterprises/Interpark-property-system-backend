import prisma from "../lib/prisma.js";
import { hashPassword, comparePassword } from '../utils/hashPassword.js';
import generateToken from '../utils/generateToken.js';
import permissionService from "../services/permissionService.js";
import jwt from 'jsonwebtoken';

// Helper function to get user's accessible properties
async function getUserAccessibleProperties(userId, userRole) {
  return await permissionService.getAccessiblePropertyIds(userId, userRole);
}

// @desc    Register new user (Manager only)
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: 'MANAGER',
        isApproved: false
      }
    });

    if (user) {
      res.status(201).json({
        message: 'Registration successful! Please wait for admin approval before logging in.',
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved
      });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
// @desc    Register FIRST admin (only when no admin exists)
// @route   POST /api/auth/register-first-admin
// @access  Public (only works if no admin exists in the system)
export const registerFirstAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if any admin already exists
    const adminExists = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    if (adminExists) {
      return res.status(403).json({ 
        message: 'Admin already exists. Please use /api/auth/register-admin with authentication.',
        hint: 'You must be logged in as an existing admin to create additional admin accounts.'
      });
    }

    // Check if user with this email already exists
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create the first admin
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: 'ADMIN',
        isApproved: true
      }
    });

    // Generate token for immediate login
    const token = generateToken(user.id, user.role);

    res.status(201).json({
      success: true,
      message: 'First admin created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved
      },
      token
    });

  } catch (error) {
    console.error('First admin registration error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Register additional admin (requires existing admin authentication)
// @route   POST /api/auth/register-admin
// @access  Private/Admin only
export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({ 
        success: false,
        message: 'User already exists' 
      });
    }

    // Create new admin
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: 'ADMIN',
        isApproved: true
      }
    });

    // Don't send token for additional admins (they should login separately)
    res.status(201).json({
      success: true,
      message: 'Admin created successfully by existing admin',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Authenticate user (supports regular and managed users)
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userAssignments: {
          where: { 
            isActive: true,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } }
            ]
          },
          include: {
            role: {
              include: {
                propertyAccess: { include: { property: true } },
                permissions: { include: { permission: true } }
              }
            }
          }
        },
        userPropertyAccess: {
          where: { isActive: true },
          include: { property: true }
        },
        createdByManager: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    if (user && (await comparePassword(password, user.password))) {
      
      // Check if managed user's creator still exists and is active
      // Allow both MANAGER and ADMIN as valid creators
      if (user.isManagedUser && user.createdByManagerId) {
        const creator = await prisma.user.findUnique({
          where: { id: user.createdByManagerId }
        });
        
        // Check if creator exists and has valid role (MANAGER or ADMIN)
        if (!creator) {
          return res.status(401).json({ 
            error: "Account access revoked - creator account no longer exists" 
          });
        }
        
        // Allow both MANAGER and ADMIN roles
        if (creator.role !== 'MANAGER' && creator.role !== 'ADMIN') {
          return res.status(401).json({ 
            error: "Account access revoked - invalid creator role" 
          });
        }
        
        // Additional validation for MANAGER creators
        if (creator.role === 'MANAGER') {
          // Check if manager is still approved and can manage users
          if (!creator.isApproved) {
            return res.status(401).json({ 
              error: "Account access revoked - manager account is no longer approved" 
            });
          }
          
          // Optional: Check if manager can still login
          if (!creator.canManagerLogin) {
            return res.status(401).json({ 
              error: "Account access revoked - manager account has been disabled" 
            });
          }
        }
        
        // For ADMIN creators, no additional validation needed
      }
      
      // Check if user can login
      if (!user.canManagerLogin) {
        return res.status(401).json({ 
          message: 'Your account has been disabled. Please contact your manager or admin.' 
        });
      }
      
      // Check if user is approved (for MANAGERS only)
      if (user.role === 'MANAGER' && !user.isApproved) {
        return res.status(403).json({ 
          message: 'Your account is pending admin approval.' 
        });
      }
      
      // Check if this is first login for managed users
      const isFirstLogin = user.isManagedUser && !user.lastLoginAt;
      
      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
      
      // Get accessible properties and permissions
      const accessibleProperties = await getUserAccessibleProperties(user.id, user.role);
      const permissions = await permissionService.getUserPermissions(user.id);
      
      const token = generateToken(user.id, user.role);
      
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        isManagedUser: user.isManagedUser,
        managedBy: user.createdByManager ? {
          id: user.createdByManager.id,
          name: user.createdByManager.name,
          role: user.createdByManager.role
        } : null,
        accessibleProperties,
        permissions,
        requiresPasswordChange: isFirstLogin,
        token
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get current user profile with RBAC info
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        isApproved: true,
        isManagedUser: true,
        createdByManagerId: true,
        canManagerLogin: true,
        lastLoginAt: true,
        createdAt: true 
      }
    });
    
    const accessibleProperties = await getUserAccessibleProperties(req.user.id, user.role);
    const permissions = await permissionService.getUserPermissions(req.user.id);
    
    res.json({
      ...user,
      accessibleProperties,
      permissions
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    const hashedPassword = await hashPassword(newPassword);
    
    await prisma.user.update({
      where: { id: userId },
      data: { 
        password: hashedPassword,
        passwordChangedAt: new Date()
      }
    });
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update user role (Admin only)
// @route   PUT /api/auth/users/:id/role
// @access  Private/Admin
export const updateUserRole = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to update user roles' });
    }

    const { id } = req.params;
    const { role } = req.body;

    if (!['ADMIN', 'MANAGER', 'USER'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    if (id === req.user.id && role !== 'ADMIN') {
      return res.status(400).json({ message: 'Cannot demote yourself' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { 
        role,
        ...(role === 'ADMIN' && { isApproved: true })
      },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        isApproved: true,
        isManagedUser: true,
        createdAt: true 
      }
    });

    res.json(updatedUser);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Approve/Reject user (Admin only)
// @route   PUT /api/auth/users/:id/approve
// @access  Private/Admin
export const approveUser = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to approve users' });
    }

    const { id } = req.params;
    const { isApproved } = req.body;

    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ message: 'isApproved must be a boolean' });
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'ADMIN') {
      return res.status(400).json({ message: 'Admin users are automatically approved' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isApproved },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        isApproved: true,
        createdAt: true 
      }
    });

    res.json({
      message: isApproved 
        ? 'User has been approved successfully' 
        : 'User has been rejected/suspended',
      user: updatedUser
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all pending users (Admin only)
// @route   GET /api/auth/users/pending
// @access  Private/Admin
export const getPendingUsers = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to view pending users' });
    }

    const pendingUsers = await prisma.user.findMany({
      where: {
        role: 'MANAGER',
        isApproved: false
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(pendingUsers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all users (Admin only)
// @route   GET /api/auth/users
// @access  Private/Admin
export const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to view all users' });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isManagedUser: true,
        createdByManagerId: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(users);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};