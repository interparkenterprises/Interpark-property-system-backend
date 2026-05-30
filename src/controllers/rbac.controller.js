import prisma from "../lib/prisma.js";
import { hashPassword } from '../utils/hashPassword.js';
import { generateSecurePassword, sendWelcomeEmail } from '../utils/emailService.js';
import permissionService from "../services/permissionService.js";
import cacheService from "../services/cacheService.js";

// ======================================================
// HELPER FUNCTIONS FOR CACHE INVALIDATION
// ======================================================

// Invalidate cache for specific users
const invalidateUserCaches = async (userIds) => {
  if (!userIds || userIds.length === 0) return;
  const uniqueUserIds = [...new Set(userIds.filter(id => id))];
  cacheService.invalidateUsers(uniqueUserIds);
};

// Invalidate cache for all users with a specific role
const invalidateRoleCaches = async (roleId) => {
  if (!roleId) return;
  
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { roleId, isActive: true },
    select: { userId: true }
  });
  
  const userIds = assignments.map(a => a.userId);
  if (userIds.length > 0) {
    await invalidateUserCaches(userIds);
  }
};

// Invalidate cache for all users with specific permissions
const invalidatePermissionCaches = async (permissionIds) => {
  if (!permissionIds || permissionIds.length === 0) return;
  
  const rolesWithPermissions = await prisma.customRolePermission.findMany({
    where: { permissionId: { in: permissionIds } },
    include: {
      role: {
        include: {
          assignments: {
            where: { isActive: true },
            select: { userId: true }
          }
        }
      }
    }
  });
  
  const userIds = [...new Set(
    rolesWithPermissions.flatMap(rp => 
      rp.role.assignments.map(a => a.userId)
    )
  )];
  
  if (userIds.length > 0) {
    await invalidateUserCaches(userIds);
  }
};

// Invalidate cache for property access changes
const invalidatePropertyAccessCaches = async (propertyId, userIds = []) => {
  if (propertyId) {
    cacheService.invalidatePropertyAccess(propertyId);
  }
  if (userIds.length > 0) {
    await invalidateUserCaches(userIds);
  }
};

// ======================================================
// PERMISSION MANAGEMENT
// ======================================================

// @desc    Get all permissions
// @route   GET /api/rbac/permissions
// @access  Private/Admin/Manager
export const getPermissions = async (req, res) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { category: 'asc' }
    });
    
    res.json(permissions);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create permission (Admin only)
