import prisma from "../lib/prisma.js";
import cacheService from "./cacheService.js";

class PermissionService {

  // ======================================================
  // PERMISSION CODE MAPPING
  // ======================================================
  
  // Map resource operations to permission codes
  getPermissionCode(resource, operation) {
    const mapping = {
      // Property permissions
      property: {
        view: 'VIEW_PROPERTIES',
        create: 'CREATE_PROPERTY',
        edit: 'EDIT_PROPERTY',
        delete: 'DELETE_PROPERTY',
        assignManager: 'ASSIGN_MANAGER_TO_PROPERTY'
      },
      // Unit permissions
      unit: {
        view: 'VIEW_UNITS',
        create: 'CREATE_UNIT',
        edit: 'EDIT_UNIT',
        delete: 'DELETE_UNIT',
        updateStatus: 'UPDATE_UNIT_STATUS'
      },
      // Tenant permissions
      tenant: {
        view: 'VIEW_TENANTS',
        create: 'CREATE_TENANT',
        edit: 'EDIT_TENANT',
        delete: 'DELETE_TENANT',
        viewFinancials: 'VIEW_TENANT_FINANCIALS'
      },
      // Invoice permissions
      invoice: {
        view: 'VIEW_INVOICES',
        create: 'CREATE_INVOICES',
        edit: 'EDIT_INVOICES',
        delete: 'DELETE_INVOICES',
        download: 'DOWNLOAD_INVOICES'
      },
      // Bill permissions (utility)
      bill: {
        view: 'VIEW_BILLS',
        create: 'CREATE_BILLS',
        edit: 'EDIT_BILLS',
        delete: 'DELETE_BILLS',
        recordMeterReading: 'RECORD_METER_READINGS'
      },
      // Bill Invoice permissions (add this new section)
      billInvoice: {
        view: 'VIEW_BILL_INVOICES',
        create: 'CREATE_BILL_INVOICE',
        edit: 'EDIT_BILL_INVOICE_PAYMENT',
        delete: 'DELETE_BILL_INVOICE',
        download: 'DOWNLOAD_BILL_INVOICE'
      },
      // Maintenance permissions
      maintenance: {
        view: 'VIEW_MAINTENANCE_REQUESTS',
        create: 'CREATE_MAINTENANCE_REQUESTS',
        edit: 'UPDATE_MAINTENANCE_REQUESTS',
        delete: 'DELETE_MAINTENANCE_REQUESTS',
        assign: 'ASSIGN_MAINTENANCE_TASKS'
      },
      // Report permissions
      report: {
        view: 'VIEW_DAILY_REPORTS',
        create: 'CREATE_DAILY_REPORTS',
        edit: 'EDIT_DAILY_REPORTS',
        delete: 'DELETE_DAILY_REPORTS',
        approve: 'APPROVE_DAILY_REPORTS',
        submit: 'SUBMIT_DAILY_REPORTS'
      },
      // Payment Report permissions
      paymentReport: {
        view: 'VIEW_PAYMENT_REPORTS',
        create: 'RECORD_PAYMENTS',        // Recording payments
        edit: 'EDIT_PAYMENT_RECORDS',     // Editing payment records
        delete: 'DELETE_PAYMENT_RECORDS', // Deleting payment records
        download: 'DOWNLOAD_PAYMENT_RECEIPT', // Downloading receipts
        preview: 'PREVIEW_PAYMENTS',      // Previewing payments
        viewArrears: 'VIEW_ARREARS'       // Viewing arrears
      },

      // Receipt permissions
      receipt: {
        view: 'VIEW_RECEIPTS',
        download: 'DOWNLOAD_RECEIPTS',
        generate: 'GENERATE_RECEIPTS'
      },
      // Document permissions
      offerLetter: {
        view: 'VIEW_OFFER_LETTERS',
        create: 'CREATE_OFFER_LETTERS',
        edit: 'EDIT_OFFER_LETTERS',
        delete: 'DELETE_OFFER_LETTERS'
      },
      demandLetter: {
        view: 'VIEW_DEMAND_LETTERS',
        create: 'CREATE_DEMAND_LETTER',
        autoGenerate: 'AUTO_GENERATE_DEMAND_LETTER',
        batchGenerate: 'BATCH_GENERATE_DEMAND_LETTERS',
        edit: 'EDIT_DEMAND_LETTER_STATUS',
        delete: 'DELETE_DEMAND_LETTER',
        download: 'DOWNLOAD_DEMAND_LETTER',
        send: 'SEND_DEMAND_LETTERS'
      },

      // Add this separate permission for overdue invoices
      overdueInvoice: {
        view: 'VIEW_OVERDUE_INVOICES'
      },
      // Lead permissions
      lead: {
        view: 'VIEW_LEADS',
        create: 'CREATE_LEAD',
        edit: 'EDIT_LEAD',
        delete: 'DELETE_LEAD'
      },
      // Landlord permissions
      landlord: {
        view: 'VIEW_LANDLORDS',
        create: 'CREATE_LANDLORD',
        edit: 'EDIT_LANDLORD',
        delete: 'DELETE_LANDLORD'
      },
      // Service provider permissions
      serviceProvider: {
        view: 'VIEW_SERVICE_PROVIDERS',
        create: 'CREATE_SERVICE_PROVIDER',
        edit: 'EDIT_SERVICE_PROVIDER',
        delete: 'DELETE_SERVICE_PROVIDER'
      },
      // Activation request permissions
      activationRequest: {
        view: 'VIEW_ACTIVATION_REQUESTS',
        create: 'CREATE_ACTIVATION_REQUEST',
        edit: 'EDIT_ACTIVATION_REQUEST',
        delete: 'DELETE_ACTIVATION_REQUEST',
        approve: 'APPROVE_ACTIVATION_REQUEST'
      },
      // Commission permissions
      commission: {
        view: 'VIEW_COMMISSIONS',
        generate: 'GENERATE_COMMISSION_INVOICES',
        process: 'PROCESS_COMMISSIONS',
        approve: 'APPROVE_COMMISSIONS'
      },
      // User management permissions
      user: {
        view: 'VIEW_ALL_USERS',
        create: 'CREATE_USER',
        delete: 'DELETE_USER',
        editRole: 'EDIT_USER_ROLE',
        viewAuditLogs: 'VIEW_AUDIT_LOGS',
        approveManager: 'APPROVE_MANAGER'
      }
    };
    
    return mapping[resource]?.[operation] || null;
  }

