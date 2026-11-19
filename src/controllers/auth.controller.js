import prisma from "../lib/prisma.js";
import { hashPassword, comparePassword } from '../utils/hashPassword.js';
import generateToken from '../utils/generateToken.js';
import permissionService from "../services/permissionService.js";
import jwt from 'jsonwebtoken';
import { issueToken, verifyToken, hashToken } from '../utils/tokenHash.js';
import { sendInvitationEmail } from '../utils/emailService.js';

// ======================================================
// PORTAL ROLE CONSTANTS
// ======================================================
const PORTAL_ROLES = ['LANDLORD', 'TENANT', 'SERVICE_PROVIDER'];

const isPortalRole = (role) => PORTAL_ROLES.includes(role);

// Role -> which profile FK on User holds the link, and which Prisma
// model that FK points at. Kept as a lookup so invite/reset/suspend
// handlers stay uniform across the three portal types.
const PORTAL_PROFILE_MAP = {
  LANDLORD:         { fkField: 'landlordProfileId',        model: 'landlord',        nameField: 'name' },
  TENANT:           { fkField: 'tenantProfileId',          model: 'tenant',          nameField: 'fullName' },
  SERVICE_PROVIDER: { fkField: 'serviceProviderProfileId', model: 'serviceProvider', nameField: 'name' },
};

// ======================================================
// HELPERS
// ======================================================

// Helper function to get user's accessible properties
async function getUserAccessibleProperties(userId, userRole) {
  return await permissionService.getAccessiblePropertyIds(userId, userRole);
}

// Build the portal envelope returned on login/profile. This is the ONLY
// field we add to existing responses; everything the frontend already
// reads stays in place.
function buildPortalEnvelope(user) {
  if (user.role === 'LANDLORD' && user.landlordProfileId) {
    return { portal: 'LANDLORD', profileId: user.landlordProfileId };
  }
  if (user.role === 'TENANT' && user.tenantProfileId) {
    return { portal: 'TENANT', profileId: user.tenantProfileId };
  }
  if (user.role === 'SERVICE_PROVIDER' && user.serviceProviderProfileId) {
    return { portal: 'SERVICE_PROVIDER', profileId: user.serviceProviderProfileId };
  }
  return { portal: null, profileId: null };
}

// Reject non-active accounts at login with a role-appropriate message.
// ADMIN/MANAGER/USER are always ACTIVE by construction, so this branch
// is only reachable for portal users whose invitation is pending or
// whose account has been suspended/disabled. Existing staff flows are
// unaffected because their accountStatus is ACTIVE.
function assertAccountIsActive(user) {
  switch (user.accountStatus) {
    case 'ACTIVE':
      return null;
    case 'PENDING_INVITATION':
      return {
        status: 403,
        message: 'Your invitation has not been accepted yet. Please use the invitation link sent to your email to set your password.',
      };
    case 'SUSPENDED':
      return {
        status: 403,
        message: 'Your account has been suspended. Please contact your manager or administrator.',
      };
    case 'DISABLED':
      return {
        status: 403,
        message: 'Your account has been disabled. Please contact your manager or administrator.',
      };
    default:
      return { status: 403, message: 'Your account is not active.' };
  }
}

// Build an absolute link back to the frontend, using FRONTEND_URL.
// Throws if FRONTEND_URL is not configured — a relative invite link
// is useless inside an email, so we fail loud rather than send a
// broken link.
function buildFrontendLink(pathAndQuery) {
  const base = process.env.FRONTEND_URL;
  if (!base) {
    throw new Error(
      'FRONTEND_URL is not configured. Cannot build an absolute invitation link.'
    );
  }
  return `${base.replace(/\/$/, '')}${pathAndQuery}`;
}

