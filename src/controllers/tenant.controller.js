import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";
import fs from 'fs';
import path from 'path';
//import { deleteDocument, fileExists, getFilePath } from '../utils/uploadHelper.js';

import { 
  calculateEscalatedRent,  
  calculatePaymentByPolicy,
  getRentScheduleWithPayments,
  calculateServiceCharge,
  calculateVAT,
  calculateTotalPayment,
  getPolicyMonths
} from '../services/rentCalculation.js';
import { getPaymentSummary } from '../services/paymentScheduling.js';

// Helper function to check tenant-specific permissions
const checkTenantPermission = async (userId, userRole, propertyId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await permissionService.checkTenantPermission(userId, propertyId, operation);
  }
  
  return false;
};

// Helper function to check if user has access to tenant
const checkUserTenantAccess = async (userId, userRole, tenantId, requiredOperation = 'view') => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      unit: {
        include: {
          property: true
        }
      }
    }
  });

  if (!tenant) {
    return { hasAccess: false, tenant: null };
  }

  if (userRole === 'ADMIN') {
    return { hasAccess: true, tenant };
  }
  
  if (userRole === 'MANAGER') {
    const hasAccess = tenant.unit.property.managerId === userId;
    return { hasAccess, tenant };
  }
  
  if (userRole === 'USER') {
    const hasAccess = await checkTenantPermission(
      userId, 
      userRole, 
      tenant.unit.propertyId, 
      requiredOperation
    );
    return { hasAccess, tenant };
  }
  
  return { hasAccess: false, tenant };
};

// Helper function to check if user has write access for tenant operations
const checkUserWriteAccess = async (userId, userRole, tenantId = null, operation = 'edit') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    if (tenantId) {
      const { hasAccess } = await checkUserTenantAccess(userId, userRole, tenantId, operation);
      return hasAccess;
    }
    return true; // Managers can create tenants
  }
  
  if (userRole === 'USER') {
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { unit: true }
      });
      if (tenant) {
        return await checkTenantPermission(userId, userRole, tenant.unit.propertyId, operation);
      }
      return false;
    }
    return false;
  }
  
  return false;
};

