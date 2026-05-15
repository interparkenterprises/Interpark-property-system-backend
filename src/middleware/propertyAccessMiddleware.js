import permissionService from "../services/permissionService.js";

// Middleware to check property access
export const requirePropertyAccess = (requiredPermission = 'canView') => {
  return async (req, res, next) => {
    const userId = req.user.id;
    const propertyId = req.params.propertyId || req.params.id || req.body.propertyId;
    
    if (!propertyId) {
      return next();
    }
    
    const hasAccess = await permissionService.checkPropertyAccess(
      userId, 
      propertyId, 
      requiredPermission
    );
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: `You don't have ${requiredPermission} access to this property`
      });
    }
    
    req.accessibleProperty = { id: propertyId };
    next();
  };
};

// Middleware for record access (any model)
export const requireRecordAccess = (modelName, action = 'view') => {
  return async (req, res, next) => {
    const userId = req.user.id;
    const recordId = req.params.id;
    
    const hasAccess = await permissionService.canAccessRecord(
      userId, 
      modelName, 
      recordId, 
      action
    );
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: `You don't have permission to ${action} this ${modelName}`
      });
    }
    
    next();
  };
};

// Middleware to filter queries by accessible properties
export const filterByAccessibleProperties = () => {
  return async (req, res, next) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
    req.accessiblePropertyIds = accessiblePropertyIds;
    
    next();
  };
};