  // ======================================================
  // GENERIC PERMISSION CHECK FOR ANY RESOURCE
  // ======================================================
  async checkPermission(userId, resource, operation, propertyId = null) {
    const permissionCode = this.getPermissionCode(resource, operation);
    
    if (!permissionCode) {
      console.warn(`No permission code found for ${resource}.${operation}`);
      return false;
    }
    
    // Special handling for CREATE operations (no property exists yet)
    if (operation === 'create') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });
      
      // Allow ADMIN and MANAGER to create resources
      if (user?.role === 'ADMIN' || user?.role === 'MANAGER') {
        return true;
      }
    }
    
    return this.hasPermission(userId, permissionCode, propertyId);
  }

  // ======================================================
  // UNIT PERMISSION CHECK (SPECIFIC HELPER)
  // ======================================================
  async checkUnitPermission(userId, propertyId, operation) {
    // Map operation to the correct parameter
    const operationMap = {
      'view': 'view',
      'create': 'create',
      'edit': 'edit',
      'delete': 'delete',
      'updateStatus': 'updateStatus'
    };
    
    const mappedOperation = operationMap[operation] || operation;
    return this.checkPermission(userId, 'unit', mappedOperation, propertyId);
  }

  // ======================================================
  // TENANT PERMISSION CHECK
  // ======================================================
  async checkTenantPermission(userId, propertyId, operation) {
    return this.checkPermission(userId, 'tenant', operation, propertyId);
  }

  // ======================================================
  // INVOICE PERMISSION CHECK
  // ======================================================
  async checkInvoicePermission(userId, propertyId, operation) {
    return this.checkPermission(userId, 'invoice', operation, propertyId);
  }

  // ======================================================
  // BILL PERMISSION CHECK
  // ======================================================
  async checkBillPermission(userId, propertyId, operation) {
    return this.checkPermission(userId, 'bill', operation, propertyId);
  }

  // ======================================================
  // MAINTENANCE PERMISSION CHECK
  // ======================================================
  async checkMaintenancePermission(userId, propertyId, operation) {
    return this.checkPermission(userId, 'maintenance', operation, propertyId);
  }

  // ======================================================
  // REPORT PERMISSION CHECK
  // ======================================================
  async checkReportPermission(userId, propertyId, operation) {
    return this.checkPermission(userId, 'report', operation, propertyId);
  }

  // ======================================================
  // PROPERTY ACCESS CHECK (WITH CACHE)
  // ======================================================
  async checkPropertyAccess(userId, propertyId, requiredPermission = 'canView') {
    const cacheKey = cacheService.getPropertyAccessKey(userId, propertyId);

    // Try cache first
    const cached = cacheService.get(cacheKey);
    if (cached && cached[requiredPermission] !== undefined) {
      return cached[requiredPermission];
    }

    // -------------------------------
    // MANAGER CHECK - Managers have full access to properties they own
    // -------------------------------
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });

    if (property?.managerId === userId) {
      // Manager owns this property - grant all access
      cacheService.set(cacheKey, { [requiredPermission]: true });
      return true;
    }

    // -------------------------------
    // DIRECT ACCESS - Check the specific permission
    // -------------------------------
    const directAccess = await prisma.propertyAccess.findFirst({
      where: {
        userId,
        propertyId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });

    if (directAccess) {
      // Check the specific permission based on requiredPermission
      let hasPermission = false;
      switch(requiredPermission) {
        case 'canView':
          hasPermission = directAccess.canView === true;
          break;
        case 'canEdit':
          hasPermission = directAccess.canEdit === true;
          break;
        case 'canDelete':
          hasPermission = directAccess.canDelete === true;
          break;
        case 'canExport':
          hasPermission = directAccess.canExport === true;
          break;
        default:
          hasPermission = directAccess.canView === true;
      }
      
      if (hasPermission) {
        cacheService.set(cacheKey, { [requiredPermission]: true });
        return true;
      }
    }

    // -------------------------------
    // ROLE-BASED ACCESS
    // -------------------------------
    const roleAccess = await prisma.userRoleAssignment.findMany({
      where: {
        userId,
        isActive: true,
        role: {
          propertyAccess: {
            some: {
              propertyId,
              isActive: true
            }
          }
        }
      },
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

    for (const assignment of roleAccess) {
      // Map requiredPermission to permission code
      let permissionCode;
      switch(requiredPermission) {
        case 'canView':
          permissionCode = 'VIEW_PROPERTIES';
          break;
        case 'canEdit':
          permissionCode = 'EDIT_PROPERTY';
          break;
        case 'canDelete':
          permissionCode = 'DELETE_PROPERTY';
          break;
        case 'canExport':
          permissionCode = 'EXPORT_PROPERTY';
          break;
        default:
          permissionCode = 'VIEW_PROPERTIES';
      }
      
      const hasPermission = assignment.role.permissions.some(
        p => p.permission.code === permissionCode
      );

      if (hasPermission) {
        cacheService.set(cacheKey, { [requiredPermission]: true });
        return true;
      }
    }

    // -------------------------------
    // ADMIN CHECK
    // -------------------------------
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    const isAdmin = user?.role === 'ADMIN';

    cacheService.set(cacheKey, { [requiredPermission]: isAdmin });

    return isAdmin;
  }

  // ======================================================
  // PERMISSION CHECK (WITH CACHE)
  // ======================================================
  async hasPermission(userId, permissionCode, propertyId = null) {
    // First, check if user is MANAGER with property ownership
    if (propertyId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });
      
      // MANAGERs have all permissions on properties they own
      if (user?.role === 'MANAGER') {
        // Check if this MANAGER owns the property
        const property = await prisma.property.findUnique({
          where: { id: propertyId },
          select: { managerId: true }
        });
        
        if (property?.managerId === userId) {
          // MANAGER owns this property - grant all permissions
          return true;
        }
      }
    }
    
    const cacheKey = cacheService.getUserPermissionsKey(userId);

    // Try cache
    let permissions = cacheService.get(cacheKey);

    if (!permissions) {
      permissions = await this.getUserPermissions(userId);
      cacheService.set(cacheKey, permissions);
    }

    // Property-specific override (custom permissions)
    if (propertyId) {
      const directAccess = await prisma.propertyAccess.findFirst({
        where: {
          userId,
          propertyId,
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      });

      if (directAccess?.customPermissions?.[permissionCode]) {
        return true;
      }
    }

    // Check if user has the permission
    if (permissions.includes(permissionCode)) {
      return true;
    }

    // ADMIN fallback
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    return user?.role === 'ADMIN';
  }

  // ======================================================
  // GET PROPERTY ID FROM VARIOUS MODELS (COMPLETE)
  // ======================================================
  async getPropertyIdFromModel(modelName, recordId) {
    switch (modelName) {
      // Direct property relationship
      case 'Property':
        return (await prisma.property.findUnique({
          where: { id: recordId },
          select: { id: true }
        }))?.id;

      // Unit -> Property
      case 'Unit':
        return (await prisma.unit.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // Tenant -> Unit -> Property
      case 'Tenant':
        return (await prisma.tenant.findUnique({
          where: { id: recordId },
          include: { unit: { select: { propertyId: true } } }
        }))?.unit?.propertyId;

      // Invoice -> Tenant -> Unit -> Property
      case 'Invoice':
        return (await prisma.invoice.findUnique({
          where: { id: recordId },
          include: {
            tenant: {
              include: { unit: { select: { propertyId: true } } }
            }
          }
        }))?.tenant?.unit?.propertyId;

      // Bill -> Tenant -> Unit -> Property
      case 'Bill':
        return (await prisma.bill.findUnique({
          where: { id: recordId },
          include: {
            tenant: {
              include: { unit: { select: { propertyId: true } } }
            }
          }
        }))?.tenant?.unit?.propertyId;

      // BillInvoice -> Tenant -> Unit -> Property
      case 'BillInvoice':
        return (await prisma.billInvoice.findUnique({
          where: { id: recordId },
          include: {
            tenant: {
              include: { unit: { select: { propertyId: true } } }
            }
          }
        }))?.tenant?.unit?.propertyId;

      // DailyReport -> Property (direct)
      case 'DailyReport':
        return (await prisma.dailyReport.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // OfferLetter -> Property (direct)
      case 'OfferLetter':
        return (await prisma.offerLetter.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // DemandLetter -> Property (direct)
      case 'DemandLetter':
        return (await prisma.demandLetter.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // ActivationRequest -> Property (direct)
      case 'ActivationRequest':
        return (await prisma.activationRequest.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // Lead -> Property (direct)
      case 'Lead':
        return (await prisma.lead.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // ServiceProvider -> Property (direct)
      case 'ServiceProvider':
        return (await prisma.serviceProvider.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // ManagerCommission -> Property (direct)
      case 'ManagerCommission':
        return (await prisma.managerCommission.findUnique({
          where: { id: recordId },
          select: { propertyId: true }
        }))?.propertyId;

      // CommissionInvoice -> ManagerCommission -> Property
      case 'CommissionInvoice':
        const commissionInvoice = await prisma.commissionInvoice.findUnique({
          where: { id: recordId },
          include: {
            commission: {
              select: { propertyId: true }
            }
          }
        });
        return commissionInvoice?.commission?.propertyId;

      // Income -> Property (direct, but optional)
      case 'Income':
        const income = await prisma.income.findUnique({
          where: { id: recordId },
          select: { propertyId: true, tenant: { include: { unit: { select: { propertyId: true } } } } }
        });
        return income?.propertyId || income?.tenant?.unit?.propertyId;

      // PaymentReport -> Tenant -> Unit -> Property
      case 'PaymentReport':
        return (await prisma.paymentReport.findUnique({
          where: { id: recordId },
          include: {
            tenant: {
              include: { unit: { select: { propertyId: true } } }
            }
          }
        }))?.tenant?.unit?.propertyId;

      // ToDo -> User -> (no direct property, but users have managed properties)
      case 'ToDo':
        return null;

      default:
        console.warn(`Unknown model for property lookup: ${modelName}`);
        return null;
    }
  }

  // ======================================================
  // GENERIC RECORD ACCESS
  // ======================================================
  async canAccessRecord(userId, modelName, recordId, action = 'view') {
    const propertyId = await this.getPropertyIdFromModel(modelName, recordId);

    // If no property ID found, check if it's a user-specific record
    if (!propertyId) {
      // For records without property association (like ToDo)
      if (modelName === 'ToDo') {
        const todo = await prisma.toDo.findUnique({
          where: { id: recordId },
          select: { userId: true }
        });
        return todo?.userId === userId;
      }
      return false;
    }

    const permissionMap = {
      view: 'canView',
      edit: 'canEdit',
      delete: 'canDelete',
      export: 'canExport'
    };

    return this.checkPropertyAccess(
      userId,
      propertyId,
      permissionMap[action] || 'canView'
    );
  }

  // ======================================================
  // BATCH PROPERTY ID LOOKUP (for performance)
  // ======================================================
  async getPropertyIdsFromModels(records) {
    const propertyIds = new Map();
    
    for (const { modelName, recordId } of records) {
      const propertyId = await this.getPropertyIdFromModel(modelName, recordId);
      if (propertyId) {
        propertyIds.set(recordId, propertyId);
      }
    }
    
    return propertyIds;
  }

  // ======================================================
  // ACCESSIBLE PROPERTIES (WITH CACHE)
  // ======================================================
  async getAccessiblePropertyIds(userId, userRole) {
    const cacheKey = cacheService.getAccessiblePropertiesKey(userId, userRole);

    const cached = cacheService.get(cacheKey);
    if (cached) return cached;

    if (userRole === 'ADMIN') {
      const all = await prisma.property.findMany({ select: { id: true } });
      const ids = all.map(p => p.id);

      cacheService.set(cacheKey, ids);
      return ids;
    }

    // For MANAGERs, include properties they manage
    const managed = await prisma.property.findMany({
      where: { managerId: userId },
      select: { id: true }
    });

    const directAccess = await prisma.propertyAccess.findMany({
      where: {
        userId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      select: { propertyId: true }
    });

    const roleAccess = await prisma.customRolePropertyAccess.findMany({
      where: {
        role: {
          assignments: {
            some: { userId, isActive: true }
          }
        }
      },
      select: { propertyId: true }
    });

    const ids = Array.from(new Set([
      ...directAccess.map(a => a.propertyId),
      ...roleAccess.map(a => a.propertyId),
      ...managed.map(p => p.id)
    ]));

    cacheService.set(cacheKey, ids);

    return ids;
  }

  // ======================================================
  // USER PERMISSIONS (WITH CACHE)
  // ======================================================
  async getUserPermissions(userId) {
    const cacheKey = cacheService.getUserPermissionsKey(userId);

    const cached = cacheService.get(cacheKey);
    if (cached) return cached;

    const userWithRoles = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userAssignments: {
          where: { isActive: true },
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true }
                }
              }
            }
          }
        }
      }
    });

    const permissions = new Set();

    for (const assignment of userWithRoles?.userAssignments || []) {
      for (const rolePerm of assignment.role.permissions) {
        permissions.add(rolePerm.permission.code);
      }
    }

    const result = Array.from(permissions);

    cacheService.set(cacheKey, result);

    return result;
  }

  // ======================================================
  // CHECK MULTIPLE PERMISSIONS (batch)
  // ======================================================
  async hasAllPermissions(userId, permissionCodes, propertyId = null) {
    for (const code of permissionCodes) {
      const has = await this.hasPermission(userId, code, propertyId);
      if (!has) return false;
    }
    return true;
  }

  async hasAnyPermission(userId, permissionCodes, propertyId = null) {
    for (const code of permissionCodes) {
      const has = await this.hasPermission(userId, code, propertyId);
      if (has) return true;
    }
    return false;
  }

  // ======================================================
  // FORCE CACHE INVALIDATION (for external use)
  // ======================================================
  async invalidateUserCache(userId) {
    cacheService.invalidateUser(userId);
  }

  async invalidateUsersCache(userIds) {
    cacheService.invalidateUsers(userIds);
  }

  async invalidatePropertyAccessCache(propertyId) {
    cacheService.invalidatePropertyAccess(propertyId);
  }

  // ======================================================
  // CLEAR ALL CACHE (admin only)
  // ======================================================
  async clearAllCache() {
    cacheService.flush();
  }

  // ======================================================
  // GET CACHE STATS (monitoring)
  // ======================================================
  getCacheStats() {
    return cacheService.getStats();
  }
}

export default new PermissionService();