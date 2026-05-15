import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  // Permissions
  getPermissions,
  createPermission,
  getPermissionById,
  updatePermission,
  deletePermission,
  // Custom Roles
  getCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  // Managed Users - Basic
  createManagedUser,
  getManagedUsers,
  updateManagedUserAccess,
  deleteManagedUser,
  // Managed Users - Access Management
  revokePropertyAccess,
  grantAdditionalPropertyAccess,
  updatePropertyPermissions,
  getUserAccessDetails,
  // Managed Users - Status Management
  disableManagedUser,
  enableManagedUser,
  // Managed Users - Bulk Operations
  bulkUpdateUserAccess,
  // Audit Logs
  getAuditLogs,
  //caching
  getCacheStats,
  clearAllCache
} from '../controllers/rbac.controller.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ======================================================
// PERMISSION ROUTES
// ======================================================

router.route('/permissions')
  .get(authorize('ADMIN', 'MANAGER'), getPermissions)
  .post(authorize('ADMIN'), createPermission);

// Get single permission
router.get('/permissions/:id', 
  authorize('ADMIN'), 
  getPermissionById
);

// Update permission
router.put('/permissions/:id', 
  authorize('ADMIN'), 
  updatePermission
);

// Delete permission
router.delete('/permissions/:id', 
  authorize('ADMIN'), 
  deletePermission
);

// ======================================================
// CUSTOM ROLE ROUTES
// ======================================================

router.route('/roles')
  .get(authorize('ADMIN', 'MANAGER'), getCustomRoles)
  .post(authorize('MANAGER'), createCustomRole);

router.route('/roles/:roleId')
  .put(authorize('MANAGER'), updateCustomRole)
  .delete(authorize('MANAGER'), deleteCustomRole);

// ======================================================
// MANAGED USER ROUTES
// ======================================================

// Basic CRUD Operations
// ------------------------------------------
router.route('/users')
  .get(authorize('MANAGER'), getManagedUsers)
  .post(authorize('MANAGER'), createManagedUser);

router.route('/users/:userId')
  .delete(authorize('MANAGER'), deleteManagedUser);

// Role & Basic Access Management
// ------------------------------------------
router.route('/users/:userId/access')
  .put(authorize('MANAGER'), updateManagedUserAccess);

// Granular Property Access Management
// ------------------------------------------
router.get('/users/:userId/access-details', 
  authorize('MANAGER'), 
  getUserAccessDetails
);

router.post('/users/:userId/property-access', 
  authorize('MANAGER'), 
  grantAdditionalPropertyAccess
);

router.delete('/users/:userId/property-access/:propertyId', 
  authorize('MANAGER'), 
  revokePropertyAccess
);

router.put('/users/:userId/property-access/:propertyId/permissions', 
  authorize('MANAGER'), 
  updatePropertyPermissions
);

// User Status Management
// ------------------------------------------
router.post('/users/:userId/disable', 
  authorize('MANAGER'), 
  disableManagedUser
);

router.post('/users/:userId/enable', 
  authorize('MANAGER'), 
  enableManagedUser
);

// Bulk Operations
// ------------------------------------------
router.put('/users/:userId/bulk-access', 
  authorize('MANAGER'), 
  bulkUpdateUserAccess
);

// ======================================================
// AUDIT LOG ROUTES
// ======================================================

router.get('/audit-logs', 
  authorize('ADMIN', 'MANAGER'), 
  getAuditLogs
);

//Cache Management Routes (for admin use)
router.get('/cache-stats', authorize('ADMIN'), getCacheStats);
router.delete('/cache', authorize('ADMIN'), clearAllCache);

export default router;