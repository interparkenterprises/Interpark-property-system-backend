import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";

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
    return false; // Will be validated at the property level in createTenant
  }
  
  return false;
};

// @desc    Get all tenants
// @route   GET /api/tenants
// @access  Private
export const getTenants = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let tenants;

    if (userRole === 'ADMIN') {
      tenants = await prisma.tenant.findMany({
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
        return res.json([]);
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
        return res.json([]);
      }
      
      tenants = await prisma.tenant.findMany({
        where: {
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
        paymentSummary
      };
    });

    res.json(enhancedTenants);
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
        incomes: true
      }
    });

    // Calculate escalated rent
    const rentInfo = calculateEscalatedRent(fullTenant);
    const monthlyRent = rentInfo.currentRent;
    
    // Calculate total payment breakdown using the new function
    const paymentBreakdown = calculateTotalPayment(fullTenant, monthlyRent, fullTenant.paymentPolicy);
    
    const rentSchedule = getRentScheduleWithPayments(fullTenant, 3);
    
    // Calculate payment summary with due dates
    const paymentSummary = getPaymentSummary(fullTenant);

    res.json({
      ...fullTenant,
      rentInfo: {
        ...rentInfo,
        monthlyRent: monthlyRent,
        paymentBreakdown: paymentBreakdown
      },
      rentSchedule,
      paymentSummary
    });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get tenants by property ID
