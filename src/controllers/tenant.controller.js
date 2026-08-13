import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";
import fs from 'fs';
import path from 'path';
import { deleteDocument, fileExists, getFilePath } from '../utils/uploadHelper.js';

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
      // =============================================
      // FIXED: Include invoices in the query to check actual status
      // =============================================
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

    // =============================================
    // FIXED: Helper function to calculate exact overdue days based on invoice data
    // =============================================
    const calculateOverdueDays = (tenant) => {
      const invoices = tenant.invoices || [];
      let maxOverdueDays = 0;
      
      // Check each invoice for overdue status
      for (const invoice of invoices) {
        // Calculate the actual balance
        const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
        
        // Only consider invoices with balance > 0
        if (balance <= 0.01) {
          continue;
        }
        
        // Check if invoice is overdue
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
    
    // Helper function to get the total overdue amount for a tenant
    const calculateTotalOverdueAmount = (tenant) => {
      const invoices = tenant.invoices || [];
      let totalOverdue = 0;
      
      for (const invoice of invoices) {
        const balance = invoice.balance || (invoice.totalDue - invoice.amountPaid);
        
        // Only include invoices with balance > 0
        if (balance <= 0.01) {
          continue;
        }
        
        // Check if invoice is overdue
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
    
    // Helper function to get overdue category
    const getOverdueCategory = (days) => {
      if (days <= 0) return 'NOT_OVERDUE';
      if (days <= 7) return '1_WEEK';
      if (days <= 14) return '2_WEEKS';
      if (days <= 30) return '1_MONTH';
      if (days <= 60) return '2_MONTHS';
      if (days <= 90) return '3_MONTHS';
      return 'OVER_3_MONTHS';
    };

    // =============================================
    // FIXED: Filter tenants with overdue payments based on invoice data
    // =============================================
    let overdueTenants = tenants
      .map(tenant => {
        const rentInfo = calculateEscalatedRent(tenant);
        const monthlyRent = rentInfo.currentRent;
        const paymentAmount = calculatePaymentByPolicy(monthlyRent, tenant.paymentPolicy);
        const paymentSummary = getPaymentSummary(tenant);
        const overdueDays = calculateOverdueDays(tenant);
        const totalOverdueAmount = calculateTotalOverdueAmount(tenant);
        
        // Calculate service charge based on rent ONLY
        const serviceChargeDetails = calculateServiceCharge(tenant, monthlyRent);
        const serviceChargeByPolicy = serviceChargeDetails.amount * getPolicyMonths(tenant.paymentPolicy);
        
        // Calculate VAT on rent
        const vatOnRent = calculateVAT(paymentAmount, tenant.vatType, tenant.vatRate);
        
        // Calculate VAT on service charge (using service charge's own VAT settings)
        const vatOnServiceCharge = serviceChargeDetails.vatAmount * getPolicyMonths(tenant.paymentPolicy);
        
        const totalPayment = paymentAmount + vatOnRent + serviceChargeByPolicy + vatOnServiceCharge;
        
        // Get invoice details for this tenant
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
            category: getOverdueCategory(overdueDays),
            totalOverdueAmount: totalOverdueAmount
          }
        };
      })
      .filter(tenant => {
        // =============================================
        // FIXED: Only include tenants that actually have overdue invoices with balance > 0
        // =============================================
        const invoices = tenant.invoices || [];
        
        // Check if there are any outstanding invoices with balance > 0
        const hasOutstandingInvoices = invoices.some(inv => {
          const balance = inv.balance || (inv.totalDue - inv.amountPaid);
          return balance > 0.01;
        });
        
        if (!hasOutstandingInvoices) {
          return false;
        }
        
        // Check if any outstanding invoice is overdue
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

    // =============================================
    // Calculate summary statistics
    // =============================================
    const totalOverdueAmount = overdueTenants.reduce((sum, tenant) => {
      return sum + tenant.overdueDetails.totalOverdueAmount;
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
    
    // Calculate total outstanding invoices count
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

    // Fetch ALL tenants for the property
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
        serviceCharge: true,
        invoices: {
          where: {
            status: { in: ['UNPAID', 'PARTIAL'] }
          },
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
      // Calculate rent info with escalation
      const rentInfo = calculateEscalatedRent(tenant);
      const monthlyRent = rentInfo.currentRent;
      
      // Calculate total payment breakdown
      const paymentBreakdown = calculateTotalPayment(tenant, monthlyRent, tenant.paymentPolicy);
      
      // Get payment summary - this contains all the calculations we need
      const paymentSummary = getPaymentSummary(tenant);
      
      // =============================================
      // EXTRACT DATA FROM PAYMENT SUMMARY
      // =============================================
      
      // Get the total due per period (one payment period amount)
      const totalDuePerPeriod = paymentSummary.totalDuePerPeriod || paymentBreakdown.total.paymentByPolicy || 0;
      
      // Get outstanding balance (total expected - total paid)
      const outstandingBalance = paymentSummary.paymentHistory?.outstandingBalance || 0;
      const totalPaid = paymentSummary.paymentHistory?.totalPaid || 0;
      const totalExpected = paymentSummary.paymentHistory?.expectedTotal || 0;
      const paymentsBehind = paymentSummary.nextPayment?.paymentsBehind || 0;
      const expectedPaymentsCount = paymentSummary.paymentHistory?.expectedPaymentsCount || 0;
      
      // Get the payment period amount breakdown
      const periodRentAmount = paymentBreakdown.rent.paymentByPolicy || 0;
      const periodServiceCharge = paymentBreakdown.serviceCharge.paymentByPolicy || 0;
      const periodVatOnRent = paymentBreakdown.rent.vatAmount || 0;
      const periodVatOnServiceCharge = paymentBreakdown.serviceCharge.vatAmount || 0;
      
      // =============================================
      // CALCULATE THE NEXT DUE DATE (FUTURE DATE)
      // =============================================
      // Get the next due date from payment summary (this is the next period that needs to be paid)
      let nextDueDate = paymentSummary.nextPayment?.dueDate;
      let isOverdue = paymentSummary.nextPayment?.isOverdue || false;
      
      // For overdue tenants, we want to show the NEXT future due date
      // The current nextDueDate might be in the past for overdue tenants
      // We need to calculate the NEXT upcoming due date (in the future)
      let futureDueDate = nextDueDate;
      let daysUntilFutureDue = 0;
      let isOverdueByBalance = false;
      let overdueSinceDate = null;
      let daysOverdue = 0;
      
      // Calculate the future due date (the next period that will come)
      // This is the due date for the next payment period that hasn't passed yet
      if (nextDueDate) {
        const policyMonths = getPolicyMonths(tenant.paymentPolicy);
        const futureDue = new Date(nextDueDate);
        
        // If the due date is in the past, advance it to the next period
        while (futureDue <= now) {
          futureDue.setMonth(futureDue.getMonth() + policyMonths);
        }
        
        // Set to end of day
        futureDue.setHours(23, 59, 59, 999);
        
        // Use this as the future due date
        futureDueDate = futureDue;
        
        // Calculate the overdue since date (the last missed due date)
        // This is the due date that was missed (one period before the future due date)
        if (isOverdue || outstandingBalance > 0) {
          const overdueSince = new Date(futureDue);
          overdueSince.setMonth(overdueSince.getMonth() - policyMonths);
          overdueSince.setHours(23, 59, 59, 999);
          overdueSinceDate = overdueSince;
          
          // Calculate days overdue (negative value)
          const overdueSinceStart = new Date(overdueSince);
          overdueSinceStart.setHours(0, 0, 0, 0);
          const diffTime = overdueSinceStart - nairobiTodayStart;
          daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      } else {
        // If no next due date, calculate from rent start
        const rentStartDate = new Date(tenant.rentStart);
        const futureDue = new Date(rentStartDate);
        const policyMonths = getPolicyMonths(tenant.paymentPolicy);
        
        // Find the next payment period in the future
        while (futureDue <= now) {
          futureDue.setMonth(futureDue.getMonth() + policyMonths);
        }
        futureDue.setHours(23, 59, 59, 999);
        futureDueDate = futureDue;
        
        // For new tenants with no payments, there's no overdue since
        if (outstandingBalance > 0) {
          const overdueSince = new Date(futureDue);
          overdueSince.setMonth(overdueSince.getMonth() - policyMonths);
          overdueSince.setHours(23, 59, 59, 999);
          overdueSinceDate = overdueSince;
          
          const overdueSinceStart = new Date(overdueSince);
          overdueSinceStart.setHours(0, 0, 0, 0);
          const diffTime = overdueSinceStart - nairobiTodayStart;
          daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }
      
      // =============================================
      // CALCULATE DUE DATE DETAILS FOR FUTURE DUE DATE
      // =============================================
      let isOverdueInNairobi = false;
      let daysUntilDue = 0;
      let dueDateFormatted = null;
      let dueDateStart = null;

      if (futureDueDate) {
        try {
          const dueDateObj = new Date(futureDueDate);
          const dueDateInNairobi = new Date(dueDateObj.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
          dueDateStart = new Date(dueDateInNairobi);
          dueDateStart.setHours(0, 0, 0, 0);
          
          // Calculate days until due using Nairobi timezone dates
          const diffTime = dueDateStart - nairobiTodayStart;
          daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Determine if overdue based on Nairobi timezone
          // A tenant is overdue if they have an outstanding balance OR the due date has passed
          isOverdueInNairobi = nairobiTodayStart > dueDateStart;
          
          // Format the due date
          dueDateFormatted = dueDateInNairobi.toLocaleDateString('en-US', {
            timeZone: 'Africa/Nairobi',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
        } catch (dateError) {
          console.error('Error processing date for tenant:', tenant.id, dateError);
          dueDateFormatted = futureDueDate ? new Date(futureDueDate).toLocaleDateString() : 'Not set';
          daysUntilDue = 0;
          isOverdueInNairobi = false;
        }
      }
      
      // Determine if the tenant is overdue based on outstanding balance
      // A tenant is overdue if they have any outstanding balance AND the current date is past the due date
      isOverdueByBalance = outstandingBalance > 0;
      
      // Format overdue since date if it exists
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
      
      // Determine status
      let statusDisplay = paymentSummary?.status || 'UNPAID';
      
      if (outstandingBalance > 0 && (isOverdueInNairobi || paymentsBehind > 0)) {
        statusDisplay = 'OVERDUE';
      } else if (daysUntilDue === 0) {
        statusDisplay = 'DUE_TODAY';
      } else if (daysUntilDue <= 5 && daysUntilDue > 0) {
        statusDisplay = 'GRACE_PERIOD_SOON';
      } else if (outstandingBalance > 0 && !isOverdueInNairobi) {
        // Has balance but not overdue yet (shouldn't happen normally)
        statusDisplay = 'PARTIALLY_PAID';
      }
      
      // =============================================
      // CALCULATE THE AMOUNT DUE (INCLUDING ARREARS)
      // =============================================
      
      // Calculate how many periods are behind
      let periodsBehind = 0;
      if (totalDuePerPeriod > 0) {
        periodsBehind = Math.floor(outstandingBalance / totalDuePerPeriod);
        // If there's a partial period, round up
        if (outstandingBalance % totalDuePerPeriod > 0) {
          periodsBehind += 1;
        }
      }
      
      // FIXED: Calculate the total amount due
      // For ALL tenants, the total amount due should be:
      // - If they have an outstanding balance (arrears): outstandingBalance + regularPeriodAmount
      // - If they are up to date: regularPeriodAmount only
      // - If they have overpaid: regularPeriodAmount - credit (or 0 if fully covered)
      let totalAmountDue = totalDuePerPeriod;
      
      if (outstandingBalance > 0) {
        // Tenant has arrears - show current period + arrears
        totalAmountDue = totalDuePerPeriod + outstandingBalance;
      } else if (outstandingBalance < 0) {
        // Tenant has overpaid - apply credit to current period
        const creditAmount = Math.abs(outstandingBalance);
        if (creditAmount >= totalDuePerPeriod) {
          // Credit covers the entire current period
          totalAmountDue = 0;
          // Note: The remaining credit will be shown in outstandingBalance
        } else {
          // Credit partially covers the current period
          totalAmountDue = totalDuePerPeriod - creditAmount;
        }
      } else {
        // No outstanding balance - regular period amount
        totalAmountDue = totalDuePerPeriod;
      }
      
      // Calculate the breakdown of the amount due
      let amountBreakdown = {
        rent: periodRentAmount,
        serviceCharge: periodServiceCharge,
        vatOnRent: periodVatOnRent,
        vatOnServiceCharge: periodVatOnServiceCharge,
        total: totalAmountDue
      };
      
      // If there's an outstanding balance, distribute it proportionally
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
      
      // Calculate grace period end (5th of the month) - only if we have a due date
      let gracePeriodEnd = null;
      let daysUntilGraceEnd = null;
      let isInGracePeriod = false;

      if (futureDueDate && dueDateStart) {
        try {
          const dueDateObj = new Date(futureDueDate);
          gracePeriodEnd = new Date(dueDateObj);
          gracePeriodEnd.setDate(5);
          gracePeriodEnd.setHours(23, 59, 59, 999);
          const gracePeriodEndInNairobi = new Date(gracePeriodEnd.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
          const gracePeriodEndStart = new Date(gracePeriodEndInNairobi);
          gracePeriodEndStart.setHours(0, 0, 0, 0);
          
          isInGracePeriod = !isOverdueInNairobi && nairobiTodayStart > dueDateStart && nairobiTodayStart <= gracePeriodEndStart;
          
          if (isInGracePeriod || (!isOverdueInNairobi && daysUntilDue <= 0)) {
            const graceDiffTime = gracePeriodEndStart - nairobiTodayStart;
            daysUntilGraceEnd = Math.ceil(graceDiffTime / (1000 * 60 * 60 * 24));
          }
        } catch (graceError) {
          console.error('Error calculating grace period for tenant:', tenant.id, graceError);
          isInGracePeriod = false;
          daysUntilGraceEnd = null;
        }
      }

      // =============================================
      // BUILD THE PAYMENT OBJECT
      // =============================================
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
          isOverdue: isOverdueByBalance || isOverdueInNairobi,
          isInGracePeriod: isInGracePeriod,
          daysUntilGraceEnd: daysUntilGraceEnd,
          gracePeriodEnd: gracePeriodEnd ? gracePeriodEnd.toLocaleDateString('en-US', {
            timeZone: 'Africa/Nairobi',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          }) : null,
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
          outstandingBalance: outstandingBalance,
          regularPeriodAmount: totalDuePerPeriod,
          // NEW: Overdue tracking fields
          overdueSince: overdueSinceFormatted,
          overdueSinceRaw: overdueSinceDate ? overdueSinceDate.toISOString() : null,
          daysOverdue: daysOverdue // Negative value for overdue days
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
        } : null
      });
    }

    // Sort: Overdue first, then by days until due (most urgent first)
    tenantsWithNextPayment.sort((a, b) => {
      // Overdue first
      if (a.payment.isOverdue && !b.payment.isOverdue) return -1;
      if (!a.payment.isOverdue && b.payment.isOverdue) return 1;
      // Then by days until due (ascending)
      return a.payment.daysUntilDue - b.payment.daysUntilDue;
    });

    // Calculate summary statistics
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

    // Get property name safely
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
      serviceCharge,
      // Withholding tax fields
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

    // If VAT type is NOT_APPLICABLE, force vatRate = 0
    if (normalizedVatType === "NOT_APPLICABLE") {
      parsedVatRate = 0;
    }

    // =============================================
    // WITHHOLDING TAX VALIDATION
    // =============================================
    
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

    // Validate exemption flag
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
      // Withholding tax fields
      withholdingTaxRate: parsedWithholdingTaxRate,
      withholdingVatRate: parsedWithholdingVatRate,
      isWithholdingTaxExempt: isExempt,
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
      unitId, // Allow unit change
      // Withholding tax fields
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

    // =============================================
    // HANDLE UNIT TRANSFER
    // =============================================
    let targetUnit = null;
    let unitPriceWarning = null;

    if (unitId && unitId !== existingTenant.unitId) {
      // Fetch the target unit with tenant relation
      targetUnit = await prisma.unit.findUnique({
        where: { id: unitId },
        include: {
          property: true,
          tenant: true // Include the tenant relation to check if occupied
        }
      });

      if (!targetUnit) {
        return res.status(404).json({ message: "Target unit not found" });
      }

      // Verify the target unit is in the same property
      if (targetUnit.propertyId !== existingTenant.unit.propertyId) {
        return res.status(400).json({
          message: "Cannot move tenant to a unit in a different property. Please update property separately."
        });
      }

      // IMPORTANT: Check if the unit is occupied
      const isUnitOccupied = targetUnit.status === 'OCCUPIED' || targetUnit.tenant !== null;
      
      if (isUnitOccupied) {
        let detailedMessage = "Target unit is not vacant.";
        const reasons = [];
        
        if (targetUnit.status === 'OCCUPIED') {
          reasons.push(`Unit status is 'OCCUPIED'`);
        }
        if (targetUnit.tenant !== null) {
          reasons.push(`Unit has tenant: ${targetUnit.tenant.fullName}`);
        }
        
        if (reasons.length > 0) {
          detailedMessage += ` (${reasons.join(', ')})`;
        }
        
        return res.status(400).json({
          message: detailedMessage,
          unitStatus: targetUnit.status,
          hasTenant: !!targetUnit.tenant,
          tenantName: targetUnit.tenant?.fullName || null
        });
      }

      // Double-check if target unit has any tenant relation (extra safety)
      const existingTenantInTarget = await prisma.tenant.findFirst({
        where: { unitId: targetUnit.id }
      });

      if (existingTenantInTarget) {
        return res.status(400).json({
          message: `Target unit is already assigned to another tenant: ${existingTenantInTarget.fullName}`
        });
      }

      // Check for unit price difference
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

    // =============================================
    // WITHHOLDING TAX VALIDATION FOR UPDATE
    // =============================================
    
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

    // Determine the final rent value
    let finalRent = undefined;
    let parsedRent = undefined;

    // If unit is being changed, the rent should default to the target unit's rent
    // UNLESS the user explicitly provides a new rent value in the request
    if (unitId && unitId !== existingTenant.unitId && targetUnit) {
      if (rent !== undefined) {
        // User explicitly provided a rent value, use that
        parsedRent = parseFloat(rent);
        if (isNaN(parsedRent) || parsedRent < 0) {
          return res.status(400).json({
            message: "Rent must be a positive number",
          });
        }
        finalRent = parsedRent;
        
        // Also update the target unit's rent to match if different
        if (targetUnit.rentAmount !== parsedRent) {
          await prisma.unit.update({
            where: { id: targetUnit.id },
            data: { rentAmount: parsedRent }
          });
        }
      } else {
        // Use the target unit's rent
        finalRent = targetUnit.rentAmount;
      }
    } else if (rent !== undefined) {
      // No unit change, but rent is being updated
      parsedRent = parseFloat(rent);
      if (isNaN(parsedRent) || parsedRent < 0) {
        return res.status(400).json({
          message: "Rent must be a positive number",
        });
      }
      finalRent = parsedRent;
    } else {
      // No changes to rent
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
      // Withholding tax fields
      withholdingTaxRate: parsedWithholdingTaxRate,
      withholdingVatRate: parsedWithholdingVatRate,
      isWithholdingTaxExempt: isExempt,
    };

    // If unit is being changed, update the unitId in tenant data
    if (unitId && unitId !== existingTenant.unitId) {
      updateData.unitId = unitId;
    }

    // Remove undefined fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // =============================================
    // EXECUTE UNIT TRANSFER (with transaction)
    // =============================================
    let updatedTenant;
    let oldUnitId = existingTenant.unitId;

    if (unitId && unitId !== existingTenant.unitId && targetUnit) {
      // Re-check unit status right before the transaction to avoid race conditions
      const freshTargetUnit = await prisma.unit.findUnique({
        where: { id: targetUnit.id },
        include: {
          tenant: true
        }
      });

      if (freshTargetUnit) {
        const isOccupied = freshTargetUnit.status === 'OCCUPIED' || freshTargetUnit.tenant !== null;
        
        if (isOccupied) {
          return res.status(400).json({
            message: "Target unit is no longer vacant. It may have been occupied during the process.",
            unitStatus: freshTargetUnit.status,
            hasTenant: !!freshTargetUnit.tenant,
            tenantName: freshTargetUnit.tenant?.fullName || null
          });
        }
      }

      // Use a transaction to ensure data consistency
      updatedTenant = await prisma.$transaction(async (tx) => {
        // 1. Free up the old unit (set to VACANT)
        await tx.unit.update({
          where: { id: oldUnitId },
          data: { 
            status: 'VACANT'
          }
        });

        // 2. Update the new unit to OCCUPIED
        await tx.unit.update({
          where: { id: targetUnit.id },
          data: { 
            status: 'OCCUPIED'
          }
        });

        // 3. Update the tenant with the new unit and rent
        const updated = await tx.tenant.update({
          where: { id: req.params.id },
          data: updateData,
          include: {
            unit: { include: { property: true } },
            serviceCharge: true,
          },
        });

        // 4. If rent is being updated, also update the unit's rent amount
        if (updateData.rent !== undefined) {
          await tx.unit.update({
            where: { id: targetUnit.id },
            data: { rentAmount: updateData.rent }
          });
        }

        return updated;
      });
    } else {
      // Regular update (no unit change)
      updatedTenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          unit: { include: { property: true } },
          serviceCharge: true,
        },
      });

      // Update unit rent if changed and no unit change
      if (rent !== undefined && parsedRent !== existingTenant.rent) {
        await prisma.unit.update({
          where: { id: existingTenant.unitId },
          data: { rentAmount: parsedRent },
        });
      }
    }

    // =============================================
    // HANDLE SERVICE CHARGE UPDATE
    // =============================================
    if (serviceCharge !== undefined) {
      // Case 1: serviceCharge is null or explicitly wants to remove it
      if (serviceCharge === null) {
        // Delete the service charge if it exists
        if (existingTenant.serviceCharge) {
          await prisma.serviceCharge.delete({
            where: { tenantId: req.params.id },
          });
        }
      } 
      // Case 2: serviceCharge is an object (update or create)
      else if (serviceCharge && typeof serviceCharge === 'object') {
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
          // Check if we need to create or update
          const existingServiceCharge = await prisma.serviceCharge.findUnique({
            where: { tenantId: req.params.id },
          });

          if (existingServiceCharge) {
            // Update existing
            await prisma.serviceCharge.update({
              where: { tenantId: req.params.id },
              data: serviceChargeUpdateData,
            });
          } else {
            // Create new - ensure we have required fields
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

    // Prepare response with unit transfer information
    const response = {
      ...finalTenant,
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

    // If there's a price warning, include it prominently
    if (unitPriceWarning) {
      response.priceWarning = unitPriceWarning;
    }

    res.json(response);
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

    // Get base URL from request - use the actual request host
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;

    // Add permission flags and preview/download URLs to each attachment
    const attachmentsWithPermissions = attachments.map(attachment => {
      // Get the filename
      let fileName = attachment.fileName || attachment.url;
      if (fileName.includes('/') || fileName.includes('\\')) {
        fileName = fileName.replace(/\\/g, '/').split('/').pop();
      }
      
      return {
        ...attachment,
        // Use relative paths for API endpoints (will be resolved by the frontend)
        previewUrl: `/api/tenants/attachments/${attachment.id}/preview`,
        downloadUrl: `/api/tenants/attachments/${attachment.id}/download`,
        // Use frontend URL for file display
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

    // Check if user has edit permission for this tenant
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

    // Store only the filename (not the full path)
    const storedFileName = filename;

    // Create attachment record in database
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

    // Use relative paths for the frontend
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

    // Check if user has view permission for the tenant
    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'view');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to preview this attachment.',
        requiredPermission: 'VIEW_TENANT'
      });
    }

    // Get the filename from the URL or fileName field
    let fileName = attachment.fileName || attachment.url;
    // If it contains path separators, extract just the filename
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    // Check if file exists in the uploads directory
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.resolve(uploadDir, fileName); // Use path.resolve() for absolute path
    
    console.log('Preview - Looking for file at:', fullPath);
    
    if (!fs.existsSync(fullPath)) {
      console.error('Preview - File not found at path:', fullPath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    // Set headers for preview
    const fileExtension = attachment.name.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension);
    const isPdf = fileExtension === 'pdf';

    if (isImage || isPdf) {
      res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${attachment.name}"`);
      return res.sendFile(fullPath); // Now fullPath is absolute
    } else {
      // For all other files, redirect to download
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

    // Get the filename from the URL or fileName field
    let fileName = attachment.fileName || attachment.url;
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    // Delete the file from storage
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
      // Continue with database deletion even if file deletion fails
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

    // Check if user has view permission for the tenant
    const { hasAccess } = await checkUserTenantAccess(userId, userRole, attachment.tenantId, 'view');
    if (!hasAccess) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to download this attachment.',
        requiredPermission: 'VIEW_TENANT'
      });
    }

    // Get the filename from the URL or fileName field
    let fileName = attachment.fileName || attachment.url;
    if (fileName.includes('/') || fileName.includes('\\')) {
      fileName = fileName.replace(/\\/g, '/').split('/').pop();
    }
    
    // Check if file exists
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const fullPath = path.resolve(uploadDir, fileName); // Use path.resolve() for absolute path
    
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