// Helper: compute tenure in days between two dates
const daysBetween = (from, to) => {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

// Helper: build the lifecycle metadata block for a tenant
const buildLifecycleMetadata = (tenant) => {
  const leftTimestamp = tenant.leftAt || (tenant.status === 'LEFT' ? tenant.updatedAt : null);
  return {
    status: tenant.status,
    isActive: tenant.status === 'ACTIVE',
    leftAt: leftTimestamp,
    leftReason: tenant.leftReason || null,
    tenureDays: tenant.status === 'LEFT'
      ? daysBetween(tenant.createdAt, leftTimestamp)
      : daysBetween(tenant.createdAt, new Date())
  };
};


// Valid values for TenantLeftReason enum
const VALID_LEFT_REASONS = [
  'LEASE_EXPIRED',
  'VOLUNTARY',
  'EVICTED',
  'NON_PAYMENT',
  'TRANSFERRED',
  'DECEASED',
  'OTHER'
];

/**
 * Normalize an optional leftReason from a request body.
 * - Returns null if not provided / null / empty string / whitespace-only.
 * - Returns the trimmed, uppercased enum value if valid.
 * - Throws an Error with `statusCode = 400` if invalid.
 */
const normalizeLeftReason = (raw) => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;

  if (typeof raw !== 'string') {
    const err = new Error('leftReason must be a string if provided');
    err.statusCode = 400;
    throw err;
  }

  const normalized = raw.trim().toUpperCase();
  if (!VALID_LEFT_REASONS.includes(normalized)) {
    const err = new Error(
      `Invalid leftReason. Must be one of: ${VALID_LEFT_REASONS.join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }

  return normalized;
};

/**
 * Central helper to flip a tenant to LEFT.
 * ALWAYS sets leftAt — this is the single source of truth for churn tracking.
 * Must be called inside a Prisma transaction (`tx`).
 */
const markTenantAsLeft = (tx, tenantId, leftReason = null, leftAt = new Date()) =>
  tx.tenant.update({
    where: { id: tenantId },
    data: {
      status: 'LEFT',
      leftAt,
      leftReason
    }
  });
// @desc    Get all tenants (active tenants only - excludes LEFT tenants by default)
// @route   GET /api/tenants
// @access  Private
export const getTenants = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Optional: query params to include left tenants or filter by status
    const { includeLeft, status } = req.query;
    const showLeftTenants = includeLeft === 'true' || status === 'LEFT' || status === 'ALL';

    // Base where clause
    let baseWhere = {};
    if (status === 'LEFT') {
      baseWhere.status = 'LEFT';
    } else if (status === 'ALL') {
      // no status filter
    } else if (status === 'ACTIVE') {
      baseWhere.status = 'ACTIVE';
    } else if (!showLeftTenants) {
      baseWhere.status = 'ACTIVE';
    }

    let tenants;

    if (userRole === 'ADMIN') {
      tenants = await prisma.tenant.findMany({
        where: baseWhere,
        include: {
          unit: {
            include: {
              property: true
            }
          },
          paymentReports: true,
          serviceCharge: true,
          incomes: true
        },
        orderBy: { fullName: 'asc' }
      });
    } else if (userRole === 'MANAGER') {
      tenants = await prisma.tenant.findMany({
        where: {
          ...baseWhere,
          unit: {
            property: {
              managerId: userId
            }
          }
        },
        include: {
          unit: {
            include: {
              property: true
            }
          },
          paymentReports: true,
          serviceCharge: true,
          incomes: true
        },
        orderBy: { fullName: 'asc' }
      });
    } else if (userRole === 'USER') {
      // Get accessible property IDs for this user
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json({
          tenants: [],
          metadata: {
            totalCount: 0,
            activeTenantsCount: 0,
            leftTenantsCount: 0,
            showLeftTenants: false,
            filter: 'active tenants only'
          }
        });
      }
      
      // Filter properties where user has VIEW_TENANTS permission
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkTenantPermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      if (propertiesWithPermission.length === 0) {
        return res.json({
          tenants: [],
          metadata: {
            totalCount: 0,
            activeTenantsCount: 0,
            leftTenantsCount: 0,
            showLeftTenants: false,
            filter: 'active tenants only'
          }
        });
      }
      
      tenants = await prisma.tenant.findMany({
        where: {
          ...baseWhere,
          unit: {
            property: {
              id: { in: propertiesWithPermission }
            }
          }
        },
        include: {
          unit: {
            include: {
              property: true
            }
          },
          paymentReports: true,
          serviceCharge: true,
          incomes: true
        },
        orderBy: { fullName: 'asc' }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Enhance each tenant with payment information
    const enhancedTenants = tenants.map(tenant => {
      const rentInfo = calculateEscalatedRent(tenant);
      const monthlyRent = rentInfo.currentRent;
      const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
      const paymentSummary = getPaymentSummary(tenant);
      
      // Calculate service charge based on rent ONLY
      const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
      const serviceChargeByPolicy = serviceChargeDetails.amount * getPolicyMonths(tenant.paymentPolicy);
      
      // Calculate VAT on rent
      const vatOnRent = calculateVAT(paymentAmount, tenant.vatType, tenant.vatRate);
      
      // Calculate VAT on service charge (using service charge's own VAT settings)
      const vatOnServiceCharge = serviceChargeDetails.vatAmount * getPolicyMonths(tenant.paymentPolicy);
      
      const totalPayment = paymentAmount + vatOnRent + serviceChargeByPolicy + vatOnServiceCharge;
      
      return {
        ...tenant,
        rentInfo: {
          ...rentInfo,
          monthlyRent: monthlyRent,
          paymentAmount: paymentAmount,
          serviceCharge: {
            monthly: serviceChargeDetails.amount,
            byPolicy: serviceChargeByPolicy,
            vatType: serviceChargeDetails.vatType,
            vatRate: serviceChargeDetails.vatRate,
            vatAmount: vatOnServiceCharge,
            totalByPolicy: serviceChargeByPolicy + vatOnServiceCharge
          },
          vatOnRent: vatOnRent,
          totalPayment: totalPayment,
          paymentPolicy: tenant.paymentPolicy
        },
        paymentSummary,
        lifecycle: buildLifecycleMetadata(tenant)
      };
    });

    // Build count where-clause per role
    let countWhere = {};
    if (userRole === 'MANAGER') {
      countWhere = { unit: { property: { managerId: userId } } };
    } else if (userRole === 'USER') {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      const allowed = [];
      for (const id of accessiblePropertyIds) {
        if (await checkTenantPermission(userId, userRole, id, 'view')) {
          allowed.push(id);
        }
      }
      countWhere = { unit: { property: { id: { in: allowed } } } };
    }

    const [activeCount, leftCount] = await Promise.all([
      prisma.tenant.count({ where: { ...countWhere, status: 'ACTIVE' } }),
      prisma.tenant.count({ where: { ...countWhere, status: 'LEFT' } })
    ]);

    const response = {
      tenants: enhancedTenants,
      metadata: {
        totalCount: enhancedTenants.length,
        activeTenantsCount: activeCount,
        leftTenantsCount: leftCount,
        showLeftTenants: showLeftTenants,
        filter: status === 'LEFT'
          ? 'left tenants only'
          : status === 'ALL'
            ? 'all tenants'
            : 'active tenants only'
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single tenant
// @route   GET /api/tenants/:id
// @access  Private
export const getTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access with VIEW_TENANTS permission
    const { hasAccess, tenant } = await checkUserTenantAccess(userId, userRole, req.params.id, 'view');
    
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this tenant',
        requiredPermission: 'VIEW_TENANTS'
      });
    }

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Fetch full tenant details with all includes
    const fullTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        unit: {
          include: {
            property: { include: { landlord: true } }
          }
        },
        paymentReports: { orderBy: { datePaid: 'desc' } },
        serviceCharge: true,
        incomes: true,
        invoices: { orderBy: { createdAt: 'desc' } },
        billInvoices: { orderBy: { createdAt: 'desc' } },
        bills: { orderBy: { createdAt: 'desc' } },
        demandLetters: { orderBy: { createdAt: 'desc' } },
        attachments: { orderBy: { uploadedAt: 'desc' } }
      }
    });

    // Calculate escalated rent
    const rentInfo = calculateEscalatedRent(fullTenant);
    const monthlyRent = rentInfo.currentRent;
    
    // Calculate total payment breakdown
    const paymentBreakdown = calculateTotalPayment(fullTenant, monthlyRent, fullTenant.paymentPolicy);
    
    const rentSchedule = getRentScheduleWithPayments(fullTenant, 3);
    
    // Calculate payment summary with due dates
    const paymentSummary = getPaymentSummary(fullTenant);

    // Build lifecycle info
    const lifecycle = buildLifecycleMetadata(fullTenant);

    // Add status information
    const response = {
      ...fullTenant,
      rentInfo: {
        ...rentInfo,
        monthlyRent: monthlyRent,
        paymentBreakdown: paymentBreakdown
      },
      rentSchedule,
      paymentSummary,
      statusInfo: {
        currentStatus: fullTenant.status,
        isActive: fullTenant.status === 'ACTIVE',
        leftAt: lifecycle.leftAt,
        leftReason: lifecycle.leftReason,
        tenureDays: lifecycle.tenureDays
      },
      lifecycle
    };

    // If tenant has left, show a warning
    if (fullTenant.status === 'LEFT') {
      response.warning = 'This tenant has left the property. All records are preserved for historical purposes.';
    }

    res.json(response);
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get tenants by property ID (active tenants only by default)
// @route   GET /api/tenants/property/:propertyId
// @access  Private
export const getTenantsByProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;
    const { includeLeft, status } = req.query;

    // Check if user has access to this property
    let hasAccess = false;

    if (userRole === 'ADMIN') {
      hasAccess = true;
    } else if (userRole === 'MANAGER') {
      const property = await prisma.property.findFirst({
        where: { id: propertyId, managerId: userId }
      });
      hasAccess = !!property;
    } else if (userRole === 'USER') {
      hasAccess = await checkTenantPermission(userId, userRole, propertyId, 'view');
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this property',
        requiredPermission: 'VIEW_TENANTS'
      });
    }

    // Build where clause
    const whereClause = {
      unit: {
        propertyId: propertyId
      }
    };
    
    if (status === 'LEFT') {
      whereClause.status = 'LEFT';
    } else if (status === 'ALL') {
      // no filter
    } else if (status === 'ACTIVE') {
      whereClause.status = 'ACTIVE';
    } else if (includeLeft !== 'true') {
      whereClause.status = 'ACTIVE';
    }

    // Fetch tenants for this property
    const tenants = await prisma.tenant.findMany({
      where: whereClause,
      include: {
        unit: {
          include: {
            property: true
          }
        },
        paymentReports: {
          orderBy: { datePaid: 'desc' },
          take: 5
        },
        serviceCharge: true,
        incomes: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      },
      orderBy: { fullName: 'asc' }
    });

    // Enhance each tenant with payment information
    const enhancedTenants = tenants.map(tenant => {
      const rentInfo = calculateEscalatedRent(tenant);
      const monthlyRent = rentInfo.currentRent;
      const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
      const paymentSummary = getPaymentSummary(tenant);
      
      // Calculate service charge based on rent ONLY
      const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
      const serviceChargeByPolicy = serviceChargeDetails.amount * getPolicyMonths(tenant.paymentPolicy);
      
      // Calculate VAT on rent
      const vatOnRent = calculateVAT(paymentAmount, tenant.vatType, tenant.vatRate);
      
      // Calculate VAT on service charge
      const vatOnServiceCharge = serviceChargeDetails.vatAmount * getPolicyMonths(tenant.paymentPolicy);
      
      const totalPayment = paymentAmount + vatOnRent + serviceChargeByPolicy + vatOnServiceCharge;
      
      return {
        ...tenant,
        rentInfo: {
          ...rentInfo,
          monthlyRent: monthlyRent,
          paymentAmount: paymentAmount,
          serviceCharge: {
            monthly: serviceChargeDetails.amount,
            byPolicy: serviceChargeByPolicy,
            vatType: serviceChargeDetails.vatType,
            vatRate: serviceChargeDetails.vatRate,
            vatAmount: vatOnServiceCharge,
            totalByPolicy: serviceChargeByPolicy + vatOnServiceCharge
          },
          vatOnRent: vatOnRent,
          totalPayment: totalPayment,
          paymentPolicy: tenant.paymentPolicy
        },
        paymentSummary,
        lifecycle: buildLifecycleMetadata(tenant)
      };
    });

    // Compute counts for this property
    const [activeCount, leftCount] = await Promise.all([
      prisma.tenant.count({ where: { unit: { propertyId }, status: 'ACTIVE' } }),
      prisma.tenant.count({ where: { unit: { propertyId }, status: 'LEFT' } })
    ]);

    const response = {
      tenants: enhancedTenants,
      metadata: {
        totalCount: enhancedTenants.length,
        activeTenantsCount: activeCount,
        leftTenantsCount: leftCount,
        showLeftTenants: status === 'ALL' || includeLeft === 'true',
        filter: status === 'LEFT'
          ? 'left tenants only'
          : status === 'ALL' || includeLeft === 'true'
            ? 'all tenants'
            : 'active tenants only'
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Get tenants by property error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all tenants with overdue payments (optionally filtered by property and days)
// @route   GET /api/tenants/overdue?propertyId=xxx&daysOverdue=7|14|30|60|90|custom&customDays=27
// @access  Private
export const getOverdueTenants = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId, daysOverdue, customDays, includeLeft } = req.query;

    let tenants;
    let baseWhere = {};

    // Default: only ACTIVE tenants
    const showLeftTenants = includeLeft === 'true';
    if (!showLeftTenants) {
      baseWhere.status = 'ACTIVE';
    }

    // Handle property-specific access for USER role
    if (propertyId) {
      if (userRole === 'MANAGER') {
        // Verify manager has access to this specific property
        const property = await prisma.property.findFirst({
          where: {
            id: propertyId,
            managerId: userId
          }
        });

        if (!property) {
          return res.status(403).json({ 
            message: 'Access denied to this property or property not found' 
          });
        }
        
        // Check if manager has VIEW_TENANTS permission
        const hasViewPermission = await checkTenantPermission(userId, userRole, propertyId, 'view');
        if (!hasViewPermission) {
          return res.status(403).json({ 
            message: 'Access denied. You do not have permission to view tenants for this property.',
            requiredPermission: 'VIEW_TENANTS'
          });
        }
      } else if (userRole === 'USER') {
        // Check if USER has VIEW_TENANTS permission for this property
        const hasAccess = await checkTenantPermission(userId, userRole, propertyId, 'view');
        if (!hasAccess) {
          return res.status(403).json({ 
            message: 'Access denied to this property',
            requiredPermission: 'VIEW_TENANTS'
          });
        }
      }

      baseWhere.unit = {
        propertyId: propertyId
      };
    } else {
      // No propertyId provided - apply role-based filtering
      if (userRole === 'MANAGER') {
        baseWhere.unit = {
          property: {
            managerId: userId
          }
        };
      } else if (userRole === 'USER') {
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        if (accessiblePropertyIds.length === 0) {
          return res.json({
            success: true,
            count: 0,
            totalOverdueAmount: 0,
            tenants: [],
            summary: {
              totalOverdueTenants: 0,
              totalOverdueAmount: 0,
              averageOverdueAmount: 0
            },
            filter: {
              propertyId: propertyId || null,
              daysOverdue: daysOverdue || null,
              customDays: customDays ? parseInt(customDays) : null,
              includeLeft: showLeftTenants,
              scope: propertyId ? 'specific_property' : 'accessible_properties'
            }
          });
        }
        
        // Filter properties where user has VIEW_TENANTS permission
        const propertiesWithPermission = [];
        for (const propId of accessiblePropertyIds) {
          const hasViewPermission = await checkTenantPermission(userId, userRole, propId, 'view');
          if (hasViewPermission) {
            propertiesWithPermission.push(propId);
          }
        }
        
        if (propertiesWithPermission.length === 0) {
          return res.json({
            success: true,
            count: 0,
            totalOverdueAmount: 0,
            tenants: [],
            summary: {
              totalOverdueTenants: 0,
              totalOverdueAmount: 0,
              averageOverdueAmount: 0
            },
            filter: {
              propertyId: propertyId || null,
              daysOverdue: daysOverdue || null,
              customDays: customDays ? parseInt(customDays) : null,
              includeLeft: showLeftTenants,
              scope: 'no_permission'
            }
          });
        }
        
        baseWhere.unit = {
          property: {
            id: { in: propertiesWithPermission }
          }
        };
      }
    }

    // Role-based access control
    if (userRole === 'ADMIN' || userRole === 'MANAGER' || userRole === 'USER') {
      tenants = await prisma.tenant.findMany({
        where: baseWhere,
        include: {
          unit: {
            include: {
              property: true
            }
          },
          invoices: {
            where: {
              status: {
                in: ['UNPAID', 'PARTIAL', 'OVERDUE']
              }
            },
            orderBy: {
              dueDate: 'asc'
            }
          },
          paymentReports: {
            orderBy: { datePaid: 'desc' }
          },
          serviceCharge: true,
          incomes: {
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { fullName: 'asc' }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Helper: calculate exact overdue days based on invoice data
    const calculateOverdueDays = (tenant) => {
      const invoices = tenant.invoices || [];
      let maxOverdueDays = 0;
      
      for (const invoice of invoices) {
        const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
        
        if (balance <= 0.01) {
          continue;
        }
        
        const dueDate = new Date(invoice.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        
        if (dueDate < today) {
          const diffTime = today - dueDate;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > maxOverdueDays) {
            maxOverdueDays = diffDays;
          }
        }
      }
      
      return maxOverdueDays;
    };
    
    // Helper: get total overdue amount for a tenant
    const calculateTotalOverdueAmount = (tenant) => {
      const invoices = tenant.invoices || [];
      let totalOverdue = 0;
      
      for (const invoice of invoices) {
        const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
        
        if (balance <= 0.01) {
          continue;
        }
        
        const dueDate = new Date(invoice.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        
        if (dueDate < today) {
          totalOverdue += balance;
        }
      }
      
      return totalOverdue;
    };
    
    // Helper: human-readable overdue period
    const getOverduePeriodText = (days) => {
      if (days <= 0) return 'Not overdue';
      if (days <= 7) return `${days} day${days !== 1 ? 's' : ''} (1 week)`;
      if (days <= 14) return `${days} days (2 weeks)`;
      if (days <= 30) return `${days} days (1 month)`;
      if (days <= 60) return `${days} days (2 months)`;
      if (days <= 90) return `${days} days (3 months)`;
      if (days <= 180) return `${days} days (6 months)`;
      return `${days} days (Over 6 months)`;
    };
    
    // Helper: overdue category
    const getOverdueCategoryLocal = (days) => {
      if (days <= 0) return 'NOT_OVERDUE';
      if (days <= 7) return '1_WEEK';
      if (days <= 14) return '2_WEEKS';
      if (days <= 30) return '1_MONTH';
      if (days <= 60) return '2_MONTHS';
      if (days <= 90) return '3_MONTHS';
      return 'OVER_3_MONTHS';
    };

    // Filter tenants with overdue payments based on invoice data
    let overdueTenants = tenants
      .map(tenant => {
        const rentInfo = calculateEscalatedRent(tenant);
        const monthlyRent = rentInfo.currentRent;
        const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
        const paymentSummary = getPaymentSummary(tenant);
        const overdueDays = calculateOverdueDays(tenant);
        const totalOverdueAmount = calculateTotalOverdueAmount(tenant);
        
        const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
        const serviceChargeByPolicy = serviceChargeDetails.amount * getPolicyMonths(tenant.paymentPolicy);
        
        const vatOnRent = calculateVAT(paymentAmount, tenant.vatType, tenant.vatRate);
        const vatOnServiceCharge = serviceChargeDetails.vatAmount * getPolicyMonths(tenant.paymentPolicy);
        
        const totalPayment = paymentAmount + vatOnRent + serviceChargeByPolicy + vatOnServiceCharge;
        
        const invoices = tenant.invoices || [];
        const outstandingInvoices = invoices.filter(inv => {
          const balance = inv.balance || (inv.totalDue - inv.amountPaid);
          return balance > 0.01;
        });
        
        return {
          ...tenant,
          rentInfo: {
            ...rentInfo,
            monthlyRent: monthlyRent,
            paymentAmount: paymentAmount,
            serviceCharge: {
              monthly: serviceChargeDetails.amount,
              byPolicy: serviceChargeByPolicy,
              vatType: serviceChargeDetails.vatType,
              vatRate: serviceChargeDetails.vatRate,
              vatAmount: vatOnServiceCharge,
              totalByPolicy: serviceChargeByPolicy + vatOnServiceCharge
            },
            vatOnRent: vatOnRent,
            totalPayment: totalPayment,
            paymentPolicy: tenant.paymentPolicy
          },
          paymentSummary,
          lifecycle: buildLifecycleMetadata(tenant),
          invoiceDetails: {
            totalInvoices: invoices.length,
            outstandingInvoices: outstandingInvoices.length,
            outstandingAmount: outstandingInvoices.reduce((sum, inv) => {
              const balance = inv.balance || (inv.totalDue - inv.amountPaid);
              return sum + balance;
            }, 0),
            invoices: outstandingInvoices.map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              totalDue: inv.totalDue,
              amountPaid: inv.amountPaid,
              balance: inv.balance || (inv.totalDue - inv.amountPaid),
              status: inv.status,
              dueDate: inv.dueDate,
              paymentPeriod: inv.paymentPeriod,
              daysOverdue: Math.max(0, Math.ceil((new Date() - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24)))
            }))
          },
          overdueDetails: {
            daysOverdue: overdueDays,
            periodText: getOverduePeriodText(overdueDays),
            category: getOverdueCategoryLocal(overdueDays),
            totalOverdueAmount: totalOverdueAmount
          }
        };
      })
      .filter(tenant => {
        const invoices = tenant.invoices || [];
        
        const hasOutstandingInvoices = invoices.some(inv => {
          const balance = inv.balance || (inv.totalDue - inv.amountPaid);
          return balance > 0.01;
        });
        
        if (!hasOutstandingInvoices) {
          return false;
        }
        
        const hasOverdueInvoice = invoices.some(inv => {
          const balance = inv.balance || (inv.totalDue - inv.amountPaid);
          const dueDate = new Date(inv.dueDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          dueDate.setHours(0, 0, 0, 0);
          
          return balance > 0.01 && dueDate < today;
        });
        
        if (!hasOverdueInvoice) {
          return false;
        }
        
        if (daysOverdue) {
          const overdueDays = tenant.overdueDetails.daysOverdue;
          
          if (daysOverdue === 'custom' && customDays) {
            const customDaysNum = parseInt(customDays);
            return overdueDays >= customDaysNum;
          } else {
            const filterDays = parseInt(daysOverdue);
            return overdueDays >= filterDays;
          }
        }
        
        return true;
      });

    // Calculate summary statistics
    const totalOverdueAmount = overdueTenants.reduce((sum, tenant) => {
      return sum + tenant.overdueDetails.totalOverdueAmount;
    }, 0);

    const totalOverdueTenants = overdueTenants.length;
    
    const overdueDaysStats = {
      min: overdueTenants.length > 0 ? Math.min(...overdueTenants.map(t => t.overdueDetails.daysOverdue)) : 0,
      max: overdueTenants.length > 0 ? Math.max(...overdueTenants.map(t => t.overdueDetails.daysOverdue)) : 0,
      average: overdueTenants.length > 0 
        ? Math.round(overdueTenants.reduce((sum, t) => sum + t.overdueDetails.daysOverdue, 0) / overdueTenants.length)
        : 0
    };
    
    const overdueCategories = {
      week1: overdueTenants.filter(t => t.overdueDetails.daysOverdue <= 7).length,
      week2: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 7 && t.overdueDetails.daysOverdue <= 14).length,
      month1: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 14 && t.overdueDetails.daysOverdue <= 30).length,
      month2: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 30 && t.overdueDetails.daysOverdue <= 60).length,
      month3: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 60 && t.overdueDetails.daysOverdue <= 90).length,
      more: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 90).length
    };
    
    const totalOutstandingInvoices = overdueTenants.reduce((sum, tenant) => {
      return sum + tenant.invoiceDetails.outstandingInvoices;
    }, 0);

    res.json({
      success: true,
      count: totalOverdueTenants,
      totalOverdueAmount: parseFloat(totalOverdueAmount.toFixed(2)),
      tenants: overdueTenants,
      summary: {
        totalOverdueTenants,
        totalOverdueAmount: parseFloat(totalOverdueAmount.toFixed(2)),
        averageOverdueAmount: totalOverdueTenants > 0 ? parseFloat((totalOverdueAmount / totalOverdueTenants).toFixed(2)) : 0,
        totalOutstandingInvoices,
        overdueDaysStats,
        overdueCategories
      },
      filter: {
        propertyId: propertyId || null,
        daysOverdue: daysOverdue || null,
        customDays: customDays ? parseInt(customDays) : null,
        includeLeft: showLeftTenants,
        scope: propertyId ? 'specific_property' : (userRole === 'MANAGER' ? 'managed_properties' : (userRole === 'USER' ? 'accessible_properties' : 'all_properties'))
      }
    });
  } catch (error) {
    console.error('Get overdue tenants error:', error);
    res.status(400).json({ message: error.message });
  }
};

// Helper function to get overdue category
function getOverdueCategory(days) {
  if (days <= 0) return 'NOT_OVERDUE';
  if (days <= 7) return '1_WEEK';
  if (days <= 14) return '2_WEEKS';
  if (days <= 30) return '1_MONTH';
  if (days <= 60) return '2_MONTHS';
  if (days <= 90) return '3_MONTHS';
  return 'OVER_3_MONTHS';
}

// @desc    Get tenants with their next upcoming payment due date (regardless of time)
// @route   GET /api/tenants/property/:propertyId/next-payments
// @access  Private
export const getNextPaymentsByProperty = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { propertyId } = req.params;

        // Check access to property
        let hasAccess = false;

        if (userRole === 'ADMIN') {
            hasAccess = true;
        } else if (userRole === 'MANAGER') {
            const property = await prisma.property.findFirst({
                where: { id: propertyId, managerId: userId }
            });
            hasAccess = !!property;
        } else if (userRole === 'USER') {
            hasAccess = await checkTenantPermission(userId, userRole, propertyId, 'view');
        }

        if (!hasAccess) {
            return res.status(403).json({
                message: 'Access denied to this property',
                requiredPermission: 'VIEW_TENANTS'
            });
        }

        // Fetch ONLY ACTIVE tenants for the property
        const tenants = await prisma.tenant.findMany({
            where: {
                unit: {
                    propertyId: propertyId
                },
                status: 'ACTIVE'
            },
            include: {
                unit: {
                    include: {
                        property: true
                    }
                },
                paymentReports: {
                    orderBy: { datePaid: 'desc' }
                },
                serviceCharge: true,
                invoices: {
                    orderBy: { dueDate: 'asc' }
                },
                billInvoices: {
                    where: {
                        status: { in: ['UNPAID', 'PARTIAL'] }
                    },
                    orderBy: { dueDate: 'asc' }
                }
            },
            orderBy: { fullName: 'asc' }
        });

        // Calculate next payment for EACH tenant
        const tenantsWithNextPayment = [];
        const now = new Date();

        // Create a Nairobi timezone date for accurate day calculations
        const nairobiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
        const nairobiTodayStart = new Date(nairobiNow);
        nairobiTodayStart.setHours(0, 0, 0, 0);

        for (const tenant of tenants) {
            const rentInfo = calculateEscalatedRent(tenant);
            const monthlyRent = rentInfo.currentRent;

            const paymentBreakdown = calculateTotalPayment(tenant, monthlyRent, tenant.paymentPolicy);

            // USE getPaymentSummary AS THE SOURCE OF TRUTH
            const paymentSummary = getPaymentSummary(tenant);

            const totalDuePerPeriod = paymentSummary.totalDuePerPeriod || paymentBreakdown.total.paymentByPolicy || 0;
            const totalDueWithoutWithholding = paymentSummary.totalDueWithoutWithholding || 0;
            const totalWithheld = paymentSummary.totalWithheld || 0;

            const outstandingBalance = paymentSummary.paymentHistory?.outstandingBalance || 0;
            const totalPaid = paymentSummary.paymentHistory?.totalPaid || 0;
            const totalExpected = paymentSummary.paymentHistory?.expectedTotal || 0;
            const paymentsBehind = paymentSummary.nextPayment?.paymentsBehind || 0;
            const expectedPaymentsCount = paymentSummary.paymentHistory?.expectedPaymentsCount || 0;

            const periodRentAmount = paymentBreakdown.rent.paymentByPolicy || 0;
            const periodServiceCharge = paymentBreakdown.serviceCharge.paymentByPolicy || 0;
            const periodVatOnRent = paymentBreakdown.rent.vatAmount || 0;
            const periodVatOnServiceCharge = paymentBreakdown.serviceCharge.vatAmount || 0;

            const nextDueDate = paymentSummary.nextPayment?.dueDate;
            const isOverdue = paymentSummary.nextPayment?.isOverdue || false;
            const isInGracePeriod = paymentSummary.nextPayment?.isInGracePeriod || false;
            const gracePeriodEnd = paymentSummary.nextPayment?.gracePeriodEnd || null;

            const status = paymentSummary.status || 'UNPAID';

            const hasOutstandingBalance = outstandingBalance > 0.01;

            let isTrulyOverdue = false;
            let overdueSinceDate = null;
            let daysOverdue = 0;

            if (hasOutstandingBalance) {
                const hasUnpaidInvoices = tenant.invoices && tenant.invoices.some(inv => {
                    const balance = inv.balance || (inv.totalDue - inv.amountPaid);
                    const isUnpaid = inv.status === 'UNPAID' || inv.status === 'OVERDUE';
                    const isPartialWithBalance = inv.status === 'PARTIAL' && balance > 0.01;
                    return (isUnpaid || isPartialWithBalance);
                });

                if (hasUnpaidInvoices) {
                    const invoicesWithBalance = tenant.invoices.filter(inv => {
                        const balance = inv.balance || (inv.totalDue - inv.amountPaid);
                        const isUnpaid = inv.status === 'UNPAID' || inv.status === 'OVERDUE';
                        const isPartialWithBalance = inv.status === 'PARTIAL' && balance > 0.01;
                        return (isUnpaid || isPartialWithBalance) && balance > 0.01;
                    });

                    if (invoicesWithBalance.length > 0) {
                        const sortedInvoices = invoicesWithBalance.sort((a, b) =>
                            new Date(a.dueDate) - new Date(b.dueDate)
                        );

                        const earliestInvoice = sortedInvoices[0];
                        const dueDate = new Date(earliestInvoice.dueDate);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        dueDate.setHours(0, 0, 0, 0);

                        if (dueDate < today) {
                            let gracePeriodEndDate = new Date(dueDate);
                            gracePeriodEndDate.setDate(gracePeriodEndDate.getDate() + 5);
                            gracePeriodEndDate.setHours(23, 59, 59, 999);

                            if (today > gracePeriodEndDate) {
                                isTrulyOverdue = true;
                                overdueSinceDate = new Date(dueDate);
                            }
                        }
                    }
                }
            }

            if (overdueSinceDate) {
                overdueSinceDate.setHours(23, 59, 59, 999);
                const overdueStart = new Date(overdueSinceDate);
                overdueStart.setHours(0, 0, 0, 0);
                const diffTime = overdueStart - nairobiTodayStart;
                daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            let futureDueDate = null;
            let dueDateFormatted = null;
            let daysUntilDue = 0;
            let isOverdueInNairobi = false;
            let daysUntilGraceEnd = null;

            if (nextDueDate) {
                const policyMonths = getPolicyMonths(tenant.paymentPolicy);
                const nextDue = new Date(nextDueDate);

                let futureDue = new Date(nextDue);
                while (futureDue <= now) {
                    futureDue.setMonth(futureDue.getMonth() + policyMonths);
                }
                futureDue.setHours(23, 59, 59, 999);
                futureDueDate = futureDue;

                try {
                    const dueDateInNairobi = new Date(futureDue.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
                    dueDateFormatted = dueDateInNairobi.toLocaleDateString('en-US', {
                        timeZone: 'Africa/Nairobi',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    });

                    const dueDateStart = new Date(dueDateInNairobi);
                    dueDateStart.setHours(0, 0, 0, 0);
                    const diffTime = dueDateStart - nairobiTodayStart;
                    daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    isOverdueInNairobi = nairobiTodayStart > dueDateStart;
                } catch (dateError) {
                    console.error('Error processing date for tenant:', tenant.id, dateError);
                    dueDateFormatted = futureDue.toLocaleDateString();
                }

                if (gracePeriodEnd && hasOutstandingBalance) {
                    try {
                        const graceEndInNairobi = new Date(gracePeriodEnd.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
                        const graceEndStart = new Date(graceEndInNairobi);
                        graceEndStart.setHours(0, 0, 0, 0);

                        if (isInGracePeriod) {
                            const graceDiffTime = graceEndStart - nairobiTodayStart;
                            daysUntilGraceEnd = Math.ceil(graceDiffTime / (1000 * 60 * 60 * 24));
                        }
                    } catch (graceError) {
                        console.error('Error calculating grace period for tenant:', tenant.id, graceError);
                    }
                }
            } else {
                const rentStartDate = new Date(tenant.rentStart);
                const policyMonths = getPolicyMonths(tenant.paymentPolicy);
                let futureDue = new Date(rentStartDate);

                while (futureDue <= now) {
                    futureDue.setMonth(futureDue.getMonth() + policyMonths);
                }
                futureDue.setHours(23, 59, 59, 999);
                futureDueDate = futureDue;

                dueDateFormatted = futureDue.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
            }

            let totalAmountDue = totalDuePerPeriod;

            if (outstandingBalance > 0) {
                totalAmountDue = totalDuePerPeriod + outstandingBalance;
            } else if (outstandingBalance < 0) {
                const creditAmount = Math.abs(outstandingBalance);
                if (creditAmount >= totalDuePerPeriod) {
                    totalAmountDue = 0;
                } else {
                    totalAmountDue = totalDuePerPeriod - creditAmount;
                }
            }

            let amountBreakdown = {
                rent: periodRentAmount,
                serviceCharge: periodServiceCharge,
                vatOnRent: periodVatOnRent,
                vatOnServiceCharge: periodVatOnServiceCharge,
                total: totalAmountDue
            };

            if (outstandingBalance !== 0 && totalDuePerPeriod > 0) {
                const ratio = (totalAmountDue / totalDuePerPeriod);
                amountBreakdown = {
                    rent: periodRentAmount * ratio,
                    serviceCharge: periodServiceCharge * ratio,
                    vatOnRent: periodVatOnRent * ratio,
                    vatOnServiceCharge: periodVatOnServiceCharge * ratio,
                    total: totalAmountDue
                };
            }

            let overdueSinceFormatted = null;
            if (overdueSinceDate) {
                try {
                    const overdueSinceInNairobi = new Date(overdueSinceDate.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
                    overdueSinceFormatted = overdueSinceInNairobi.toLocaleDateString('en-US', {
                        timeZone: 'Africa/Nairobi',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    });
                } catch (dateError) {
                    overdueSinceFormatted = overdueSinceDate.toLocaleDateString();
                }
            }

            let gracePeriodEndFormatted = null;
            if (gracePeriodEnd && hasOutstandingBalance) {
                try {
                    const graceEndInNairobi = new Date(gracePeriodEnd.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
                    gracePeriodEndFormatted = graceEndInNairobi.toLocaleDateString('en-US', {
                        timeZone: 'Africa/Nairobi',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    });
                } catch (dateError) {
                    gracePeriodEndFormatted = gracePeriodEnd.toLocaleDateString();
                }
            }

            let statusDisplay = status;

            if (outstandingBalance > 0 && isTrulyOverdue) {
                statusDisplay = 'OVERDUE';
            } else if (isInGracePeriod && hasOutstandingBalance) {
                statusDisplay = 'IN_GRACE_PERIOD';
            } else if (outstandingBalance > 0 && !isTrulyOverdue) {
                statusDisplay = 'PARTIALLY_PAID';
            } else if (outstandingBalance === 0 && totalPaid > 0) {
                statusDisplay = 'PAID';
            }

            tenantsWithNextPayment.push({
                id: tenant.id,
                name: tenant.fullName,
                contact: {
                    email: tenant.email || null,
                    phone: tenant.contact || null,
                    kra: tenant.KRAPin || null
                },
                unit: {
                    number: tenant.unit?.unitNo || 'N/A',
                    type: tenant.unit?.type || tenant.unit?.unitType || 'Unit',
                    size: tenant.unit?.sizeSqFt || 0,
                    floor: tenant.unit?.floor || 'N/A'
                },
                payment: {
                    dueDate: dueDateFormatted || 'Not set',
                    dueDateRaw: futureDueDate || null,
                    daysUntilDue: daysUntilDue,
                    isOverdue: isTrulyOverdue,
                    isInGracePeriod: isInGracePeriod && hasOutstandingBalance,
                    daysUntilGraceEnd: hasOutstandingBalance ? daysUntilGraceEnd : null,
                    gracePeriodEnd: hasOutstandingBalance ? gracePeriodEndFormatted : null,
                    amount: {
                        rent: amountBreakdown.rent || periodRentAmount,
                        serviceCharge: amountBreakdown.serviceCharge || periodServiceCharge,
                        vatOnRent: amountBreakdown.vatOnRent || periodVatOnRent,
                        vatOnServiceCharge: amountBreakdown.vatOnServiceCharge || periodVatOnServiceCharge,
                        total: totalAmountDue
                    },
                    status: statusDisplay,
                    policy: tenant.paymentPolicy || 'MONTHLY',
                    paymentsBehind: paymentsBehind > 0 ? paymentsBehind : (outstandingBalance > 0 ? Math.ceil(outstandingBalance / totalDuePerPeriod) : 0),
                    totalPaid: totalPaid,
                    totalExpected: totalExpected,
                    expectedPeriods: expectedPaymentsCount,
                    totalDuePerPeriod: totalDuePerPeriod,
                    totalDueWithoutWithholding: totalDueWithoutWithholding,
                    totalWithheld: totalWithheld,
                    outstandingBalance: outstandingBalance,
                    regularPeriodAmount: totalDuePerPeriod,
                    overdueSince: isTrulyOverdue ? overdueSinceFormatted : null,
                    overdueSinceRaw: isTrulyOverdue && overdueSinceDate ? overdueSinceDate.toISOString() : null,
                    daysOverdue: isTrulyOverdue ? daysOverdue : 0
                },
                rent: {
                    current: monthlyRent || 0,
                    escalation: tenant.escalationRate ? {
                        rate: tenant.escalationRate,
                        frequency: tenant.escalationFrequency,
                        nextDate: rentInfo?.nextEscalationDate || null
                    } : null
                },
                history: paymentSummary?.paymentHistory?.lastPaymentDate ? {
                    lastPayment: paymentSummary.paymentHistory.lastPaymentDateFormatted,
                    paymentsMade: paymentSummary.paymentHistory.paymentsMade
                } : null,
                invoiceStatus: paymentSummary.invoiceStatus || null
            });
        }

        // Sort: Overdue first, then by days until due
        tenantsWithNextPayment.sort((a, b) => {
            if (a.payment.isOverdue && !b.payment.isOverdue) return -1;
            if (!a.payment.isOverdue && b.payment.isOverdue) return 1;
            return a.payment.daysUntilDue - b.payment.daysUntilDue;
        });

        const summary = {
            total: tenantsWithNextPayment.length,
            overdue: tenantsWithNextPayment.filter(t => t.payment.isOverdue).length,
            inGracePeriod: tenantsWithNextPayment.filter(t => t.payment.isInGracePeriod).length,
            dueToday: tenantsWithNextPayment.filter(t => t.payment.daysUntilDue === 0).length,
            upcoming: tenantsWithNextPayment.filter(t => !t.payment.isOverdue && t.payment.daysUntilDue > 0).length,
            amounts: {
                outstanding: tenantsWithNextPayment.reduce((sum, t) =>
                    sum + (t.payment.isOverdue ? t.payment.amount.total : 0), 0),
                upcoming: tenantsWithNextPayment.reduce((sum, t) =>
                    sum + (!t.payment.isOverdue ? t.payment.amount.total : 0), 0)
            },
            byPolicy: {
                MONTHLY: tenantsWithNextPayment.filter(t => t.payment.policy === 'MONTHLY').length,
                QUARTERLY: tenantsWithNextPayment.filter(t => t.payment.policy === 'QUARTERLY').length,
                ANNUAL: tenantsWithNextPayment.filter(t => t.payment.policy === 'ANNUAL').length
            }
        };

        let propertyName = 'Unknown';
        if (tenants.length > 0 && tenants[0]?.unit?.property?.name) {
            propertyName = tenants[0].unit.property.name;
        }

        res.json({
            success: true,
            property: {
                id: propertyId,
                name: propertyName
            },
            summary,
            payments: tenantsWithNextPayment
        });

    } catch (error) {
        console.error('Get next payments error:', error);
        res.status(400).json({ message: error.message });
    }
};

// @desc    Create tenant
// @route   POST /api/tenants
// @access  Private (ADMIN, MANAGER, and USER with CREATE_TENANT permission)
export const createTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { unitId } = req.body;

    // Check if unit exists first
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: true }
    });
    
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Check if user has CREATE_TENANT permission
    if (userRole === 'USER') {
      const hasCreatePermission = await checkTenantPermission(
        userId, 
        userRole, 
        unit.propertyId, 
        'create'
      );
      
      if (!hasCreatePermission) {
        return res.status(403).json({ 
          message: 'Access denied. You do not have permission to create tenants on this property.',
          requiredPermission: 'CREATE_TENANT'
        });
      }
    } else if (userRole === 'MANAGER') {
      if (unit.property.managerId !== userId) {
        return res.status(403).json({ message: 'Access denied to this unit' });
      }
    }

    const {
      fullName,
      email,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent,
      escalationRate,
      escalationFrequency,
      termStart,
      rentStart,
      deposit,
      paymentPolicy,
      vatRate,
      vatType,
      serviceCharge,
      withholdingTaxRate,
      withholdingVatRate,
      isWithholdingTaxExempt
    } = req.body;

    // Validate required fields
    if (
      !fullName ||
      !email ||
      !contact ||
      !KRAPin ||
      !unitId ||
      !leaseTerm ||
      rent == null ||
      !termStart ||
      !rentStart ||
      deposit == null ||
      !paymentPolicy
    ) {
      return res.status(400).json({
        message: "All fields except POBox, escalationRate, escalationFrequency, vatRate, vatType, serviceCharge, withholdingTaxRate, withholdingVatRate, and isWithholdingTaxExempt are required.",
      });
    }

    // Check email uniqueness
    const existingEmail = await prisma.tenant.findUnique({
      where: { email },
    });

    if (existingEmail) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Check if KRA Pin is unique
    const existingKRA = await prisma.tenant.findUnique({
      where: { KRAPin },
    });

    if (existingKRA) {
      return res.status(400).json({ message: "KRA Pin already exists" });
    }

    if (unit.status === "OCCUPIED") {
      return res.status(400).json({ message: "Unit is already occupied" });
    }

    // Also check for existing ACTIVE tenant on this unit
    const existingActiveTenant = await prisma.tenant.findFirst({
      where: { unitId, status: 'ACTIVE' }
    });

    if (existingActiveTenant) {
      return res.status(400).json({
        message: `Unit is already assigned to an active tenant: ${existingActiveTenant.fullName}`
      });
    }

    // Validate payment policy
    const validPaymentPolicies = ["MONTHLY", "QUARTERLY", "ANNUAL"];
    const normalizedPaymentPolicy = paymentPolicy.toUpperCase();
    if (!validPaymentPolicies.includes(normalizedPaymentPolicy)) {
      return res.status(400).json({
        message: `Invalid payment policy. Must be one of: ${validPaymentPolicies.join(", ")}`,
      });
    }

    // Validate escalation frequency
    let normalizedEscalationFrequency = null;
    if (escalationFrequency !== undefined && escalationFrequency !== null) {
      const validEscalations = ["ANNUALLY", "BI_ANNUALLY", "BI_ENNIAL"];
      normalizedEscalationFrequency = escalationFrequency.toUpperCase();
      if (!validEscalations.includes(normalizedEscalationFrequency)) {
        return res.status(400).json({
          message: `Invalid escalation frequency. Must be one of: ${validEscalations.join(", ")}, or null`,
        });
      }
    }

    // Validate VAT type
    let normalizedVatType = "NOT_APPLICABLE";
    if (vatType !== undefined && vatType !== null) {
      const validVatTypes = ["INCLUSIVE", "EXCLUSIVE", "NOT_APPLICABLE"];
      normalizedVatType = vatType.toUpperCase();
      if (!validVatTypes.includes(normalizedVatType)) {
        return res.status(400).json({
          message: `Invalid VAT type. Must be one of: ${validVatTypes.join(", ")}`,
        });
      }
    }

    // Validate VAT rate
    let parsedVatRate = 0;
    if (vatRate !== undefined && vatRate !== null) {
      parsedVatRate = parseFloat(vatRate);
      if (isNaN(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100) {
        return res.status(400).json({
          message: "VAT rate must be a number between 0 and 100",
        });
      }
    }

    if (normalizedVatType === "NOT_APPLICABLE") {
      parsedVatRate = 0;
    }

    // Validate withholding tax rate
    let parsedWithholdingTaxRate = 0;
    if (withholdingTaxRate !== undefined && withholdingTaxRate !== null) {
      parsedWithholdingTaxRate = parseFloat(withholdingTaxRate);
      if (isNaN(parsedWithholdingTaxRate) || parsedWithholdingTaxRate < 0 || parsedWithholdingTaxRate > 100) {
        return res.status(400).json({
          message: "Withholding tax rate must be a number between 0 and 100",
        });
      }
    }

    // Validate withholding VAT rate
    let parsedWithholdingVatRate = 0;
    if (withholdingVatRate !== undefined && withholdingVatRate !== null) {
      parsedWithholdingVatRate = parseFloat(withholdingVatRate);
      if (isNaN(parsedWithholdingVatRate) || parsedWithholdingVatRate < 0 || parsedWithholdingVatRate > 100) {
        return res.status(400).json({
          message: "Withholding VAT rate must be a number between 0 and 100",
        });
      }
    }

    const isExempt = isWithholdingTaxExempt === true;
    const parsedRent = parseFloat(rent);

    // Build tenant data
    const tenantData = {
      fullName,
      email,
      contact,
      KRAPin,
      POBox: POBox || null,
      unitId,
      leaseTerm,
      rent: parsedRent,
      escalationRate: escalationRate != null ? parseFloat(escalationRate) : null,
      escalationFrequency: normalizedEscalationFrequency,
      termStart: new Date(termStart),
      rentStart: new Date(rentStart),
      deposit: parseFloat(deposit),
      paymentPolicy: normalizedPaymentPolicy,
      vatRate: parsedVatRate,
      vatType: normalizedVatType,
      withholdingTaxRate: parsedWithholdingTaxRate,
      withholdingVatRate: parsedWithholdingVatRate,
      isWithholdingTaxExempt: isExempt,
      // Lifecycle: new tenants are ACTIVE
      status: 'ACTIVE',
      leftAt: null,
      leftReason: null,
    };

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: tenantData,
      include: {
        unit: { include: { property: true } },
        serviceCharge: true,
      },
    });

    // Update unit
    await prisma.unit.update({
      where: { id: unitId },
      data: {
        rentAmount: parsedRent,
        status: "OCCUPIED",
      },
    });

    // Handle service charge
    if (serviceCharge) {
      const validTypes = ["FIXED", "PERCENTAGE", "PER_SQ_FT"];
      const normalizedType = serviceCharge.type?.toUpperCase();

      if (!normalizedType || !validTypes.includes(normalizedType)) {
        return res.status(400).json({
          message: `Invalid service charge type. Must be: ${validTypes.join(", ")}`,
        });
      }

      let normalizedServiceVatType = "NOT_APPLICABLE";
      if (serviceCharge.vatType) {
        const validVatTypes = ["INCLUSIVE", "EXCLUSIVE", "NOT_APPLICABLE"];
        normalizedServiceVatType = serviceCharge.vatType.toUpperCase();
        if (!validVatTypes.includes(normalizedServiceVatType)) {
          return res.status(400).json({
            message: `Invalid service charge VAT type. Must be one of: ${validVatTypes.join(", ")}`,
          });
        }
      }

      let parsedServiceVatRate = 0;
      if (serviceCharge.vatRate !== undefined && serviceCharge.vatRate !== null) {
        parsedServiceVatRate = parseFloat(serviceCharge.vatRate);
        if (isNaN(parsedServiceVatRate) || parsedServiceVatRate < 0 || parsedServiceVatRate > 100) {
          return res.status(400).json({
            message: "Service charge VAT rate must be a number between 0 and 100",
          });
        }
      }

      if (normalizedServiceVatType === "NOT_APPLICABLE") {
        parsedServiceVatRate = 0;
      }

      const serviceChargeData = {
        tenantId: tenant.id,
        type: normalizedType,
        fixedAmount: serviceCharge.fixedAmount ? parseFloat(serviceCharge.fixedAmount) : null,
        percentage: serviceCharge.percentage ? parseFloat(serviceCharge.percentage) : null,
        perSqFtRate: serviceCharge.perSqFtRate ? parseFloat(serviceCharge.perSqFtRate) : null,
        vatType: normalizedServiceVatType,
        vatRate: parsedServiceVatRate,
      };

      await prisma.serviceCharge.create({
        data: serviceChargeData,
      });
    }

    res.status(201).json(
      await prisma.tenant.findUnique({
        where: { id: tenant.id },
        include: {
          unit: { include: { property: true } },
          serviceCharge: true,
        },
      })
    );
  } catch (error) {
    console.error("Create tenant error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Update tenant
// @route   PUT /api/tenants/:id
// @access  Private (ADMIN, MANAGER, and USER with EDIT_TENANT permission)
export const updateTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has edit permission
    const hasWriteAccess = await checkUserWriteAccess(userId, userRole, req.params.id, 'edit');
    if (!hasWriteAccess) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to update this tenant.',
        requiredPermission: 'EDIT_TENANT'
      });
    }

    const {
      fullName,
      email,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent,
      escalationRate,
      escalationFrequency,
      termStart,
      rentStart,
      deposit,
      paymentPolicy,
      vatRate,
      vatType,
      serviceCharge,
      unitId,
      withholdingTaxRate,
      withholdingVatRate,
      isWithholdingTaxExempt
    } = req.body;

    // Fetch existing tenant
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        serviceCharge: true,
        unit: {
          include: {
            property: true
          }
        },
      },
    });

    if (!existingTenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    // Handle unit transfer
    let targetUnit = null;
    let unitPriceWarning = null;

    if (unitId && unitId !== existingTenant.unitId) {
      targetUnit = await prisma.unit.findUnique({
        where: { id: unitId },
        include: {
          property: true,
          tenants: {
            where: { status: 'ACTIVE' }
          }
        }
      });

      if (!targetUnit) {
        return res.status(404).json({ message: "Target unit not found" });
      }

      if (targetUnit.propertyId !== existingTenant.unit.propertyId) {
        return res.status(400).json({
          message: "Cannot move tenant to a unit in a different property. Please update property separately."
        });
      }

      const activeTenantInTarget = targetUnit.tenants?.[0] || null;
      const isUnitOccupied = targetUnit.status === 'OCCUPIED' || activeTenantInTarget !== null;

      if (isUnitOccupied) {
        let detailedMessage = "Target unit is not vacant.";
        const reasons = [];

        if (targetUnit.status === 'OCCUPIED') {
          reasons.push(`Unit status is 'OCCUPIED'`);
        }
        if (activeTenantInTarget) {
          reasons.push(`Unit has tenant: ${activeTenantInTarget.fullName}`);
        }

        if (reasons.length > 0) {
          detailedMessage += ` (${reasons.join(', ')})`;
        }

        return res.status(400).json({
          message: detailedMessage,
          unitStatus: targetUnit.status,
          hasTenant: !!activeTenantInTarget,
          tenantName: activeTenantInTarget?.fullName || null
        });
      }

      // Double-check for ACTIVE tenant in target
      const existingActiveTenantInTarget = await prisma.tenant.findFirst({
        where: {
          unitId: targetUnit.id,
          status: 'ACTIVE'
        }
      });

      if (existingActiveTenantInTarget) {
        return res.status(400).json({
          message: `Target unit is already assigned to another tenant: ${existingActiveTenantInTarget.fullName}`
        });
      }

      const currentUnitRent = existingTenant.rent || existingTenant.unit.rentAmount;
      const newUnitRent = targetUnit.rentAmount;

      if (newUnitRent !== currentUnitRent) {
        unitPriceWarning = {
          message: `The rent for the new unit (${newUnitRent}) is different from your current rent (${currentUnitRent}).`,
          currentRent: currentUnitRent,
          newRent: newUnitRent,
          difference: newUnitRent - currentUnitRent,
          differenceType: newUnitRent > currentUnitRent ? 'increase' : 'decrease'
        };
      }
    }

    // Check email uniqueness
    if (email && email !== existingTenant.email) {
      const existing = await prisma.tenant.findUnique({ where: { email } });
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    // Check KRA uniqueness
    if (KRAPin && KRAPin !== existingTenant.KRAPin) {
      const existingKRA = await prisma.tenant.findUnique({ where: { KRAPin } });
      if (existingKRA) {
        return res.status(400).json({ message: "KRA Pin already exists" });
      }
    }

    // Validate payment policy
    let normalizedPaymentPolicy = undefined;
    if (paymentPolicy !== undefined) {
      const validPolicies = ["MONTHLY", "QUARTERLY", "ANNUAL"];
      normalizedPaymentPolicy = paymentPolicy.toUpperCase();
      if (!validPolicies.includes(normalizedPaymentPolicy)) {
        return res.status(400).json({
          message: `Invalid payment policy. Must be one of: ${validPolicies.join(", ")}`,
        });
      }
    }

    // Validate escalation frequency
    let normalizedEscalationFrequency = undefined;
    if (escalationFrequency !== undefined) {
      if (escalationFrequency === null) {
        normalizedEscalationFrequency = null;
      } else {
        const validEscalations = ["ANNUALLY", "BI_ANNUALLY", "BI_ENNIAL"];
        normalizedEscalationFrequency = escalationFrequency.toUpperCase();
        if (!validEscalations.includes(normalizedEscalationFrequency)) {
          return res.status(400).json({
            message: `Invalid escalation frequency. Must be: ${validEscalations.join(", ")}, or null`,
          });
        }
      }
    }

    // Validate VAT type
    let normalizedVatType = undefined;
    if (vatType !== undefined) {
      const validVatTypes = ["INCLUSIVE", "EXCLUSIVE", "NOT_APPLICABLE"];
      normalizedVatType = vatType.toUpperCase();
      if (!validVatTypes.includes(normalizedVatType)) {
        return res.status(400).json({
          message: `Invalid VAT type. Must be: ${validVatTypes.join(", ")}`,
        });
      }
    }

    // Validate VAT rate
    let parsedVatRate = undefined;
    if (vatRate !== undefined) {
      if (vatRate === null) {
        parsedVatRate = 0;
      } else {
        parsedVatRate = parseFloat(vatRate);
        if (isNaN(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100) {
          return res.status(400).json({
            message: "VAT rate must be between 0 and 100",
          });
        }
      }
    }

    if (normalizedVatType === "NOT_APPLICABLE") {
      parsedVatRate = 0;
    }

    // Validate withholding tax rate
    let parsedWithholdingTaxRate = undefined;
    if (withholdingTaxRate !== undefined) {
      if (withholdingTaxRate === null) {
        parsedWithholdingTaxRate = 0;
      } else {
        parsedWithholdingTaxRate = parseFloat(withholdingTaxRate);
        if (isNaN(parsedWithholdingTaxRate) || parsedWithholdingTaxRate < 0 || parsedWithholdingTaxRate > 100) {
          return res.status(400).json({
            message: "Withholding tax rate must be between 0 and 100",
          });
        }
      }
    }

    // Validate withholding VAT rate
    let parsedWithholdingVatRate = undefined;
    if (withholdingVatRate !== undefined) {
      if (withholdingVatRate === null) {
        parsedWithholdingVatRate = 0;
      } else {
        parsedWithholdingVatRate = parseFloat(withholdingVatRate);
        if (isNaN(parsedWithholdingVatRate) || parsedWithholdingVatRate < 0 || parsedWithholdingVatRate > 100) {
          return res.status(400).json({
            message: "Withholding VAT rate must be between 0 and 100",
          });
        }
      }
    }

    // Validate exemption flag
    let isExempt = undefined;
    if (isWithholdingTaxExempt !== undefined) {
      isExempt = isWithholdingTaxExempt === true;
    }

    // Determine final rent value
    let finalRent = undefined;
    let parsedRent = undefined;

    if (unitId && unitId !== existingTenant.unitId && targetUnit) {
      if (rent !== undefined) {
        parsedRent = parseFloat(rent);
        if (isNaN(parsedRent) || parsedRent < 0) {
          return res.status(400).json({
            message: "Rent must be a positive number",
          });
        }
        finalRent = parsedRent;

        if (targetUnit.rentAmount !== parsedRent) {
          await prisma.unit.update({
            where: { id: targetUnit.id },
            data: { rentAmount: parsedRent }
          });
        }
      } else {
        finalRent = targetUnit.rentAmount;
      }
    } else if (rent !== undefined) {
      parsedRent = parseFloat(rent);
      if (isNaN(parsedRent) || parsedRent < 0) {
        return res.status(400).json({
          message: "Rent must be a positive number",
        });
      }
      finalRent = parsedRent;
    } else {
      finalRent = existingTenant.rent;
    }

    // Build updateData
    const updateData = {
      fullName,
      email,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent: finalRent,
      escalationRate: escalationRate != null
        ? escalationRate === null
          ? null
          : parseFloat(escalationRate)
        : undefined,
      escalationFrequency: normalizedEscalationFrequency,
      termStart: termStart ? new Date(termStart) : undefined,
      rentStart: rentStart ? new Date(rentStart) : undefined,
      deposit: deposit != null ? parseFloat(deposit) : undefined,
      paymentPolicy: normalizedPaymentPolicy,
      vatRate: parsedVatRate,
      vatType: normalizedVatType,
      withholdingTaxRate: parsedWithholdingTaxRate,
      withholdingVatRate: parsedWithholdingVatRate,
      isWithholdingTaxExempt: isExempt,
    };

    if (unitId && unitId !== existingTenant.unitId) {
      updateData.unitId = unitId;
    }

    // Remove undefined fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Execute unit transfer (with transaction) if applicable
    let updatedTenant;
    let oldUnitId = existingTenant.unitId;

    if (unitId && unitId !== existingTenant.unitId && targetUnit) {
      // Re-check unit status right before the transaction to avoid race conditions
      const freshTargetUnit = await prisma.unit.findUnique({
        where: { id: targetUnit.id },
        include: {
          tenants: {
            where: { status: 'ACTIVE' }
          }
        }
      });

      if (freshTargetUnit) {
        const freshActiveTenant = freshTargetUnit.tenants?.[0] || null;
        const isOccupied = freshTargetUnit.status === 'OCCUPIED' || freshActiveTenant !== null;

        if (isOccupied) {
          return res.status(400).json({
            message: "Target unit is no longer vacant. It may have been occupied during the process.",
            unitStatus: freshTargetUnit.status,
            hasTenant: !!freshActiveTenant,
            tenantName: freshActiveTenant?.fullName || null
          });
        }
      }

      updatedTenant = await prisma.$transaction(async (tx) => {
        await tx.unit.update({
          where: { id: oldUnitId },
          data: {
            status: 'VACANT'
          }
        });

        await tx.unit.update({
          where: { id: targetUnit.id },
          data: {
            status: 'OCCUPIED'
          }
        });

        const updated = await tx.tenant.update({
          where: { id: req.params.id },
          data: updateData,
          include: {
            unit: { include: { property: true } },
            serviceCharge: true,
          },
        });

        if (updateData.rent !== undefined) {
          await tx.unit.update({
            where: { id: targetUnit.id },
            data: { rentAmount: updateData.rent }
          });
        }

        return updated;
      });
    } else {
      updatedTenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          unit: { include: { property: true } },
          serviceCharge: true,
        },
      });

      if (rent !== undefined && parsedRent !== existingTenant.rent) {
        await prisma.unit.update({
          where: { id: existingTenant.unitId },
          data: { rentAmount: parsedRent },
        });
      }
    }

    // Handle service charge update
    if (serviceCharge !== undefined) {
      if (serviceCharge === null) {
        if (existingTenant.serviceCharge) {
          await prisma.serviceCharge.delete({
            where: { tenantId: req.params.id },
          });
        }
      } else if (serviceCharge && typeof serviceCharge === 'object') {
        let normalizedType = undefined;
        if (serviceCharge.type !== undefined) {
          const validTypes = ["FIXED", "PERCENTAGE", "PER_SQ_FT"];
          normalizedType = serviceCharge.type.toUpperCase();
          if (!validTypes.includes(normalizedType)) {
            return res.status(400).json({
              message: `Invalid service charge type. Must be: ${validTypes.join(", ")}`,
            });
          }
        }

        let normalizedServiceVatType = undefined;
        if (serviceCharge.vatType !== undefined) {
          const validVatTypes = ["INCLUSIVE", "EXCLUSIVE", "NOT_APPLICABLE"];
          normalizedServiceVatType = serviceCharge.vatType.toUpperCase();
          if (!validVatTypes.includes(normalizedServiceVatType)) {
            return res.status(400).json({
              message: `Invalid service charge VAT type. Must be: ${validVatTypes.join(", ")}`,
            });
          }
        }

        let parsedServiceVatRate = undefined;
        if (serviceCharge.vatRate !== undefined) {
          if (serviceCharge.vatRate === null) {
            parsedServiceVatRate = 0;
          } else {
            parsedServiceVatRate = parseFloat(serviceCharge.vatRate);
            if (isNaN(parsedServiceVatRate) || parsedServiceVatRate < 0 || parsedServiceVatRate > 100) {
              return res.status(400).json({
                message: "Service charge VAT rate must be between 0 and 100",
              });
            }
          }
        }

        const serviceChargeUpdateData = {};

        if (normalizedType !== undefined) {
          serviceChargeUpdateData.type = normalizedType;
        }

        if (serviceCharge.fixedAmount !== undefined) {
          serviceChargeUpdateData.fixedAmount = serviceCharge.fixedAmount !== null
            ? parseFloat(serviceCharge.fixedAmount)
            : null;
        }

        if (serviceCharge.percentage !== undefined) {
          serviceChargeUpdateData.percentage = serviceCharge.percentage !== null
            ? parseFloat(serviceCharge.percentage)
            : null;
        }

        if (serviceCharge.perSqFtRate !== undefined) {
          serviceChargeUpdateData.perSqFtRate = serviceCharge.perSqFtRate !== null
            ? parseFloat(serviceCharge.perSqFtRate)
            : null;
        }

        if (normalizedServiceVatType !== undefined) {
          serviceChargeUpdateData.vatType = normalizedServiceVatType;
        }

        if (parsedServiceVatRate !== undefined) {
          serviceChargeUpdateData.vatRate = parsedServiceVatRate;
        }

        if (normalizedServiceVatType === "NOT_APPLICABLE") {
          serviceChargeUpdateData.vatRate = 0;
        }

        if (Object.keys(serviceChargeUpdateData).length > 0) {
          const existingServiceCharge = await prisma.serviceCharge.findUnique({
            where: { tenantId: req.params.id },
          });

          if (existingServiceCharge) {
            await prisma.serviceCharge.update({
              where: { tenantId: req.params.id },
              data: serviceChargeUpdateData,
            });
          } else {
            const createData = {
              tenantId: req.params.id,
              type: serviceChargeUpdateData.type || 'FIXED',
              fixedAmount: serviceChargeUpdateData.fixedAmount ?? null,
              percentage: serviceChargeUpdateData.percentage ?? null,
              perSqFtRate: serviceChargeUpdateData.perSqFtRate ?? null,
              vatType: serviceChargeUpdateData.vatType || "NOT_APPLICABLE",
              vatRate: serviceChargeUpdateData.vatRate ?? 0,
            };

            await prisma.serviceCharge.create({
              data: createData,
            });
          }
        }
      }
    }

    const finalTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { property: true } },
        serviceCharge: true,
      },
    });

    const response = {
      ...finalTenant,
      lifecycle: buildLifecycleMetadata(finalTenant),
      unitTransfer: null
    };

    if (unitId && unitId !== existingTenant.unitId) {
      response.unitTransfer = {
        oldUnitId: oldUnitId,
        newUnitId: unitId,
        oldUnitRent: existingTenant.rent || existingTenant.unit.rentAmount,
        newUnitRent: targetUnit?.rentAmount || finalTenant.rent,
        status: 'completed',
        priceWarning: unitPriceWarning
      };
    }

    if (unitPriceWarning) {
      response.priceWarning = unitPriceWarning;
    }

    res.json(response);
  } catch (error) {
    console.error("Update tenant error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Delete tenant (Soft Delete - marks as LEFT, preserves all history)
// @route   DELETE /api/tenants/:id
// @access  Private (ADMIN, MANAGER, and USER with DELETE_TENANT permission)
export const deleteTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has delete permission
    const hasWriteAccess = await checkUserWriteAccess(userId, userRole, req.params.id, 'delete');
    if (!hasWriteAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to delete this tenant.',
        requiredPermission: 'DELETE_TENANT'
      });
    }

    // Validate + normalize optional leftReason (empty string → null, lowercase → uppercase)
    let normalizedLeftReason;
    try {
      normalizedLeftReason = normalizeLeftReason(req.body?.leftReason);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ message: err.message });
    }

    // Fetch tenant with all related data
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        unit: true,
        serviceCharge: true,
        paymentReports: true,
        invoices: true,
        billInvoices: true,
        bills: true,
        demandLetters: true,
        attachments: true,
        incomes: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (tenant.status === 'LEFT') {
      return res.status(400).json({
        message: 'Tenant has already been marked as left.',
        tenant: {
          id: tenant.id,
          name: tenant.fullName,
          leftAt: tenant.leftAt || tenant.updatedAt,
          leftReason: tenant.leftReason
        }
      });
    }

    const tenantInfo = {
      id: tenant.id,
      name: tenant.fullName,
      email: tenant.email,
      unitId: tenant.unitId,
      rentAmount: tenant.rent
    };

    const leftAtTimestamp = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // 1. SOFT DELETE — mark tenant as LEFT via the central helper.
      //    markTenantAsLeft guarantees leftAt is always populated.
      const updatedTenant = await markTenantAsLeft(
        tx,
        tenant.id,
        normalizedLeftReason,
        leftAtTimestamp
      );

      // 2. Delete service charge if exists
      if (tenant.serviceCharge) {
        await tx.serviceCharge.delete({
          where: { tenantId: tenant.id }
        });
      }

      // 3. Free up unit ONLY if no other ACTIVE tenant shares it
      const otherActiveInUnit = await tx.tenant.count({
        where: {
          unitId: tenant.unitId,
          status: 'ACTIVE',
          id: { not: tenant.id }
        }
      });

      if (otherActiveInUnit === 0) {
        await tx.unit.update({
          where: { id: tenant.unitId },
          data: { status: 'VACANT' }
        });
      }

      // 4. Update any outstanding invoices to show tenant left
      if (tenant.invoices && tenant.invoices.length > 0) {
        await tx.invoice.updateMany({
          where: {
            tenantId: tenant.id,
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
          },
          data: {
            status: 'OVERDUE',
            notes: `Tenant left property on ${leftAtTimestamp.toISOString().split('T')[0]}`
          }
        });
      }

      // 5. Update bill invoices
      if (tenant.billInvoices && tenant.billInvoices.length > 0) {
        await tx.billInvoice.updateMany({
          where: {
            tenantId: tenant.id,
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
          },
          data: {
            status: 'OVERDUE',
            notes: `Tenant left property on ${leftAtTimestamp.toISOString().split('T')[0]}`
          }
        });
      }

      // 6. Update bills
      if (tenant.bills && tenant.bills.length > 0) {
        await tx.bill.updateMany({
          where: {
            tenantId: tenant.id,
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
          },
          data: {
            status: 'OVERDUE',
            notes: `Tenant left property on ${leftAtTimestamp.toISOString().split('T')[0]}`
          }
        });
      }

      // 7. Update payment reports with notes
      if (tenant.paymentReports && tenant.paymentReports.length > 0) {
        await tx.paymentReport.updateMany({
          where: { tenantId: tenant.id },
          data: {
            notes: `Tenant left property on ${leftAtTimestamp.toISOString().split('T')[0]}`
          }
        });
      }

      // 8. Update demand letters
      if (tenant.demandLetters && tenant.demandLetters.length > 0) {
        await tx.demandLetter.updateMany({
          where: { tenantId: tenant.id },
          data: {
            status: 'ESCALATED',
            notes: `Tenant left property on ${leftAtTimestamp.toISOString().split('T')[0]}`
          }
        });
      }

      return {
        tenant: updatedTenant,
        preservedRecords: {
          paymentReports: tenant.paymentReports?.length || 0,
          invoices: tenant.invoices?.length || 0,
          billInvoices: tenant.billInvoices?.length || 0,
          bills: tenant.bills?.length || 0,
          demandLetters: tenant.demandLetters?.length || 0,
          attachments: tenant.attachments?.length || 0,
          incomes: tenant.incomes?.length || 0
        }
      };
    }, {
      timeout: 15000
    });

    res.json({
      success: true,
      message: `Tenant '${tenantInfo.name}' marked as left property successfully. All historical records preserved.`,
      data: {
        tenantId: tenantInfo.id,
        tenantName: tenantInfo.name,
        unitId: tenantInfo.unitId,
        status: 'LEFT',
        leftAt: leftAtTimestamp.toISOString(),
        leftReason: normalizedLeftReason,
        tenureDays: daysBetween(tenant.createdAt, leftAtTimestamp),
        preservedRentAmount: tenantInfo.rentAmount,
        preservedRecords: result.preservedRecords,
        note: 'All payment history, invoices, bills, and other records have been preserved.'
      }
    });

  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(400).json({
      message: error.message,
      error: error.message
    });
  }
};

// @desc    Update tenant service charge
// @route   PATCH /api/tenants/:id/service-charge
// @access  Private (ADMIN, MANAGER, and USER with EDIT_TENANT permission)
export const updateServiceCharge = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has edit permission
    const hasWriteAccess = await checkUserWriteAccess(userId, userRole, req.params.id, 'edit');
    if (!hasWriteAccess) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to update service charges for this tenant.',
        requiredPermission: 'EDIT_TENANT'
      });
    }

    const { type, fixedAmount, percentage, perSqFtRate, vatType, vatRate } = req.body;

    // Check if tenant exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { serviceCharge: true }
    });

    if (!existingTenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Validate service charge type
    const validServiceChargeTypes = ['FIXED', 'PERCENTAGE', 'PER_SQ_FT'];
    if (!validServiceChargeTypes.includes(type.toUpperCase())) {
      return res.status(400).json({
        message: `Invalid service charge type. Must be one of: ${validServiceChargeTypes.join(', ')}`
      });
    }

    // Validate VAT type if provided
    let normalizedVatType = undefined;
    if (vatType !== undefined) {
      const validVatTypes = ['INCLUSIVE', 'EXCLUSIVE', 'NOT_APPLICABLE'];
      normalizedVatType = vatType.toUpperCase();
      if (!validVatTypes.includes(normalizedVatType)) {
        return res.status(400).json({
          message: `Invalid VAT type. Must be one of: ${validVatTypes.join(', ')}`
        });
      }
    }

    // Validate VAT rate if provided
    let parsedVatRate = undefined;
    if (vatRate !== undefined) {
      if (vatRate === null) {
        parsedVatRate = 0;
      } else {
        parsedVatRate = parseFloat(vatRate);
        if (isNaN(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100) {
          return res.status(400).json({
            message: "VAT rate must be between 0 and 100"
          });
        }
      }
    }

    // If VAT type is NOT_APPLICABLE, force vatRate = 0
    if (normalizedVatType === "NOT_APPLICABLE") {
      parsedVatRate = 0;
    }

    const updateData = {
      type: type.toUpperCase(),
      fixedAmount: fixedAmount !== undefined ? parseFloat(fixedAmount) : null,
      percentage: percentage !== undefined ? parseFloat(percentage) : null,
      perSqFtRate: perSqFtRate !== undefined ? parseFloat(perSqFtRate) : null
    };

    // Add VAT fields if provided
    if (normalizedVatType !== undefined) {
      updateData.vatType = normalizedVatType;
    }
    if (parsedVatRate !== undefined) {
      updateData.vatRate = parsedVatRate;
    }

    let serviceCharge;

    if (existingTenant.serviceCharge) {
      serviceCharge = await prisma.serviceCharge.update({
        where: { tenantId: req.params.id },
        data: updateData
      });
    } else {
      serviceCharge = await prisma.serviceCharge.create({
        data: {
          tenantId: req.params.id,
          ...updateData
        }
      });
    }

    res.json(serviceCharge);
  } catch (error) {
    console.error('Update service charge error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Remove tenant service charge
// @route   DELETE /api/tenants/:id/service-charge
// @access  Private (ADMIN, MANAGER, and USER with EDIT_TENANT permission)
export const removeServiceCharge = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has edit permission
    const hasWriteAccess = await checkUserWriteAccess(userId, userRole, req.params.id, 'edit');
    if (!hasWriteAccess) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to remove service charges for this tenant.',
        requiredPermission: 'EDIT_TENANT'
      });
    }

    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { serviceCharge: true }
    });

    if (!existingTenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (!existingTenant.serviceCharge) {
      return res.status(400).json({ message: 'Tenant does not have a service charge' });
    }

    await prisma.serviceCharge.delete({
      where: { tenantId: req.params.id }
    });

    res.json({ message: 'Service charge removed successfully' });
  } catch (error) {
    console.error('Remove service charge error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get tenant financials (requires VIEW_TENANT_FINANCIALS permission)
// @route   GET /api/tenants/:id/financials
// @access  Private
export const getTenantFinancials = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has view financials permission
    const { hasAccess, tenant } = await checkUserTenantAccess(userId, userRole, req.params.id, 'viewFinancials');
    
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to view financials for this tenant.',
        requiredPermission: 'VIEW_TENANT_FINANCIALS'
      });
    }

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Fetch financial data
    const financials = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        paymentReports: {
          orderBy: { datePaid: 'desc' }
        },
        incomes: {
          orderBy: { createdAt: 'desc' }
        },
        invoices: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    // Calculate summary
    const totalPaid = financials.paymentReports.reduce((sum, p) => sum + p.amountPaid, 0);
    const totalInvoiced = financials.invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const outstandingBalance = totalInvoiced - totalPaid;

    res.json({
      tenant: {
        id: financials.id,
        fullName: financials.fullName,
        email: financials.email,
        status: financials.status,
        lifecycle: buildLifecycleMetadata(financials)
      },
      summary: {
        totalPaid,
        totalInvoiced,
        outstandingBalance,
        paymentCount: financials.paymentReports.length,
        invoiceCount: financials.invoices.length
      },
      paymentHistory: financials.paymentReports,
      invoiceHistory: financials.invoices,
      incomeHistory: financials.incomes
    });
  } catch (error) {
    console.error('Get tenant financials error:', error);
    res.status(400).json({ message: error.message });
  }
};

// Helper functions
const isAdmin = (userRole) => userRole === 'ADMIN';

// @desc    Get all attachments for a tenant
// @route   GET /api/tenants/:tenantId/attachments
// @access  Private
export const getAttachments = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check tenant access
    const { hasAccess } = await checkUserTenantAccess(userId, userRole, tenantId, 'view');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to view attachments for this tenant.',
        requiredPermission: 'VIEW_TENANT'
      });
    }

    const attachments = await prisma.attachment.findMany({
      where: { tenantId },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { uploadedAt: 'desc' },
    });

    // Get base URL from request
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;

    const attachmentsWithPermissions = attachments.map(attachment => {
      let fileName = attachment.fileName || attachment.url;
      if (fileName.includes('/') || fileName.includes('\\')) {
        fileName = fileName.replace(/\\/g, '/').split('/').pop();
      }
      
      return {
        ...attachment,
        previewUrl: `/api/tenants/attachments/${attachment.id}/preview`,
        downloadUrl: `/api/tenants/attachments/${attachment.id}/download`,
        url: `/uploads/${fileName}`,
        canEdit: isAdmin(userRole),
        canDelete: isAdmin(userRole),
        canDownload: true,
        canPreview: true
      };
    });

    res.json({
      success: true,
      count: attachments.length,
      data: attachmentsWithPermissions
    });
  } catch (error) {
    console.error('Error fetching attachments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attachments',
      error: error.message
    });
  }
};

// @desc    Upload a new attachment for a tenant
// @route   POST /api/tenants/:tenantId/attachments
// @access  Private (Managers and Admins only)
export const uploadAttachment = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const { hasAccess } = await checkUserTenantAccess(userId, userRole, tenantId, 'edit');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to upload attachments for this tenant.',
        requiredPermission: 'EDIT_TENANT'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { originalname, filename, path: filePath, mimetype, size } = req.file;

    const storedFileName = filename;

    const attachment = await prisma.attachment.create({
      data: {
        name: originalname,
        fileName: storedFileName,
        url: storedFileName,
        mimeType: mimetype,
        size: size,
        tenantId,
        uploadedById: userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: {
        ...attachment,
        url: `/uploads/${storedFileName}`,
        previewUrl: `/api/tenants/attachments/${attachment.id}/preview`,
        downloadUrl: `/api/tenants/attachments/${attachment.id}/download`,
        canEdit: isAdmin(userRole),
        canDelete: isAdmin(userRole),
        canDownload: true,
        canPreview: true
      }
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload attachment',
      error: error.message
    });
  }
};

// @desc    Preview an attachment in browser
// @route   GET /api/tenants/attachments/:attachmentId/preview
// @access  Private (Everyone with view access)
export const previewAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'view');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to preview this attachment.',
        requiredPermission: 'VIEW_TENANT'
      });
    }

    let fileName = attachment.fileName || attachment.url;
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.resolve(uploadDir, fileName);
    
    console.log('Preview - Looking for file at:', fullPath);
    
    if (!fs.existsSync(fullPath)) {
      console.error('Preview - File not found at path:', fullPath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    const fileExtension = attachment.name.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension);
    const isPdf = fileExtension === 'pdf';

    if (isImage || isPdf) {
      res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${attachment.name}"`);
      return res.sendFile(fullPath);
    } else {
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5000'}/api/tenants/attachments/${attachmentId}/download`);
    }
  } catch (error) {
    console.error('Error previewing attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview attachment',
      error: error.message
    });
  }
};