// @route   GET /api/tenants/property/:propertyId
// @access  Private
export const getTenantsByProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;

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
      // Check if user has VIEW_TENANTS permission for this property
      hasAccess = await checkTenantPermission(userId, userRole, propertyId, 'view');
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this property',
        requiredPermission: 'VIEW_TENANTS'
      });
    }

    // Fetch tenants for this property
    const tenants = await prisma.tenant.findMany({
      where: {
        unit: {
          propertyId: propertyId
        }
      },
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
        paymentSummary
      };
    });

    res.json(enhancedTenants);
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
    const { propertyId, daysOverdue, customDays } = req.query;

    let tenants;
    let baseWhere = {};

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

    // Helper function to calculate exact overdue days
    const calculateOverdueDays = (tenant) => {
      const paymentSummary = getPaymentSummary(tenant);
      
      if (!paymentSummary.nextPayment?.isOverdue) {
        return 0;
      }
      
      // Calculate days based on next due date
      const nextDueDate = paymentSummary.nextPayment.dueDate;
      if (nextDueDate) {
        const dueDateObj = new Date(nextDueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDateObj.setHours(0, 0, 0, 0);
        
        const diffTime = today - dueDateObj;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
      }
      
      // Fallback: calculate based on payments behind
      const paymentsBehind = paymentSummary.nextPayment?.paymentsBehind || 0;
      const paymentPeriod = tenant.paymentPolicy === 'MONTHLY' ? 30 :
                           tenant.paymentPolicy === 'QUARTERLY' ? 90 : 365;
      return paymentsBehind * paymentPeriod;
    };
    
    // Helper function to get human-readable overdue period
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
    
    // Filter tenants with overdue payments and enhance their data
    let overdueTenants = tenants
      .map(tenant => {
        const rentInfo = calculateEscalatedRent(tenant);
        const monthlyRent = rentInfo.currentRent;
        const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
        const paymentSummary = getPaymentSummary(tenant);
        const overdueDays = calculateOverdueDays(tenant);
        
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
          overdueDetails: {
            daysOverdue: overdueDays,
            periodText: getOverduePeriodText(overdueDays),
            category: getOverdueCategory(overdueDays)
          }
        };
      })
      .filter(tenant => {
        // Only include tenants that are overdue
        if (!tenant.paymentSummary.nextPayment?.isOverdue) {
          return false;
        }
        
        // Apply days overdue filter if specified
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
      const overdueBalance = tenant.paymentSummary.paymentHistory?.outstandingBalance || 0;
      return sum + (overdueBalance > 0 ? overdueBalance : 0);
    }, 0);

    const totalOverdueTenants = overdueTenants.length;
    
    // Calculate overdue days statistics
    const overdueDaysStats = {
      min: overdueTenants.length > 0 ? Math.min(...overdueTenants.map(t => t.overdueDetails.daysOverdue)) : 0,
      max: overdueTenants.length > 0 ? Math.max(...overdueTenants.map(t => t.overdueDetails.daysOverdue)) : 0,
      average: overdueTenants.length > 0 
        ? Math.round(overdueTenants.reduce((sum, t) => sum + t.overdueDetails.daysOverdue, 0) / overdueTenants.length)
        : 0
    };
    
    // Group by overdue categories
    const overdueCategories = {
      week1: overdueTenants.filter(t => t.overdueDetails.daysOverdue <= 7).length,
      week2: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 7 && t.overdueDetails.daysOverdue <= 14).length,
      month1: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 14 && t.overdueDetails.daysOverdue <= 30).length,
      month2: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 30 && t.overdueDetails.daysOverdue <= 60).length,
      month3: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 60 && t.overdueDetails.daysOverdue <= 90).length,
      more: overdueTenants.filter(t => t.overdueDetails.daysOverdue > 90).length
    };

    res.json({
      success: true,
      count: totalOverdueTenants,
      totalOverdueAmount,
      tenants: overdueTenants,
      summary: {
        totalOverdueTenants,
        totalOverdueAmount,
        averageOverdueAmount: totalOverdueTenants > 0 ? totalOverdueAmount / totalOverdueTenants : 0,
        overdueDaysStats,
        overdueCategories
      },
      filter: {
        propertyId: propertyId || null,
        daysOverdue: daysOverdue || null,
        customDays: customDays ? parseInt(customDays) : null,
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

    // Fetch tenants for the property
    const tenants = await prisma.tenant.findMany({
      where: {
        unit: {
          propertyId: propertyId
        }
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
        serviceCharge: true
      },
      orderBy: { fullName: 'asc' }
    });

    // Calculate next payment for each tenant
    const tenantsWithNextPayment = [];
    const now = new Date();

    for (const tenant of tenants) {
      // Calculate rent info with escalation
      const rentInfo = calculateEscalatedRent(tenant);
      const monthlyRent = rentInfo.currentRent;
      
      // Calculate total payment breakdown
      const paymentBreakdown = calculateTotalPayment(tenant, monthlyRent, tenant.paymentPolicy);
      const paymentSummary = getPaymentSummary(tenant);
      
      // Get the next due date
      const nextDueDate = paymentSummary.nextPayment?.dueDate;
      const isOverdue = paymentSummary.nextPayment?.isOverdue || false;
      
      if (nextDueDate) {
        const dueDateObj = new Date(nextDueDate);
        
        // Calculate days until due (negative if overdue)
        const daysUntilDue = Math.ceil((dueDateObj - now) / (1000 * 60 * 60 * 24));
        
        tenantsWithNextPayment.push({
          id: tenant.id,
          name: tenant.fullName,
          contact: {
            email: tenant.email,
            phone: tenant.contact,
            kra: tenant.KRAPin
          },
          unit: {
            number: tenant.unit.unitNo,
            type: tenant.unit.type,
            size: tenant.unit.sizeSqFt,
            floor: tenant.unit.floor
          },
          payment: {
            dueDate: paymentSummary.nextPayment.dueDateFormatted,
            daysUntilDue: daysUntilDue,
            isOverdue: isOverdue,
            amount: {
              rent: paymentBreakdown.rent.paymentByPolicy,
              serviceCharge: paymentBreakdown.serviceCharge.paymentByPolicy,
              vatOnRent: paymentBreakdown.rent.vatAmount,
              vatOnServiceCharge: paymentBreakdown.serviceCharge.vatAmount,
              total: paymentBreakdown.total.paymentByPolicy
            },
            status: paymentSummary.status,
            policy: tenant.paymentPolicy
          },
          rent: {
            current: monthlyRent,
            escalation: tenant.escalationRate ? {
              rate: tenant.escalationRate,
              frequency: tenant.escalationFrequency,
              nextDate: rentInfo.nextEscalationDate
            } : null
          },
          history: paymentSummary.paymentHistory.lastPaymentDate ? {
            lastPayment: paymentSummary.paymentHistory.lastPaymentDateFormatted,
            paymentsMade: paymentSummary.paymentHistory.paymentsMade
          } : null
        });
      }
    }

    // Sort by days until due (most urgent first)
    tenantsWithNextPayment.sort((a, b) => a.payment.daysUntilDue - b.payment.daysUntilDue);

    // Calculate summary statistics
    const summary = {
      total: tenantsWithNextPayment.length,
      overdue: tenantsWithNextPayment.filter(t => t.payment.isOverdue).length,
      upcoming: tenantsWithNextPayment.filter(t => !t.payment.isOverdue).length,
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

    res.json({
      success: true,
      property: {
        id: propertyId,
        name: tenants[0]?.unit.property.name || 'Unknown'
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
      // Verify manager owns this property
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
      serviceCharge
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
        message: "All fields except POBox, escalationRate, escalationFrequency, vatRate, vatType, and serviceCharge are required.",
      });
    }

    // Check email uniqueness
    const existingEmail = await prisma.tenant.findUnique({
      where: { email },
    });

    if (existingEmail) {
      return res.status(400).json({
        message: "Email already exists",
      });
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

    // Validate payment policy enum
    const validPaymentPolicies = ["MONTHLY", "QUARTERLY", "ANNUAL"];
    const normalizedPaymentPolicy = paymentPolicy.toUpperCase();
    if (!validPaymentPolicies.includes(normalizedPaymentPolicy)) {
      return res.status(400).json({
        message: `Invalid payment policy. Must be one of: ${validPaymentPolicies.join(", ")}`,
      });
    }

    // Validate escalation frequency - NEW: Added BI_ENNIAL
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

    // If VAT type is NOT_APPLICABLE, force vatRate = 0
    if (normalizedVatType === "NOT_APPLICABLE") {
      parsedVatRate = 0;
    }

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

    // =============================================
    // HANDLE SERVICE CHARGE - UPDATED WITH VAT SUPPORT
    // =============================================
    if (serviceCharge) {
      // Extract and validate type
      const validTypes = ["FIXED", "PERCENTAGE", "PER_SQ_FT"];
      const normalizedType = serviceCharge.type?.toUpperCase();

      if (!normalizedType || !validTypes.includes(normalizedType)) {
        return res.status(400).json({
          message: `Invalid service charge type. Must be: ${validTypes.join(", ")}`,
        });
      }

      // Validate service charge VAT type
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

      // Validate service charge VAT rate
      let parsedServiceVatRate = 0;
      if (serviceCharge.vatRate !== undefined && serviceCharge.vatRate !== null) {
        parsedServiceVatRate = parseFloat(serviceCharge.vatRate);
        if (isNaN(parsedServiceVatRate) || parsedServiceVatRate < 0 || parsedServiceVatRate > 100) {
          return res.status(400).json({
            message: "Service charge VAT rate must be a number between 0 and 100",
          });
        }
      }

      // If VAT type is NOT_APPLICABLE, force vatRate = 0
      if (normalizedServiceVatType === "NOT_APPLICABLE") {
        parsedServiceVatRate = 0;
      }

      // Build data object with CORRECT Prisma field name: perSqFtRate (camelCase with capital F)
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
    } = req.body;

    // Fetch existing tenant
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        serviceCharge: true,
        unit: true,
      },
    });

    if (!existingTenant) {
      return res.status(404).json({ message: "Tenant not found" });
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

    // Validate escalation frequency - NEW: Added BI_ENNIAL
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

    // Rent
    let parsedRent = undefined;
    if (rent !== undefined) {
      parsedRent = parseFloat(rent);
      if (isNaN(parsedRent) || parsedRent < 0) {
        return res.status(400).json({
          message: "Rent must be a positive number",
        });
      }
    }

    // Build updateData
    const updateData = {
      fullName,
      email,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent: parsedRent,
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
    };

    // Remove undefined fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Apply update
    const updatedTenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        unit: { include: { property: true } },
        serviceCharge: true,
      },
    });

    // Update unit rent if changed
    if (rent !== undefined && parsedRent !== existingTenant.rent) {
      await prisma.unit.update({
        where: { id: existingTenant.unitId },
        data: { rentAmount: parsedRent },
      });
    }

    // =============================================
    // HANDLE SERVICE CHARGE UPDATE - UPDATED WITH VAT SUPPORT
    // =============================================
    if (serviceCharge) {
      // Validate type if provided
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

      // Validate service charge VAT type
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

      // Validate service charge VAT rate
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

      // Build update data with CORRECT field names
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

      // Add VAT fields
      if (normalizedServiceVatType !== undefined) {
        serviceChargeUpdateData.vatType = normalizedServiceVatType;
      }
      
      if (parsedServiceVatRate !== undefined) {
        serviceChargeUpdateData.vatRate = parsedServiceVatRate;
      }

      // If VAT type is NOT_APPLICABLE, force vatRate = 0
      if (normalizedServiceVatType === "NOT_APPLICABLE") {
        serviceChargeUpdateData.vatRate = 0;
      }

      // Update or create service charge
      if (Object.keys(serviceChargeUpdateData).length > 0) {
        if (existingTenant.serviceCharge) {
          // Update existing
          await prisma.serviceCharge.update({
            where: { tenantId: req.params.id },
            data: serviceChargeUpdateData,
          });
        } else if (normalizedType) {
          // Create new with all required fields
          await prisma.serviceCharge.create({
            data: {
              tenantId: req.params.id,
              type: normalizedType,
              fixedAmount: serviceChargeUpdateData.fixedAmount ?? null,
              percentage: serviceChargeUpdateData.percentage ?? null,
              perSqFtRate: serviceChargeUpdateData.perSqFtRate ?? null,
              vatType: serviceChargeUpdateData.vatType ?? "NOT_APPLICABLE",
              vatRate: serviceChargeUpdateData.vatRate ?? 0,
            },
          });
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

    res.json(finalTenant);
  } catch (error) {
    console.error("Update tenant error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Delete tenant
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

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { 
        unit: true,
        serviceCharge: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Store the unit's original rent amount before tenant deletion
    const originalUnitRent = tenant.unit.rentAmount;

    // Delete service charge if exists
    if (tenant.serviceCharge) {
      await prisma.serviceCharge.delete({
        where: { tenantId: tenant.id }
      });
    }

    // Update unit status to vacant and restore original rent amount
    await prisma.unit.update({
      where: { id: tenant.unitId },
      data: { 
        status: 'VACANT',
        rentAmount: originalUnitRent
      }
    });

    await prisma.tenant.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Tenant deleted successfully' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(400).json({ message: error.message });
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
      // Update existing service charge
      serviceCharge = await prisma.serviceCharge.update({
        where: { tenantId: req.params.id },
        data: updateData
      });
    } else {
      // Create new service charge
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
        email: financials.email
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