// @route   POST /api/rbac/permissions
// @access  Private/Admin
export const createPermission = async (req, res) => {
  try {
    // Handle both single object and array
    const permissionsData = Array.isArray(req.body) ? req.body : [req.body];
    
    const createdPermissions = await prisma.$transaction(
      permissionsData.map(({ code, name, description, category, scope }) => 
        prisma.permission.create({
          data: {
            code: code?.toUpperCase(),
            name,
            description,
            category,
            scope: scope || 'PROPERTY'
          }
        })
      )
    );
    
    // Invalidate caches for users with roles that might include these permissions
    const permissionIds = createdPermissions.map(p => p.id);
    await invalidatePermissionCaches(permissionIds);
    
    res.status(201).json(createdPermissions);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update permission (Admin only)
// @route   PUT /api/rbac/permissions/:id
// @access  Private/Admin
export const updatePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, scope } = req.body;

    // Check if permission exists
    const existingPermission = await prisma.permission.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            role: {
              include: {
                assignments: {
                  where: { isActive: true },
                  select: { userId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!existingPermission) {
      return res.status(404).json({ message: 'Permission not found' });
    }

    // Update permission
    const updatedPermission = await prisma.permission.update({
      where: { id },
      data: {
        name: name || existingPermission.name,
        description: description !== undefined ? description : existingPermission.description,
        category: category || existingPermission.category,
        scope: scope || existingPermission.scope
      }
    });

    // Get affected users for cache invalidation
    const affectedUserIds = [];
    for (const rolePerm of existingPermission.rolePermissions) {
      for (const assignment of rolePerm.role.assignments) {
        if (!affectedUserIds.includes(assignment.userId)) {
          affectedUserIds.push(assignment.userId);
        }
      }
    }

    // Invalidate caches for affected users
    if (affectedUserIds.length > 0) {
      await invalidateUserCaches(affectedUserIds);
    }

    // Log audit
    await prisma.rBACAuditLog.create({
      data: {
        action: 'UPDATE_PERMISSION',
        performedBy: req.user.id,
        changes: {
          permissionId: id,
          permissionCode: existingPermission.code,
          oldValues: {
            name: existingPermission.name,
            description: existingPermission.description,
            category: existingPermission.category,
            scope: existingPermission.scope
          },
          newValues: {
            name: updatedPermission.name,
            description: updatedPermission.description,
            category: updatedPermission.category,
            scope: updatedPermission.scope
          }
        }
      }
    }).catch(err => console.error('Audit log failed:', err.message));

    res.json({
      success: true,
      message: 'Permission updated successfully',
      data: updatedPermission
    });
  } catch (error) {
    console.error('Update permission error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete permission (Admin only)
// @route   DELETE /api/rbac/permissions/:id
// @access  Private/Admin
export const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { force = false } = req.body;

    // Check if permission exists with relations
    const existingPermission = await prisma.permission.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            role: {
              include: {
                assignments: {
                  where: { isActive: true },
                  select: { userId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!existingPermission) {
      return res.status(404).json({ message: 'Permission not found' });
    }

    // Check if permission is in use
    if (existingPermission.rolePermissions.length > 0 && !force) {
      const rolesUsing = [...new Set(existingPermission.rolePermissions.map(rp => rp.role.name))];
      return res.status(400).json({
        message: `Cannot delete permission. It is used by ${existingPermission.rolePermissions.length} role(s): ${rolesUsing.join(', ')}. Use force=true to delete anyway (this will remove the permission from all roles).`,
        rolesCount: existingPermission.rolePermissions.length,
        roles: rolesUsing,
        forceRequired: true
      });
    }

    // Get affected users for cache invalidation
    const affectedUserIds = [];
    for (const rolePerm of existingPermission.rolePermissions) {
      for (const assignment of rolePerm.role.assignments) {
        if (!affectedUserIds.includes(assignment.userId)) {
          affectedUserIds.push(assignment.userId);
        }
      }
    }

    // Delete or just remove from roles
    await prisma.$transaction(async (tx) => {
      // Remove permission from all roles first
      if (existingPermission.rolePermissions.length > 0) {
        await tx.customRolePermission.deleteMany({
          where: { permissionId: id }
        });
      }

      // Then delete the permission
      await tx.permission.delete({
        where: { id }
      });

      // Log audit
      await tx.rBACAuditLog.create({
        data: {
          action: 'DELETE_PERMISSION',
          performedBy: req.user.id,
          changes: {
            permissionId: id,
            permissionCode: existingPermission.code,
            permissionName: existingPermission.name,
            wasInUse: existingPermission.rolePermissions.length > 0,
            rolesAffected: existingPermission.rolePermissions.length
          }
        }
      });
    });

    // Invalidate caches for affected users
    if (affectedUserIds.length > 0) {
      await invalidateUserCaches(affectedUserIds);
    }

    res.json({
      success: true,
      message: `Permission "${existingPermission.code}" deleted successfully${existingPermission.rolePermissions.length > 0 ? ' and removed from all roles' : ''}`,
      data: {
        deletedPermission: {
          id: existingPermission.id,
          code: existingPermission.code,
          name: existingPermission.name
        },
        rolesAffected: existingPermission.rolePermissions.length
      }
    });
  } catch (error) {
    console.error('Delete permission error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single permission by ID
// @route   GET /api/rbac/permissions/:id
// @access  Private/Admin
export const getPermissionById = async (req, res) => {
  try {
    const { id } = req.params;

    const permission = await prisma.permission.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
                _count: {
                  select: { assignments: { where: { isActive: true } } }
                }
              }
            }
          }
        }
      }
    });

    if (!permission) {
      return res.status(404).json({ message: 'Permission not found' });
    }

    res.json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Get permission by ID error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// CUSTOM ROLE MANAGEMENT
// ======================================================

// @desc    Get all custom roles (for current manager)
// @route   GET /api/rbac/roles
// @access  Private/Manager/Admin
export const getCustomRoles = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = {};
    
    if (userRole === 'MANAGER') {
      whereClause = { createdById: userId };
    }
    
    const roles = await prisma.customRole.findMany({
      where: whereClause,
      include: {
        permissions: {
          include: { permission: true }
        },
        propertyAccess: {
          include: { property: true }
        },
        assignments: {
          where: { isActive: true },
          include: { user: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(roles);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create custom role (Manager only)
// @route   POST /api/rbac/roles
// @access  Private/Manager
export const createCustomRole = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { name, description, permissionIds, propertyIds } = req.body;
    
    // Validation
    if (!propertyIds || !Array.isArray(propertyIds)) {
      return res.status(400).json({ error: 'propertyIds array is required' });
    }
    if (!permissionIds || !Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'permissionIds array is required' });
    }
    
    // Remove duplicates
    const uniquePermissionIds = [...new Set(permissionIds)];
    const uniquePropertyIds = [...new Set(propertyIds)];
    
    // Verify manager's properties (outside transaction)
    const managerProperties = await prisma.property.findMany({
      where: { managerId },
      select: { id: true }
    });
    const managerPropertyIds = new Set(managerProperties.map(p => p.id));
    
    const invalidProperties = uniquePropertyIds.filter(id => !managerPropertyIds.has(id));
    if (invalidProperties.length > 0) {
      return res.status(400).json({ 
        error: `You don't manage properties: ${invalidProperties.join(', ')}` 
      });
    }
    
    // Step 1: Create the role
    const newRole = await prisma.customRole.create({
      data: {
        name,
        description,
        createdById: managerId
      }
    });
    
    // Step 2: Create permissions and property access in parallel
    const operations = [];
    
    if (uniquePermissionIds.length > 0) {
      operations.push(
        prisma.customRolePermission.createMany({
          data: uniquePermissionIds.map(permissionId => ({
            roleId: newRole.id,
            permissionId,
            grantedById: managerId
          })),
          skipDuplicates: true
        })
      );
    }
    
    if (uniquePropertyIds.length > 0) {
      operations.push(
        prisma.customRolePropertyAccess.createMany({
          data: uniquePropertyIds.map(propertyId => ({
            roleId: newRole.id,
            propertyId,
            createdBy: managerId
          })),
          skipDuplicates: true
        })
      );
    }
    
    // Execute all operations in parallel
    if (operations.length > 0) {
      await Promise.all(operations);
    }
    
    // Step 3: Fetch the complete role
    const completeRole = await prisma.customRole.findUnique({
      where: { id: newRole.id },
      include: {
        permissions: {
          include: { permission: true }
        },
        propertyAccess: {
          include: { property: true }
        }
      }
    });
    
    // Log audit (non-blocking)
    prisma.rBACAuditLog.create({
      data: {
        action: 'CREATE_CUSTOM_ROLE',
        performedBy: managerId,
        targetRole: newRole.id,
        changes: { name, description, permissionIds: uniquePermissionIds, propertyIds: uniquePropertyIds }
      }
    }).catch(err => {
      console.error('Audit log failed:', err.message);
    });
    
    res.status(201).json({
      success: true,
      message: 'Custom role created successfully',
      data: completeRole
    });
    
  } catch (error) {
    console.error('Create custom role error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update custom role
// @route   PUT /api/rbac/roles/:roleId
// @access  Private/Manager
export const updateCustomRole = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { roleId } = req.params;
    const { name, description, permissionIds, propertyIds, isActive } = req.body;
    
    // Verify role belongs to manager
    const existingRole = await prisma.customRole.findFirst({
      where: { id: roleId, createdById: managerId },
      include: {
        permissions: { select: { permissionId: true } },
        propertyAccess: { select: { propertyId: true } }
      }
    });
    
    if (!existingRole) {
      return res.status(404).json({ error: 'Role not found or not owned by you' });
    }
    
    // Update role with diff operations
    const updatedRole = await prisma.$transaction(async (tx) => {
      // Update basic info
      const role = await tx.customRole.update({
        where: { id: roleId },
        data: {
          name: name || undefined,
          description: description !== undefined ? description : undefined
        }
      });
      
      // Diff permissions (only if provided)
      if (permissionIds) {
        const currentPermissionIds = existingRole.permissions.map(p => p.permissionId);
        const newPermissionIds = permissionIds;
        
        // Find what to add and remove
        const toAdd = newPermissionIds.filter(id => !currentPermissionIds.includes(id));
        const toRemove = currentPermissionIds.filter(id => !newPermissionIds.includes(id));
        
        // Remove permissions no longer needed
        if (toRemove.length > 0) {
          await tx.customRolePermission.deleteMany({
            where: {
              roleId,
              permissionId: { in: toRemove }
            }
          });
        }
        
        // Add new permissions
        if (toAdd.length > 0) {
          await tx.customRolePermission.createMany({
            data: toAdd.map(permissionId => ({
              roleId,
              permissionId,
              grantedById: managerId
            }))
          });
        }
      }
      
      // Diff property access (only if provided)
      if (propertyIds) {
        const currentPropertyIds = existingRole.propertyAccess.map(p => p.propertyId);
        const newPropertyIds = propertyIds;
        
        const toAddProperties = newPropertyIds.filter(id => !currentPropertyIds.includes(id));
        const toRemoveProperties = currentPropertyIds.filter(id => !newPropertyIds.includes(id));
        
        // Remove property access no longer needed
        if (toRemoveProperties.length > 0) {
          await tx.customRolePropertyAccess.deleteMany({
            where: {
              roleId,
              propertyId: { in: toRemoveProperties }
            }
          });
        }
        
        // Add new property access
        if (toAddProperties.length > 0) {
          await tx.customRolePropertyAccess.createMany({
            data: toAddProperties.map(propertyId => ({
              roleId,
              propertyId,
              createdBy: managerId
            }))
          });
        }
      }
      
      // Update role assignments status if provided
      if (isActive !== undefined) {
        await tx.userRoleAssignment.updateMany({
          where: { roleId },
          data: { isActive }
        });
      }
      
      await tx.rBACAuditLog.create({
        data: {
          action: 'UPDATE_CUSTOM_ROLE',
          performedBy: managerId,
          targetRole: roleId,
          changes: { name, description, permissionIds, propertyIds, isActive }
        }
      });
      
      return role;
    });
    
    // Invalidate caches for all users with this role
    await invalidateRoleCaches(roleId);
    
    res.json({
      success: true,
      message: 'Custom role updated successfully',
      data: updatedRole
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete custom role
// @route   DELETE /api/rbac/roles/:roleId
// @access  Private/Manager
export const deleteCustomRole = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { roleId } = req.params;
    
    // Verify role belongs to manager
    const existingRole = await prisma.customRole.findFirst({
      where: { id: roleId, createdById: managerId },
      include: { 
        assignments: {
          where: { isActive: true },
          select: { userId: true }
        }
      }
    });
    
    if (!existingRole) {
      return res.status(404).json({ error: 'Role not found or not owned by you' });
    }
    
    if (existingRole.assignments.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete role with active assignments. Remove assignments first.' 
      });
    }
    
    // Get affected users before deletion
    const affectedUserIds = existingRole.assignments.map(a => a.userId);
    
    await prisma.$transaction(async (tx) => {
      await tx.customRolePermission.deleteMany({ where: { roleId } });
      await tx.customRolePropertyAccess.deleteMany({ where: { roleId } });
      await tx.customRole.delete({ where: { id: roleId } });
      
      await tx.rBACAuditLog.create({
        data: {
          action: 'DELETE_CUSTOM_ROLE',
          performedBy: managerId,
          targetRole: roleId,
          changes: { name: existingRole.name }
        }
      });
    });
    
    // Invalidate caches for affected users
    await invalidateUserCaches(affectedUserIds);
    
    res.json({ success: true, message: 'Custom role deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// MANAGED USER MANAGEMENT
// ======================================================

// @desc    Create managed user with custom role (role already has property access)
// @route   POST /api/rbac/users
// @access  Private/Manager
export const createManagedUser = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { name, email, roleId, expiresAt } = req.body;

    // OPTIMIZATION 1: Run parallel queries
    const [role, existingUser] = await Promise.all([
      prisma.customRole.findFirst({
        where: { id: roleId, createdById: managerId },
        select: {
          id: true,
          name: true,
          propertyAccess: {
            where: { isActive: true },
            select: { propertyId: true },
            take: 1000
          }
        }
      }),
      prisma.user.findUnique({ 
        where: { email },
        select: { id: true }
      })
    ]);

    if (!role) {
      return res.status(400).json({ error: 'Invalid role - not created by you' });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const tempPassword = generateSecurePassword();
    const hashedPassword = await hashPassword(tempPassword);
    const rolePropertyIds = role.propertyAccess.map(p => p.propertyId);

    // OPTIMIZATION 2: Lighter transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: 'USER',
          isApproved: true,
          isManagedUser: true,
          createdByManagerId: managerId,
          canManagerLogin: true
        },
        select: { id: true, name: true, email: true }
      });

      await tx.userRoleAssignment.create({
        data: {
          userId: user.id,
          roleId,
          assignedBy: managerId,
          isActive: true,
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });

      return user;
    });

    // IMMEDIATE RESPONSE
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: {
          id: role.id,
          name: role.name,
          propertyAccessCount: rolePropertyIds.length
        }
      },
      temporaryPassword: tempPassword
    });

    // 🚀 BACKGROUND TASKS - Optimized for Resend
    const backgroundTasks = async () => {
      // Get manager info once (reused across tasks)
      const manager = await prisma.user.findUnique({
        where: { id: managerId },
        select: { name: true }
      }).catch(err => {
        console.error('Failed to fetch manager:', err.message);
        return { name: 'Manager' };
      });

      // Prepare email data
      const emailData = {
        email: newUser.email,
        name: newUser.name,
        temporaryPassword: tempPassword,
        role: role.name,
        loginUrl: `${process.env.FRONTEND_URL}/login`,
        createdBy: manager?.name || 'Manager'
      };

      // Run all background tasks in parallel
      await Promise.allSettled([
        // Audit log
        prisma.rBACAuditLog.create({
          data: {
            action: 'CREATE_MANAGED_USER',
            performedBy: managerId,
            targetUser: newUser.id,
            changes: {
              name,
              email,
              roleId,
              inheritedProperties: rolePropertyIds,
              expiresAt
            }
          }
        }).catch(err => console.error('Audit log failed:', err.message)),
        
        // Welcome email with Resend (faster and more reliable)
        sendWelcomeEmail(emailData).catch(err => 
          console.error('Welcome email failed:', err.message)
        ),
        
        // Cache invalidation
        invalidateUserCaches([newUser.id]).catch(err => 
          console.error('Cache invalidation failed:', err.message)
        )
      ]);
    };

    // Use queueMicrotask for faster response
    queueMicrotask(() => backgroundTasks());

  } catch (error) {
    console.error('Create managed user error:', error);
    if (!res.headersSent) {
      res.status(400).json({ message: error.message });
    }
  }
};

// @desc    Get managed users
// @route   GET /api/rbac/users
// @access  Private/Manager
export const getManagedUsers = async (req, res) => {
  try {
    const managerId = req.user.id;
    
    const users = await prisma.user.findMany({
      where: {
        createdByManagerId: managerId,
        isManagedUser: true
      },
      include: {
        userAssignments: {
          where: { isActive: true },
          include: {
            role: {
              include: {
                propertyAccess: {  // Include role's property access
                  where: { isActive: true },
                  include: { property: true }
                },
                permissions: {  // Include role's permissions
                  include: { permission: true }
                }
              }
            }
          }
        },
        userPropertyAccess: {
          where: { isActive: true },
          include: { property: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(users);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update managed user access (role-based, properties inherited from role)
// @route   PUT /api/rbac/users/:userId/access
// @access  Private/Manager
export const updateManagedUserAccess = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    const { roleId, expiresAt, isActive } = req.body;
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      },
      include: {
        userAssignments: {
          where: { isActive: true },
          select: { roleId: true }
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found or not managed by you' });
    }
    
    // Validate new role if provided
    let role = null;
    let rolePropertyIds = [];
    
    if (roleId) {
      role = await prisma.customRole.findFirst({
        where: { id: roleId, createdById: managerId },
        include: {
          propertyAccess: {
            where: { isActive: true },
            select: { propertyId: true }
          }
        }
      });
      
      if (!role) {
        return res.status(400).json({ error: 'Invalid role - not created by you' });
      }
      
      rolePropertyIds = role.propertyAccess.map(p => p.propertyId);
    }
    
    const currentRoleId = user.userAssignments[0]?.roleId;
    const changes = { 
      oldRoleId: currentRoleId,
      newRoleId: roleId, 
      expiresAt, 
      isActive 
    };
    
    // Execute transaction - only role assignment updates
    await prisma.$transaction(async (tx) => {
      // Update role assignment
      if (roleId) {
        // Deactivate current active roles
        await tx.userRoleAssignment.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false }
        });
        
        // Check if assignment already exists (including inactive)
        const existingAssignment = await tx.userRoleAssignment.findUnique({
          where: { userId_roleId: { userId, roleId } }
        });
        
        if (existingAssignment) {
          // Reactivate existing assignment
          await tx.userRoleAssignment.update({
            where: { id: existingAssignment.id },
            data: {
              isActive: true,
              assignedBy: managerId,
              expiresAt: expiresAt ? new Date(expiresAt) : null,
              assignedAt: new Date()
            }
          });
        } else {
          // Create new assignment
          await tx.userRoleAssignment.create({
            data: {
              userId,
              roleId,
              assignedBy: managerId,
              isActive: true,
              expiresAt: expiresAt ? new Date(expiresAt) : null
            }
          });
        }
      } else if (expiresAt !== undefined) {
        // Update expiry on current active role
        await tx.userRoleAssignment.updateMany({
          where: { userId, isActive: true },
          data: { expiresAt: expiresAt ? new Date(expiresAt) : null }
        });
      }
      
      // Update user login status
      if (isActive !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { canManagerLogin: isActive }
        });
      }
      
      // NOTE: No direct property access management!
      // Property access is always inherited from the assigned role
      // If you need to grant additional properties beyond the role,
      // use the grantAdditionalPropertyAccess endpoint
    }, {
      timeout: 15000
    });
    
    // Log audit
    await prisma.rBACAuditLog.create({
      data: {
        action: 'UPDATE_MANAGED_USER_ACCESS',
        performedBy: managerId,
        targetUser: userId,
        changes: {
          ...changes,
          inheritedProperties: rolePropertyIds,
          note: 'Property access is inherited from role'
        }
      }
    }).catch(err => {
      console.error('Audit log failed:', err.message);
    });
    
    // Invalidate cache
    await invalidateUserCaches([userId]);
    
    res.json({ 
      success: true, 
      message: roleId 
        ? `User role updated to "${role?.name}" with ${rolePropertyIds.length} property(ies) inherited`
        : 'User access updated successfully',
      data: roleId ? {
        roleId,
        roleName: role?.name,
        inheritedPropertyCount: rolePropertyIds.length
      } : null
    });
    
  } catch (error) {
    console.error('Update managed user access error:', error);
    res.status(400).json({ message: error.message });
  }
};
// @desc    Delete managed user
// @route   DELETE /api/rbac/users/:userId
// @access  Private/Manager
export const deleteManagedUser = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found or not managed by you' });
    }
    
    await prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { userId } });
      await tx.propertyAccess.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      
      await tx.rBACAuditLog.create({
        data: {
          action: 'DELETE_MANAGED_USER',
          performedBy: managerId,
          targetUser: userId,
          changes: { name: user.name, email: user.email }
        }
      });
    });
    
    // Invalidate cache for the deleted user
    await invalidateUserCaches([userId]);
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// GRANULAR USER ACCESS MANAGEMENT
// ======================================================