// @desc    Update an attachment (rename) - ADMIN ONLY
// @route   PUT /api/tenants/attachments/:attachmentId
// @access  Private
export const updateAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const { name } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!isAdmin(userRole)) {
      return res.status(403).json({
        message: 'Access denied. Only admins can edit attachments.',
        requiredPermission: 'ADMIN'
      });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'edit');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to edit attachments for this tenant.',
        requiredPermission: 'EDIT_TENANT'
      });
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Attachment name is required and must be a non-empty string'
      });
    }

    const updatedAttachment = await prisma.attachment.update({
      where: { id: attachmentId },
      data: { name: name.trim() }
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';

    res.json({
      success: true,
      message: 'Attachment updated successfully',
      data: {
        ...updatedAttachment,
        previewUrl: `${baseUrl}/api/tenants/attachments/${updatedAttachment.id}/preview`,
        downloadUrl: `${baseUrl}/api/tenants/attachments/${updatedAttachment.id}/download`,
        canEdit: true,
        canDelete: true,
        canDownload: true,
        canPreview: true
      }
    });
  } catch (error) {
    console.error('Error updating attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attachment',
      error: error.message
    });
  }
};

// @desc    Delete an attachment - ADMIN ONLY
// @route   DELETE /api/tenants/attachments/:attachmentId
// @access  Private
export const deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!isAdmin(userRole)) {
      return res.status(403).json({
        message: 'Access denied. Only admins can delete attachments.',
        requiredPermission: 'ADMIN'
      });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'delete');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to delete attachments for this tenant.',
        requiredPermission: 'DELETE_TENANT'
      });
    }

    let fileName = attachment.fileName || attachment.url;
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    try {
      const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
      const fullPath = path.resolve(uploadDir, fileName);
      
      console.log('Deleting file at:', fullPath);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log('File deleted successfully');
      } else {
        console.log('File not found at:', fullPath);
      }
    } catch (fsError) {
      console.error('Error deleting file from filesystem:', fsError);
    }

    await prisma.attachment.delete({
      where: { id: attachmentId }
    });

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete attachment',
      error: error.message
    });
  }
};

