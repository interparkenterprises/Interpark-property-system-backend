import prisma from "../lib/prisma.js";
import { hashPassword, comparePassword } from '../utils/hashPassword.js';
import generateToken from '../utils/generateToken.js';

//const prisma = new PrismaClient();

// @desc    Register new user (Manager only)
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user - always as MANAGER, pending approval
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: 'MANAGER',
        isApproved: false // Default to false, needs admin approval
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
        // No token generated yet - user cannot login until approved
      });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Register new admin
// @route   POST /api/auth/register-admin
// @access  Public ONLY if no admin exists, otherwise Admin only
export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if any admin exists
    const adminExists = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    // If admin exists but request has NO authorized admin → block it
    if (adminExists) {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Not authorized to create admin users' });
      }
    }

    // Check if user already exists
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create admin user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: 'ADMIN',
        isApproved: true
      }
    });

    res.status(201).json({
      message: adminExists
        ? 'Admin created by existing admin'
        : 'First admin created successfully',
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      token: generateToken(user.id, user.role)
    });

  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};


// @desc    Authenticate user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // Check if user exists and password is correct
    if (user && (await comparePassword(password, user.password))) {
      // Check if user is approved (for MANAGERS only)
      if (user.role === 'MANAGER' && !user.isApproved) {
        return res.status(403).json({ 
          message: 'Your account is pending admin approval. Please wait for approval before logging in.' 
        });
      }

      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        token: generateToken(user.id, user.role)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get current user profile
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
        createdAt: true 
      }
    });

    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update user role (Admin only)
// @route   PUT /api/auth/users/:id/role
// @access  Private/Admin
export const updateUserRole = async (req, res) => {
  try {
    // Check if current user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to update user roles' });
    }

    const { id } = req.params;
    const { role } = req.body;

    // Validate role
    if (!['ADMIN', 'MANAGER'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    // Prevent admin from demoting themselves
    if (id === req.user.id && role !== 'ADMIN') {
      return res.status(400).json({ message: 'Cannot demote yourself' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { 
        role,
        // Auto-approve if role is changed to ADMIN
        ...(role === 'ADMIN' && { isApproved: true })
      },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        isApproved: true,
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
    // Check if current user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized to approve users' });
    }

    const { id } = req.params;
    const { isApproved } = req.body;

    // Validate input
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ message: 'isApproved must be a boolean' });
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Admins are always approved, no need to change
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
    // Check if current user is admin
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
    // Check if current user is admin
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