import permissionService from '../services/permissionService.js';

export const requireAnalyticsPermissions = (...permissionCodes) => async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN' || req.user.role === 'MANAGER') return next();

    const checks = await Promise.all(permissionCodes.map(code => (
      permissionService.hasPermission(req.user.id, code)
    )));

    if (checks.every(Boolean)) return next();

    return res.status(403).json({
      success: false,
      message: 'You do not have permission to view these analytics',
      requiredPermissions: permissionCodes
    });
  } catch (error) {
    return next(error);
  }
};