// @desc    Revoke specific property access from a managed user
// @route   DELETE /api/rbac/users/:userId/property-access/:propertyId
// @access  Private/Manager
export const revokePropertyAccess = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId, propertyId } = req.params;
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found or not managed by you' });
    }
    
    // Verify property belongs to manager
    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        managerId: managerId
      }
    });
    
    if (!property) {
      return res.status(404).json({ error: 'Property not found or not managed by you' });
    }
    
    // Revoke access by deactivating the property access record
    const revokedAccess = await prisma.propertyAccess.updateMany({
      where: {
        userId: userId,
        propertyId: propertyId,
        isActive: true
      },
      data: {
        isActive: false
      }
    });
    
    if (revokedAccess.count === 0) {
      return res.status(404).json({ error: 'No active access found for this property' });
    }
    
    // Log audit
    await prisma.rBACAuditLog.create({
      data: {
        action: 'REVOKE_PROPERTY_ACCESS',
        performedBy: managerId,
        targetUser: userId,
        targetProperty: propertyId,
        changes: { action: 'revoked', propertyId, propertyName: property.name }
      }
    });
    
    // Invalidate caches for the user and property
    await invalidatePropertyAccessCaches(propertyId, [userId]);
    
    res.json({
      success: true,
      message: `Access to ${property.name} revoked successfully`
    });
  } catch (error) {
    console.error('Revoke property access error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Grant additional property access to a managed user
// @route   POST /api/rbac/users/:userId/property-access
// @access  Private/Manager
export const grantAdditionalPropertyAccess = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    const { propertyIds, canEdit, canExport, expiresAt } = req.body;
    
    if (!propertyIds || !Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ error: 'propertyIds array is required' });
    }
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true,
        canManagerLogin: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found, not managed by you, or is disabled' });
    }
    
    // Verify all properties belong to manager
    const managerProperties = await prisma.property.findMany({
      where: { managerId }
    });
    const managerPropertyIds = managerProperties.map(p => p.id);
    
    const invalidProperties = propertyIds.filter(id => !managerPropertyIds.includes(id));
    if (invalidProperties.length > 0) {
      return res.status(400).json({ 
        error: `You don't manage properties: ${invalidProperties.join(', ')}` 
      });
    }
    
    // Get user's current role permissions
    const currentRoleAssignment = await prisma.userRoleAssignment.findFirst({
      where: { userId, isActive: true },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });
    
    const grantedAccess = [];
    
    // Grant access to each property
    for (const propertyId of propertyIds) {
      // Check if access already exists
      const existingAccess = await prisma.propertyAccess.findFirst({
        where: {
          userId: userId,
          propertyId: propertyId
        }
      });
      
      if (existingAccess) {
        // Reactivate and update existing access
        const updated = await prisma.propertyAccess.update({
          where: { id: existingAccess.id },
          data: {
            isActive: true,
            canView: true,
            canEdit: canEdit || existingAccess.canEdit,
            canExport: canExport || existingAccess.canExport,
            expiresAt: expiresAt ? new Date(expiresAt) : existingAccess.expiresAt,
            grantedBy: managerId,
            grantedAt: new Date()
          }
        });
        grantedAccess.push(updated);
      } else {
        // Create new access
        const created = await prisma.propertyAccess.create({
          data: {
            userId: userId,
            propertyId: propertyId,
            grantedBy: managerId,
            isActive: true,
            canView: true,
            canEdit: canEdit || false,
            canExport: canExport || false,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            roleId: currentRoleAssignment?.roleId || null
          }
        });
        grantedAccess.push(created);
      }
    }
    
    // Log audit
    await prisma.rBACAuditLog.create({
      data: {
        action: 'GRANT_ADDITIONAL_PROPERTY_ACCESS',
        performedBy: managerId,
        targetUser: userId,
        changes: { 
          propertyIds, 
          canEdit, 
          canExport, 
          expiresAt,
          propertyNames: managerProperties
            .filter(p => propertyIds.includes(p.id))
            .map(p => p.name)
        }
      }
    });
    
    // Invalidate caches for the user and all affected properties
    for (const propertyId of propertyIds) {
      await invalidatePropertyAccessCaches(propertyId, [userId]);
    }
    
    res.json({
      success: true,
      message: `Additional access granted to ${propertyIds.length} property(ies)`,
      data: grantedAccess
    });
  } catch (error) {
    console.error('Grant additional access error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update user's permission levels for specific property
// @route   PUT /api/rbac/users/:userId/property-access/:propertyId/permissions
// @access  Private/Manager
export const updatePropertyPermissions = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId, propertyId } = req.params;
    const { canView, canEdit, canDelete, canExport, customPermissions } = req.body;
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found or not managed by you' });
    }
    
    // Verify property belongs to manager
    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        managerId: managerId
      }
    });
    
    if (!property) {
      return res.status(404).json({ error: 'Property not found or not managed by you' });
    }
    
    // Update permissions
    const updatedAccess = await prisma.propertyAccess.updateMany({
      where: {
        userId: userId,
        propertyId: propertyId,
        isActive: true
      },
      data: {
        canView: canView !== undefined ? canView : undefined,
        canEdit: canEdit !== undefined ? canEdit : undefined,
        canDelete: canDelete !== undefined ? canDelete : undefined,
        canExport: canExport !== undefined ? canExport : undefined,
        customPermissions: customPermissions || undefined
      }
    });
    
    if (updatedAccess.count === 0) {
      return res.status(404).json({ error: 'No active access found for this property' });
    }
    
    // Log audit
    await prisma.rBACAuditLog.create({
      data: {
        action: 'UPDATE_PROPERTY_PERMISSIONS',
        performedBy: managerId,
        targetUser: userId,
        targetProperty: propertyId,
        changes: { canView, canEdit, canDelete, canExport, customPermissions }
      }
    });
    
    // Invalidate caches for the user and property
    await invalidatePropertyAccessCaches(propertyId, [userId]);
    
    res.json({
      success: true,
      message: `Permissions for ${property.name} updated successfully`
    });
  } catch (error) {
    console.error('Update property permissions error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Disable managed user (revoke all access)
// @route   POST /api/rbac/users/:userId/disable
// @access  Private/Manager
export const disableManagedUser = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    const { reason } = req.body;

    // --------------------------------------------------
    // 1. VERIFY USER (OUTSIDE TRANSACTION)
    // --------------------------------------------------
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true,
        canManagerLogin: true
      },
      include: {
        userPropertyAccess: {
          where: { isActive: true },
          select: { propertyId: true }
        },
        userAssignments: {
          where: { isActive: true },
          select: { roleId: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found, not managed by you, or already disabled'
      });
    }

    // --------------------------------------------------
    // 2. FAST TRANSACTION (NO CALLBACK → NO TIMEOUT ISSUE)
    // --------------------------------------------------
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { canManagerLogin: false }
      }),

      prisma.propertyAccess.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false }
      }),

      prisma.userRoleAssignment.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false }
      })
    ]);

    // --------------------------------------------------
    // 3. AUDIT LOG (NON-CRITICAL → OUTSIDE TRANSACTION)
    // --------------------------------------------------
    await prisma.rBACAuditLog.create({
      data: {
        action: 'DISABLE_MANAGED_USER',
        performedBy: managerId,
        targetUser: userId,
        changes: {
          reason: reason || 'No reason provided',
          disabledProperties: user.userPropertyAccess.map(p => p.propertyId),
          disabledRole: user.userAssignments[0]?.roleId || null
        }
      }
    }).catch(err => {
      console.error('Audit log failed:', err.message);
    });

    // --------------------------------------------------
    // 4. CACHE INVALIDATION
    // --------------------------------------------------
    permissionService.invalidateUserCache(userId);

    // --------------------------------------------------
    // 5. RESPONSE
    // --------------------------------------------------
    res.json({
      success: true,
      message: `User ${user.name} has been disabled and all access revoked`
    });

  } catch (error) {
    console.error('Disable user error:', error);
    res.status(400).json({ message: error.message });
  }
};
// @desc    Enable/re-enable managed user
// @route   POST /api/rbac/users/:userId/enable
// @access  Private/Manager
export const enableManagedUser = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;

    // --------------------------------------------------
    // 1. VERIFY USER (OUTSIDE TRANSACTION)
    // --------------------------------------------------
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true,
        canManagerLogin: false
      },
      include: {
        userPropertyAccess: {
          where: { isActive: false },
          select: { id: true, propertyId: true }
        },
        userAssignments: {
          where: { isActive: false },
          orderBy: { assignedAt: 'desc' }, // ✅ FIXED FIELD
          select: { id: true, roleId: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found, not managed by you, or already enabled'
      });
    }

    if (user.userAssignments.length === 0) {
      return res.status(400).json({
        error: 'Cannot enable user: No role assignment found. Please assign a role first.'
      });
    }

    const latestRoleAssignment = user.userAssignments[0];

    // --------------------------------------------------
    // 2. FAST TRANSACTION (ARRAY-BASED)
    // --------------------------------------------------
    const queries = [
      prisma.user.update({
        where: { id: userId },
        data: { canManagerLogin: true }
      }),

      prisma.userRoleAssignment.update({
        where: { id: latestRoleAssignment.id },
        data: { isActive: true }
      })
    ];

    if (user.userPropertyAccess.length > 0) {
      queries.push(
        prisma.propertyAccess.updateMany({
          where: {
            id: { in: user.userPropertyAccess.map(p => p.id) }
          },
          data: { isActive: true }
        })
      );
    }

    await prisma.$transaction(queries);

    // --------------------------------------------------
    // 3. AUDIT LOG (OUTSIDE TRANSACTION)
    // --------------------------------------------------
    await prisma.rBACAuditLog.create({
      data: {
        action: 'ENABLE_MANAGED_USER',
        performedBy: managerId,
        targetUser: userId,
        changes: {
          restoredRole: latestRoleAssignment.roleId,
          restoredProperties: user.userPropertyAccess.map(p => p.propertyId)
        }
      }
    }).catch(err => {
      console.error('Audit log failed:', err.message);
    });

    // --------------------------------------------------
    // 4. CACHE INVALIDATION
    // --------------------------------------------------
    permissionService.invalidateUserCache(userId);

    // --------------------------------------------------
    // 5. RESPONSE
    // --------------------------------------------------
    res.json({
      success: true,
      message: `User has been re-enabled with previous access restored`,
      data: {
        roleRestored: latestRoleAssignment.roleId,
        propertiesRestored: user.userPropertyAccess.length
      }
    });

  } catch (error) {
    console.error('Enable user error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get user's current access details
// @route   GET /api/rbac/users/:userId/access-details
// @access  Private/Manager
export const getUserAccessDetails = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    
    // Verify user belongs to manager
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        canManagerLogin: true,
        isManagedUser: true,
        createdAt: true,
        lastLoginAt: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found or not managed by you' });
    }
    
    // Get current role assignment
    const roleAssignment = await prisma.userRoleAssignment.findFirst({
      where: { userId, isActive: true },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            },
            propertyAccess: {
              where: { isActive: true },
              include: { property: true }
            }
          }
        }
      }
    });
    
    // Get all property access (including inactive)
    const propertyAccess = await prisma.propertyAccess.findMany({
      where: { userId },
      include: { property: true },
      orderBy: { grantedAt: 'desc' }
    });
    
    // Get audit history for this user
    const auditLogs = await prisma.rBACAuditLog.findMany({
      where: { targetUser: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        performer: {
          select: { name: true, email: true }
        }
      }
    });
    
    res.json({
      user,
      currentAccess: {
        isEnabled: user.canManagerLogin,
        role: roleAssignment ? {
          id: roleAssignment.role.id,
          name: roleAssignment.role.name,
          description: roleAssignment.role.description,
          expiresAt: roleAssignment.expiresAt,
          permissions: roleAssignment.role.permissions.map(p => ({
            code: p.permission.code,
            name: p.permission.name,
            category: p.permission.category
          })),
          defaultProperties: roleAssignment.role.propertyAccess.map(p => ({
            id: p.property.id,
            name: p.property.name
          }))
        } : null,
        properties: propertyAccess.map(access => ({
          id: access.property.id,
          name: access.property.name,
          isActive: access.isActive,
          canView: access.canView,
          canEdit: access.canEdit,
          canDelete: access.canDelete,
          canExport: access.canExport,
          grantedAt: access.grantedAt,
          expiresAt: access.expiresAt
        }))
      },
      auditHistory: auditLogs
    });
  } catch (error) {
    console.error('Get user access details error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Bulk update user access (replace all access)
// @route   PUT /api/rbac/users/:userId/bulk-access
// @access  Private/Manager
export const bulkUpdateUserAccess = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { userId } = req.params;
    const { roleId, propertyIds, canEdit, canExport, expiresAt, enableUser } = req.body;

    // --------------------------------------------------
    // 1. VERIFY USER
    // --------------------------------------------------
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        createdByManagerId: managerId,
        isManagedUser: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found or not managed by you'
      });
    }

    // --------------------------------------------------
    // 2. VERIFY ROLE
    // --------------------------------------------------
    let role = null;
    if (roleId) {
      role = await prisma.customRole.findFirst({
        where: { id: roleId, createdById: managerId }
      });

      if (!role) {
        return res.status(400).json({
          error: 'Invalid role - not created by you'
        });
      }
    }

    // --------------------------------------------------
    // 3. VERIFY PROPERTIES
    // --------------------------------------------------
    if (propertyIds && propertyIds.length > 0) {
      const managerProperties = await prisma.property.findMany({
        where: { managerId },
        select: { id: true }
      });

      const managerPropertyIds = managerProperties.map(p => p.id);

      const invalidProperties = propertyIds.filter(
        id => !managerPropertyIds.includes(id)
      );

      if (invalidProperties.length > 0) {
        return res.status(400).json({
          error: `You don't manage properties: ${invalidProperties.join(', ')}`
        });
      }
    }

    // --------------------------------------------------
    // 4. BUILD TRANSACTION QUERIES (FAST)
    // --------------------------------------------------
    const queries = [];

    // Enable/Disable user
    if (enableUser !== undefined) {
      queries.push(
        prisma.user.update({
          where: { id: userId },
          data: { canManagerLogin: enableUser }
        })
      );
    }

    // Role update (SAFE UPSERT)
    if (roleId) {
      // Deactivate other roles
      queries.push(
        prisma.userRoleAssignment.updateMany({
          where: {
            userId,
            roleId: { not: roleId }
          },
          data: { isActive: false }
        })
      );

      // Upsert role (fixes unique constraint)
      queries.push(
        prisma.userRoleAssignment.upsert({
          where: {
            userId_roleId: { userId, roleId }
          },
          update: {
            isActive: enableUser !== false,
            assignedBy: managerId,
            assignedAt: new Date(),
            expiresAt: expiresAt ? new Date(expiresAt) : null
          },
          create: {
            userId,
            roleId,
            assignedBy: managerId,
            isActive: enableUser !== false,
            expiresAt: expiresAt ? new Date(expiresAt) : null
          }
        })
      );
    }

    // Property access update
    if (propertyIds) {
      // Deactivate all existing
      queries.push(
        prisma.propertyAccess.updateMany({
          where: { userId },
          data: { isActive: false }
        })
      );

      // Bulk create new access
      if (propertyIds.length > 0) {
        queries.push(
          prisma.propertyAccess.createMany({
            data: propertyIds.map(propertyId => ({
              userId,
              propertyId,
              grantedBy: managerId,
              isActive: enableUser !== false,
              canView: true,
              canEdit: canEdit || false,
              canExport: canExport || false,
              expiresAt: expiresAt ? new Date(expiresAt) : null,
              roleId: roleId || null
            })),
            skipDuplicates: true // 🔥 safety
          })
        );
      }
    }

    // --------------------------------------------------
    // 5. EXECUTE TRANSACTION
    // --------------------------------------------------
    await prisma.$transaction(queries);

    // --------------------------------------------------
    // 6. AUDIT LOG (OUTSIDE TRANSACTION)
    // --------------------------------------------------
    await prisma.rBACAuditLog.create({
      data: {
        action: 'BULK_UPDATE_USER_ACCESS',
        performedBy: managerId,
        targetUser: userId,
        changes: {
          roleId,
          propertyIds,
          canEdit,
          canExport,
          expiresAt,
          enableUser
        }
      }
    }).catch(err => {
      console.error('Audit log failed:', err.message);
    });

    // --------------------------------------------------
    // 7. CACHE INVALIDATION
    // --------------------------------------------------
    permissionService.invalidateUserCache(userId);

    // --------------------------------------------------
    // 8. RESPONSE
    // --------------------------------------------------
    res.json({
      success: true,
      message: 'User access updated successfully'
    });

  } catch (error) {
    console.error('Bulk update user access error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// AUDIT LOGS
// ======================================================

// @desc    Get audit logs
// @route   GET /api/rbac/audit-logs
// @access  Private/Admin/Manager
export const getAuditLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = {};

    if (userRole === 'MANAGER') {
      // First fetch users under this manager
      const managedUsers = await prisma.user.findMany({
        where: { createdByManagerId: userId },
        select: { id: true }
      });

      const managedUserIds = managedUsers.map(u => u.id);

      whereClause = {
        OR: [
          { performedBy: userId },
          { targetUser: { in: managedUserIds } }
        ]
      };
    }

    const logs = await prisma.rBACAuditLog.findMany({
      where: whereClause,
      include: {
        performer: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(logs);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get cache statistics (Admin only - for monitoring)
// @route   GET /api/rbac/cache-stats
// @access  Private/Admin
export const getCacheStats = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const stats = cacheService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Clear all cache (Admin only - for maintenance)
// @route   POST /api/rbac/clear-cache
// @access  Private/Admin
export const clearAllCache = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    cacheService.flush();
    res.json({ success: true, message: 'All cache cleared successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};