// @desc    Download an attachment - EVERYONE with view access
// @route   GET /api/tenants/attachments/:attachmentId/download
// @access  Private
export const downloadAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'view');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to download this attachment.',
        requiredPermission: 'VIEW_TENANT'
      });
    }

    let fileName = attachment.fileName || attachment.url;
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.resolve(uploadDir, fileName);
    
    console.log('Download - Looking for file at:', fullPath);
    
    if (!fs.existsSync(fullPath)) {
      console.error('Download - File not found at path:', fullPath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    res.download(fullPath, attachment.name);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download attachment',
      error: error.message
    });
  }
};

// @desc    Restore a tenant (reactivate), optionally to a different unit in the same property
// @route   PATCH /api/tenants/:id/restore
// @access  Private (ADMIN only)
export const restoreTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== 'ADMIN') {
      return res.status(403).json({
        message: 'Access denied. Only admins can restore tenants.'
      });
    }

    const { unitId: requestedUnitId, rent: requestedRent } = req.body || {};

    // Load tenant with current unit
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { property: true } }
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (tenant.status === 'ACTIVE') {
      return res.status(400).json({ message: 'Tenant is already active.' });
    }

    // Resolve target unit (default: original unit)
    const targetUnitId = requestedUnitId || tenant.unitId;
    const isUnitChange = targetUnitId !== tenant.unitId;

    const targetUnit = await prisma.unit.findUnique({
      where: { id: targetUnitId },
      include: {
        property: true,
        tenants: { where: { status: 'ACTIVE' } }
      }
    });

    if (!targetUnit) {
      return res.status(404).json({ message: 'Target unit not found' });
    }

    // Same-property rule
    if (targetUnit.propertyId !== tenant.unit.propertyId) {
      return res.status(400).json({
        message: 'Cannot restore tenant to a unit in a different property.'
      });
    }

    // Vacancy check
    const activeTenantInTarget = targetUnit.tenants?.[0] || null;
    const isOccupied =
      targetUnit.status === 'OCCUPIED' || activeTenantInTarget !== null;

    if (isOccupied) {
      const reasons = [];
      if (targetUnit.status === 'OCCUPIED') reasons.push(`Unit status is 'OCCUPIED'`);
      if (activeTenantInTarget) reasons.push(`Unit has active tenant: ${activeTenantInTarget.fullName}`);
      return res.status(400).json({
        message: `Target unit is not vacant. (${reasons.join(', ')})`,
        unitStatus: targetUnit.status,
        hasTenant: !!activeTenantInTarget,
        tenantName: activeTenantInTarget?.fullName || null
      });
    }

    // Reconcile rent
    let finalRent = tenant.rent;
    if (requestedRent !== undefined && requestedRent !== null) {
      const parsed = parseFloat(requestedRent);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ message: 'Rent must be a positive number' });
      }
      finalRent = parsed;
    } else if (isUnitChange && targetUnit.rentAmount != null) {
      finalRent = targetUnit.rentAmount;
    }

    // Re-check KRA/email uniqueness against OTHER tenants
    const conflict = await prisma.tenant.findFirst({
      where: {
        id: { not: tenant.id },
        OR: [{ email: tenant.email }, { KRAPin: tenant.KRAPin }]
      }
    });
    if (conflict) {
      return res.status(400).json({
        message: `Cannot restore: another tenant already uses this email or KRA PIN (${conflict.fullName}).`
      });
    }

    // Transaction + race-condition re-check
    const result = await prisma.$transaction(async (tx) => {
      const freshUnit = await tx.unit.findUnique({
        where: { id: targetUnitId },
        include: { tenants: { where: { status: 'ACTIVE' } } }
      });

      if (!freshUnit) throw new Error('Target unit disappeared during restore.');

      const freshActive = freshUnit.tenants?.[0] || null;
      if (freshUnit.status === 'OCCUPIED' || freshActive) {
        throw new Error(
          `Target unit became occupied during restore${
            freshActive ? ` by ${freshActive.fullName}` : ''
          }.`
        );
      }

      // If unit changed, free the old unit (only if no other ACTIVE tenant uses it)
      if (isUnitChange) {
        const oldUnitActive = await tx.tenant.count({
          where: { unitId: tenant.unitId, status: 'ACTIVE' }
        });
        if (oldUnitActive === 0) {
          await tx.unit.update({
            where: { id: tenant.unitId },
            data: { status: 'VACANT' }
          });
        }
      }

      // ============================================================
      // Reactivate the tenant.
      //
      // LIFECYCLE INVARIANT:
      //   - status = 'ACTIVE'  ⟹  leftAt IS NULL AND leftReason IS NULL
      //   - status = 'LEFT'    ⟹  leftAt IS NOT NULL
      //
      // We explicitly clear BOTH leftAt and leftReason here so that a
      // restored tenant doesn't leak stale churn metadata into active
      // reports. If they later leave again, markTenantAsLeft() will
      // write fresh values.
      // ============================================================
      const restored = await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          status: 'ACTIVE',
          leftAt: null,
          leftReason: null,
          unitId: targetUnitId,
          rent: finalRent
        },
        include: {
          unit: { include: { property: true } },
          serviceCharge: true
        }
      });

      // Occupy the target unit
      await tx.unit.update({
        where: { id: targetUnitId },
        data: {
          status: 'OCCUPIED',
          rentAmount: finalRent
        }
      });

      // Clean up "left property" notes on still-outstanding invoices/bills.
      const leftNoteFragment = 'Tenant left property on';
      await tx.invoice.updateMany({
        where: { tenantId: tenant.id, notes: { contains: leftNoteFragment } },
        data: { notes: null }
      });
      await tx.billInvoice.updateMany({
        where: { tenantId: tenant.id, notes: { contains: leftNoteFragment } },
        data: { notes: null }
      });
      await tx.bill.updateMany({
        where: { tenantId: tenant.id, notes: { contains: leftNoteFragment } },
        data: { notes: null }
      });

      return restored;
    }, { timeout: 15000 });

    const response = {
      success: true,
      message: isUnitChange
        ? `Tenant '${tenant.fullName}' restored to unit ${targetUnit.unitNo}.`
        : `Tenant '${tenant.fullName}' restored to their original unit.`,
      tenant: result,
      lifecycle: buildLifecycleMetadata(result),
      unitTransfer: isUnitChange
        ? {
            oldUnitId: tenant.unitId,
            newUnitId: targetUnitId,
            oldUnitRent: tenant.rent,
            newUnitRent: finalRent,
            status: 'completed'
          }
        : null
    };

    res.json(response);
  } catch (error) {
    console.error('Restore tenant error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all tenants who have left (departed tenants)
// @route   GET /api/tenants/left
// @access  Private (ADMIN, MANAGER)
export const getLeftTenants = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId, leftReason, sortBy } = req.query;

    if (userRole === 'USER') {
      return res.status(403).json({ 
        message: 'Access denied. Users cannot view departed tenants.'
      });
    }

    const where = { status: 'LEFT' };

    if (userRole === 'MANAGER') {
      where.unit = { property: { managerId: userId } };
    }

    if (propertyId) {
      where.unit = { ...(where.unit || {}), propertyId };
    }

    if (leftReason) {
      where.leftReason = String(leftReason).toUpperCase();
    }

    const orderBy = sortBy === 'leftAt'
      ? { leftAt: 'desc' }
      : { updatedAt: 'desc' };

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        unit: {
          include: {
            property: true
          }
        },
        paymentReports: {
          orderBy: { datePaid: 'desc' },
          take: 5
        },
        invoices: {
          where: {
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
          }
        },
        billInvoices: {
          where: {
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
          }
        },
        serviceCharge: true,
        incomes: true
      },
      orderBy
    });

    const enhancedTenants = tenants.map(tenant => {
      const rentOutstanding = (tenant.invoices || []).reduce(
        (sum, inv) => sum + (inv.balance ?? (inv.totalDue - inv.amountPaid)),
        0
      );
      const billOutstanding = (tenant.billInvoices || []).reduce(
        (sum, inv) => sum + (inv.balance ?? (inv.grandTotal - inv.amountPaid)),
        0
      );
      const totalOutstanding = rentOutstanding + billOutstanding;

      return {
        ...tenant,
        lifecycle: buildLifecycleMetadata(tenant),
        financials: {
          rentOutstanding: parseFloat(rentOutstanding.toFixed(2)),
          billOutstanding: parseFloat(billOutstanding.toFixed(2)),
          totalOutstanding: parseFloat(totalOutstanding.toFixed(2))
        }
      };
    });

    const summary = {
      totalDeparted: enhancedTenants.length,
      withOutstandingBalance: enhancedTenants.filter(t => t.financials.totalOutstanding > 0).length,
      withoutOutstandingBalance: enhancedTenants.filter(t => t.financials.totalOutstanding === 0).length,
      totalRentOutstanding: parseFloat(
        enhancedTenants.reduce((sum, t) => sum + t.financials.rentOutstanding, 0).toFixed(2)
      ),
      totalBillOutstanding: parseFloat(
        enhancedTenants.reduce((sum, t) => sum + t.financials.billOutstanding, 0).toFixed(2)
      ),
      totalOutstanding: parseFloat(
        enhancedTenants.reduce((sum, t) => sum + t.financials.totalOutstanding, 0).toFixed(2)
      ),
      byReason: enhancedTenants.reduce((acc, t) => {
        const reason = t.leftReason || 'UNSPECIFIED';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
      averageTenureDays: enhancedTenants.length > 0
        ? Math.round(
            enhancedTenants.reduce((sum, t) => sum + (t.lifecycle.tenureDays || 0), 0) /
              enhancedTenants.length
          )
        : 0
    };

    res.json({
      success: true,
      summary,
      tenants: enhancedTenants
    });
  } catch (error) {
    console.error('Get left tenants error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get tenant statistics by status
// @route   GET /api/tenants/stats
// @access  Private
export const getTenantStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let whereClause = {};

    if (userRole === 'MANAGER') {
      whereClause = {
        unit: {
          property: {
            managerId: userId
          }
        }
      };
    } else if (userRole === 'USER') {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      if (accessiblePropertyIds.length === 0) {
        return res.json({
          active: 0,
          left: 0,
          total: 0,
          byReason: {}
        });
      }
      
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkTenantPermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      if (propertiesWithPermission.length === 0) {
        return res.json({
          active: 0,
          left: 0,
          total: 0,
          byReason: {}
        });
      }
      
      whereClause = {
        unit: {
          property: {
            id: { in: propertiesWithPermission }
          }
        }
      };
    }

    const [activeCount, leftCount, leftByReasonRaw] = await Promise.all([
      prisma.tenant.count({
        where: { ...whereClause, status: 'ACTIVE' }
      }),
      prisma.tenant.count({
        where: { ...whereClause, status: 'LEFT' }
      }),
      prisma.tenant.groupBy({
        by: ['leftReason'],
        where: { ...whereClause, status: 'LEFT' },
        _count: { _all: true }
      })
    ]);

    const byReason = leftByReasonRaw.reduce((acc, row) => {
      acc[row.leftReason || 'UNSPECIFIED'] = row._count._all;
      return acc;
    }, {});

    res.json({
      active: activeCount,
      left: leftCount,
      total: activeCount + leftCount,
      byReason
    });
  } catch (error) {
    console.error('Get tenant stats error:', error);
    res.status(400).json({ message: error.message });
  }
};