// For MANAGER: verify they own (manage) the property related to the
// target profile. ADMIN: unconditional. USER and portal roles: denied.
async function canManageProfileForRole({ actorId, actorRole, role, profileId }) {
  if (actorRole === 'ADMIN') return true;
  if (actorRole !== 'MANAGER') return false;

  if (role === 'TENANT') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: profileId },
      select: { unit: { select: { property: { select: { managerId: true } } } } },
    });
    return tenant?.unit?.property?.managerId === actorId;
  }

  if (role === 'LANDLORD') {
    // Manager may only invite a landlord if they manage at least one
    // property owned by that landlord.
    const landlord = await prisma.landlord.findUnique({
      where: { id: profileId },
      select: { properties: { where: { managerId: actorId }, select: { id: true }, take: 1 } },
    });
    return !!landlord && landlord.properties.length > 0;
  }

  if (role === 'SERVICE_PROVIDER') {
    // Manager may only invite a provider already assigned (via the
    // new ServiceProviderProperty join table OR the legacy propertyId)
    // to one of their properties.
    const provider = await prisma.serviceProvider.findUnique({
      where: { id: profileId },
      select: {
        propertyId: true,
        property: { select: { managerId: true } },
        propertyLinks: {
          where: { isActive: true, property: { managerId: actorId } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!provider) return false;
    if (provider.property?.managerId === actorId) return true;
    return provider.propertyLinks.length > 0;
  }

  return false;
}

// ======================================================
// EXISTING HANDLERS (preserved)
// ======================================================

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

    const adminExists = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    if (adminExists) {
      return res.status(403).json({
        message: 'Admin already exists. Please use /api/auth/register-admin with authentication.',
        hint: 'You must be logged in as an existing admin to create additional admin accounts.'
      });
    }

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
        role: 'ADMIN',
        isApproved: true
      }
    });

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

    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

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

// @desc    Authenticate user (supports regular, managed, and portal users)
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

    if (!user || !(await comparePassword(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // ── Account status gate (new) ───────────────────────────────
    // ADMIN/MANAGER/USER are always ACTIVE; this only affects portal
    // accounts. PENDING_INVITATION, SUSPENDED, DISABLED all block login.
    const statusError = assertAccountIsActive(user);
    if (statusError) {
      return res.status(statusError.status).json({ message: statusError.message });
    }

    // ── Managed-user creator lineage checks (preserved) ─────────
    if (user.isManagedUser && user.createdByManagerId) {
      const creator = await prisma.user.findUnique({
        where: { id: user.createdByManagerId }
      });

      if (!creator) {
        return res.status(401).json({
          error: "Account access revoked - creator account no longer exists"
        });
      }

      if (creator.role !== 'MANAGER' && creator.role !== 'ADMIN') {
        return res.status(401).json({
          error: "Account access revoked - invalid creator role"
        });
      }

      if (creator.role === 'MANAGER') {
        if (!creator.isApproved) {
          return res.status(401).json({
            error: "Account access revoked - manager account is no longer approved"
          });
        }
        if (!creator.canManagerLogin) {
          return res.status(401).json({
            error: "Account access revoked - manager account has been disabled"
          });
        }
        // New: also reject if the manager's accountStatus is no longer ACTIVE.
        if (creator.accountStatus && creator.accountStatus !== 'ACTIVE') {
          return res.status(401).json({
            error: "Account access revoked - manager account is no longer active"
          });
        }
      }
    }

    if (!user.canManagerLogin) {
      return res.status(401).json({
        message: 'Your account has been disabled. Please contact your manager or admin.'
      });
    }

    if (user.role === 'MANAGER' && !user.isApproved) {
      return res.status(403).json({
        message: 'Your account is pending admin approval.'
      });
    }

    const isFirstLogin = user.isManagedUser && !user.lastLoginAt;

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const accessibleProperties = await getUserAccessibleProperties(user.id, user.role);
    const permissions = await permissionService.getUserPermissions(user.id);

    const token = generateToken(user.id, user.role);

    // ── Response: existing fields preserved; only `portal` is new ─
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
      portal: buildPortalEnvelope(user),   // NEW — frontend redirect hint
      token
    });

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
        createdAt: true,
        accountStatus: true,                 // NEW
        landlordProfileId: true,             // NEW
        tenantProfileId: true,               // NEW
        serviceProviderProfileId: true,      // NEW
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const accessibleProperties = await getUserAccessibleProperties(req.user.id, user.role);
    const permissions = await permissionService.getUserPermissions(req.user.id);

    res.json({
      ...user,
      accessibleProperties,
      permissions,
      portal: buildPortalEnvelope(user),     // NEW
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

    if (!['ADMIN', 'MANAGER', 'USER', ...PORTAL_ROLES].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    if (id === req.user.id && role !== 'ADMIN') {
      return res.status(400).json({ message: 'Cannot demote yourself' });
    }

    // ── Portal-role guards (new) ───────────────────────────────
    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (isPortalRole(role)) {
      // Promoting to a portal role requires a profile link to already
      // be present. Linking the profile happens through the invitation
      // flow, not via this endpoint — this endpoint only flips the role
      // field for an already-linked portal user.
      const { fkField } = PORTAL_PROFILE_MAP[role];
      if (!targetUser[fkField]) {
        return res.status(400).json({
          message: `Cannot set role to ${role}: no ${role} profile is linked to this user. Use the invitation flow to create a linked portal account.`,
        });
      }
    } else {
      // Promoting a portal user to a staff role requires clearing the
      // portal profile link first, otherwise the account can log in as
      // staff but still carry a lingering portal link.
      if (
        targetUser.landlordProfileId ||
        targetUser.tenantProfileId ||
        targetUser.serviceProviderProfileId
      ) {
        return res.status(400).json({
          message: 'Cannot set a staff role on a portal user. Clear the portal profile link first or use a dedicated admin endpoint.',
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        role,
        ...(role === 'ADMIN' && { isApproved: true }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isManagedUser: true,
        createdAt: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
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

    const user = await prisma.user.findUnique({ where: { id } });

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
      orderBy: { createdAt: 'desc' }
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

    // New: optional ?role= filter. Only accepts known Role enum values.
    const { role } = req.query;
    const where = {};
    if (role) {
      const allowed = ['ADMIN', 'MANAGER', 'USER', ...PORTAL_ROLES];
      if (!allowed.includes(role)) {
        return res.status(400).json({ message: 'Invalid role filter' });
      }
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isManagedUser: true,
        createdByManagerId: true,
        lastLoginAt: true,
        createdAt: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(users);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// NEW: PORTAL ONBOARDING / ACCOUNT MANAGEMENT
// ======================================================

// @desc    Invite a portal user (ADMIN globally, MANAGER for own properties)
// @route   POST /api/auth/invite-portal-user
// @access  Private (ADMIN, MANAGER)
export const invitePortalUser = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({ message: 'Only ADMIN or MANAGER can invite portal users' });
    }

    const { role, profileId, email, name } = req.body;

    if (!isPortalRole(role)) {
      return res.status(400).json({
        message: `role must be one of: ${PORTAL_ROLES.join(', ')}`
      });
    }
    if (!profileId) {
      return res.status(400).json({ message: 'profileId is required' });
    }
    if (!email) {
      return res.status(400).json({ message: 'email is required' });
    }

    const { fkField, model, nameField } = PORTAL_PROFILE_MAP[role];

    // Load profile + confirm it isn't already linked.
    // NOTE: the display-name column differs per model (Tenant.fullName vs
    // Landlord.name / ServiceProvider.name), so we select via `nameField`
    // rather than hard-coding `name`. The FK field (e.g. tenantProfileId)
    // lives on the User model, NOT on the profile model, so it is not
    // selected here.
    const profile = await prisma[model].findUnique({
      where: { id: profileId },
      select: {
        id: true,
        email: true,
        [nameField]: true,
        users: { select: { id: true }, take: 1 },
      },
    });
    if (!profile) {
      return res.status(404).json({ message: `${role} profile not found` });
    }
    if (profile.users && profile.users.length > 0) {
      return res.status(409).json({
        message: `A user account is already linked to this ${role} profile.`,
      });
    }

    // Normalize display name so the rest of the handler is uniform.
    const profileDisplayName = profile[nameField];

    // Manager scope check (ADMIN bypasses).
    const allowed = await canManageProfileForRole({
      actorId, actorRole, role, profileId
    });
    if (!allowed) {
      return res.status(403).json({
        message: 'You do not have permission to invite this user for the given profile.',
      });
    }

    // Email uniqueness (an invite cannot silently take over an existing account).
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return res.status(409).json({
        message: 'A user with this email already exists.',
      });
    }

    // Build invitation credentials. Password is a random opaque value
    // (hashed) that the user never sees — it's unusable until they
    // accept the invitation and set their own password. This is what
    // lets us create the User row now (with the profile link) without
    // inventing a plaintext temporary password.
    const { rawToken, hashedToken, expiresAt } = issueToken({ ttlHours: 72 });
    const opaquePassword = await hashPassword(`INVITE-${rawToken}`);

    const newUser = await prisma.user.create({
      data: {
        name: name || profileDisplayName,
        email,
        password: opaquePassword,
        role,
        isApproved: false,
        accountStatus: 'PENDING_INVITATION',
        canManagerLogin: false,           // cannot log in until accept
        passwordResetToken: hashedToken,  // reuse existing column for invite
        passwordResetExpires: expiresAt,
        [fkField]: profileId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        accountStatus: true,
        passwordResetExpires: true,
        [fkField]: true,
      }
    });

    // Build the ABSOLUTE invitation link from FRONTEND_URL. A relative
    // path is useless inside an email.
    const inviteLink = buildFrontendLink(
      `/accept-invitation?userId=${newUser.id}&token=${rawToken}`
    );

    // ── Send the invitation email via Resend ────────────────────
    // Failure here is non-fatal: the User row already exists and the
    // admin can retry via /resend-invitation. We surface the outcome
    // as `emailSent` so the UI can prompt a resend.
    const inviter = await prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    const emailResult = await sendInvitationEmail({
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      inviteLink,
      expiresAt,
      invitedBy: inviter?.name,
    });

    const includeDevToken = process.env.NODE_ENV !== 'production';

    res.status(201).json({
      success: true,
      message: emailResult.success
        ? `Portal user invited. An invitation email was sent to ${newUser.email}.`
        : 'Portal user invited, but the invitation email could not be sent. Use resend-invitation.',
      user: newUser,
      emailSent: emailResult.success,
      invitation: {
        link: inviteLink,
        expiresAt,
        // Never expose the raw token in production once email is live.
        ...(includeDevToken ? { token: rawToken } : {}),
      },
    });
  } catch (error) {
    console.error('Invite portal user error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Accept an invitation and set the user's own password
// @route   POST /api/auth/accept-invitation
// @access  Public (token-gated)
export const acceptInvitation = async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body;

    if (!userId || !token || !newPassword) {
      return res.status(400).json({
        message: 'userId, token, and newPassword are required'
      });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        passwordResetToken: true,
        passwordResetExpires: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'Invitation not found' });
    }
    if (user.accountStatus !== 'PENDING_INVITATION') {
      return res.status(400).json({ message: 'This invitation is no longer valid' });
    }
    if (!user.passwordResetToken || !user.passwordResetExpires) {
      return res.status(400).json({ message: 'Invitation token is missing' });
    }
    if (new Date(user.passwordResetExpires) < new Date()) {
      return res.status(400).json({ message: 'Invitation has expired' });
    }
    if (!verifyToken(token, user.passwordResetToken)) {
      return res.status(400).json({ message: 'Invalid invitation token' });
    }

    const hashedPassword = await hashPassword(newPassword);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        accountStatus: 'ACTIVE',
        isApproved: true,                 // portal accounts are pre-approved on acceptance
        canManagerLogin: true,
        passwordChangedAt: new Date(),
        passwordResetToken: null,
        passwordResetExpires: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      }
    });

    // Issue a session token immediately so the frontend can redirect
    // straight to the portal without a second login round-trip.
    const token_ = generateToken(updated.id, updated.role);

    res.json({
      success: true,
      message: 'Invitation accepted. Your password has been set.',
      user: updated,
      portal: buildPortalEnvelope(updated),
      token: token_,
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Resend an invitation (regenerate token + expiry + email)
// @route   POST /api/auth/resend-invitation
// @access  Private (ADMIN, MANAGER scoped)
export const resendInvitation = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({ message: 'Only ADMIN or MANAGER can resend invitations' });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!isPortalRole(user.role)) {
      return res.status(400).json({ message: 'Only portal users have invitations' });
    }
    if (user.accountStatus !== 'PENDING_INVITATION') {
      return res.status(400).json({ message: 'This account is not awaiting invitation acceptance' });
    }

    const { fkField } = PORTAL_PROFILE_MAP[user.role];
    const profileId = user[fkField];
    if (!profileId) {
      return res.status(400).json({ message: 'Portal profile link is missing' });
    }

    const allowed = await canManageProfileForRole({
      actorId, actorRole, role: user.role, profileId
    });
    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to resend this invitation.' });
    }

    const { rawToken, hashedToken, expiresAt } = issueToken({ ttlHours: 72 });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: expiresAt,
      }
    });

    // Absolute invite link from FRONTEND_URL.
    const inviteLink = buildFrontendLink(
      `/accept-invitation?userId=${user.id}&token=${rawToken}`
    );

    // ── Send the (re)invitation email via Resend ───────────────
    const inviter = await prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    const emailResult = await sendInvitationEmail({
      email: user.email,
      name: user.name,
      role: user.role,
      inviteLink,
      expiresAt,
      invitedBy: inviter?.name,
    });

    const includeDevToken = process.env.NODE_ENV !== 'production';
    res.json({
      success: true,
      message: emailResult.success
        ? `Invitation resent to ${user.email}.`
        : 'Invitation regenerated, but the email could not be sent.',
      emailSent: emailResult.success,
      invitation: {
        link: inviteLink,
        expiresAt,
        ...(includeDevToken ? { token: rawToken } : {}),
      },
    });
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Suspend a portal user
// @route   POST /api/auth/users/:id/suspend
// @access  Private (ADMIN, MANAGER scoped)
export const suspendPortalUser = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({ message: 'Only ADMIN or MANAGER can suspend users' });
    }

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      }
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (actorRole === 'MANAGER') {
      if (!isPortalRole(user.role)) {
        return res.status(403).json({ message: 'Managers can only suspend portal users' });
      }
      const { fkField } = PORTAL_PROFILE_MAP[user.role];
      const profileId = user[fkField];
      if (!profileId) {
        return res.status(400).json({ message: 'Portal profile link is missing' });
      }
      const allowed = await canManageProfileForRole({
        actorId, actorRole, role: user.role, profileId
      });
      if (!allowed) {
        return res.status(403).json({ message: 'You do not have permission to suspend this user.' });
      }
    } else {
      // ADMIN cannot suspend another ADMIN (only self-demote via role change).
      if (user.role === 'ADMIN') {
        return res.status(400).json({ message: 'Cannot suspend an ADMIN account' });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        accountStatus: 'SUSPENDED',
        canManagerLogin: false,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
      select: {
        id: true, name: true, email: true, role: true, accountStatus: true,
      }
    });

    res.json({ success: true, message: 'User suspended.', user: updated });
  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Reactivate a suspended user
// @route   POST /api/auth/users/:id/reactivate
// @access  Private (ADMIN, MANAGER scoped)
export const reactivatePortalUser = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({ message: 'Only ADMIN or MANAGER can reactivate users' });
    }

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        landlordProfileId: true,
        tenantProfileId: true,
        serviceProviderProfileId: true,
      }
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.accountStatus === 'PENDING_INVITATION') {
      return res.status(400).json({ message: 'Use the invitation flow to activate pending users.' });
    }

    if (actorRole === 'MANAGER') {
      if (!isPortalRole(user.role)) {
        return res.status(403).json({ message: 'Managers can only reactivate portal users' });
      }
      const { fkField } = PORTAL_PROFILE_MAP[user.role];
      const profileId = user[fkField];
      if (!profileId) {
        return res.status(400).json({ message: 'Portal profile link is missing' });
      }
      const allowed = await canManageProfileForRole({
        actorId, actorRole, role: user.role, profileId
      });
      if (!allowed) {
        return res.status(403).json({ message: 'You do not have permission to reactivate this user.' });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        accountStatus: 'ACTIVE',
        canManagerLogin: true,
      },
      select: {
        id: true, name: true, email: true, role: true, accountStatus: true,
      }
    });

    res.json({ success: true, message: 'User reactivated.', user: updated });
  } catch (error) {
    console.error('Reactivate user error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Request a password reset (public, token-gated)
// @route   POST /api/auth/forgot-password
// @access  Public
export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'email is required' });

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return 200 to avoid account-existence enumeration. If the
    // user exists and is ACTIVE, mint a reset token and (in dev) return it.
    if (user && user.accountStatus === 'ACTIVE') {
      const { rawToken, hashedToken, expiresAt } = issueToken({ ttlHours: 2 });
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: expiresAt,
        }
      });

      const includeDevToken = process.env.NODE_ENV !== 'production';
      return res.json({
        success: true,
        message: 'If an account with that email exists, a reset link has been sent.',
        ...(includeDevToken && {
          reset: {
            link: buildFrontendLink(`/reset-password?userId=${user.id}&token=${rawToken}`),
            expiresAt,
            token: rawToken,
          }
        }),
      });
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Reset password using a valid reset token
// @route   POST /api/auth/reset-password
// @access  Public (token-gated)
export const resetPassword = async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body;

    if (!userId || !token || !newPassword) {
      return res.status(400).json({ message: 'userId, token, and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accountStatus: true,
        passwordResetToken: true,
        passwordResetExpires: true,
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.accountStatus !== 'ACTIVE') {
      return res.status(400).json({ message: 'This account is not active. Please contact your administrator.' });
    }
    if (!user.passwordResetToken || !user.passwordResetExpires) {
      return res.status(400).json({ message: 'Reset token is missing' });
    }
    if (new Date(user.passwordResetExpires) < new Date()) {
      return res.status(400).json({ message: 'Reset token has expired' });
    }
    if (!verifyToken(token, user.passwordResetToken)) {
      return res.status(400).json({ message: 'Invalid reset token' });
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        passwordResetToken: null,
        passwordResetExpires: null,
      }
    });

    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({ message: error.message });
  }
};

// Unused imports preserved so upstream tooling doesn't break.
void jwt;
void hashToken;