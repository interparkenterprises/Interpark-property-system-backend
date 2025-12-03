import { PrismaClient } from '@prisma/client';
import { calculateEscalatedRent, getRentSchedule } from '../services/rentCalculation.js';

const prisma = new PrismaClient();

// Helper function to update unit rent amount
const updateUnitRent = async (unitId, newRent) => {
  try {
    await prisma.unit.update({
      where: { id: unitId },
      data: { rentAmount: parseFloat(newRent) }
    });
  } catch (error) {
    console.error('Error updating unit rent:', error);
    throw new Error('Failed to update unit rent amount');
  }
};

// Helper function to check if manager has access to tenant
const checkManagerTenantAccess = async (userId, tenantId) => {
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

  if (tenant.unit.property.managerId !== userId) {
    return { hasAccess: false, tenant };
  }

  return { hasAccess: true, tenant };
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
      // Admin sees all tenants
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
      // Manager sees only tenants in properties they manage
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
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(tenants);
  } catch (error) {
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

    const tenant = await prisma.tenant.findUnique({
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

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Check access for managers
    if (userRole === 'MANAGER' && tenant.unit.property.managerId !== userId) {
      return res.status(403).json({ message: 'Access denied to this tenant' });
    }

    // Calculate escalated rent and schedule
    const rentInfo = calculateEscalatedRent(tenant);
    const rentSchedule = getRentSchedule(tenant, 3);

    res.json({
      ...tenant,
      rentInfo,
      rentSchedule
    });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create tenant
// @route   POST /api/tenants
// @access  Private
export const createTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const {
      fullName,
      contact,
      KRAPin,
      POBox,
      unitId,
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
    if (!fullName || !contact || !KRAPin || !unitId || !leaseTerm || rent == null || !termStart || !rentStart || deposit == null || !paymentPolicy) {
      return res.status(400).json({
        message: 'All fields except POBox, escalationRate, escalationFrequency, vatRate, vatType, and serviceCharge are required.'
      });
    }

    // Check if unit exists and verify manager has access
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: true }
    });

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Check access for managers
    if (userRole === 'MANAGER' && unit.property.managerId !== userId) {
      return res.status(403).json({ message: 'Access denied to this unit' });
    }

    if (unit.status === 'OCCUPIED') {
      return res.status(400).json({ message: 'Unit is already occupied' });
    }

    // Validate payment policy enum
    const validPaymentPolicies = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
    const normalizedPaymentPolicy = paymentPolicy.toUpperCase();
    if (!validPaymentPolicies.includes(normalizedPaymentPolicy)) {
      return res.status(400).json({
        message: `Invalid payment policy. Must be one of: ${validPaymentPolicies.join(', ')}`
      });
    }

    // Validate escalationFrequency if provided
    let normalizedEscalationFrequency = null;
    if (escalationFrequency !== undefined && escalationFrequency !== null) {
      const validEscalations = ['ANNUALLY', 'BI_ANNUALLY'];
      normalizedEscalationFrequency = escalationFrequency.toUpperCase();
      if (!validEscalations.includes(normalizedEscalationFrequency)) {
        return res.status(400).json({
          message: `Invalid escalation frequency. Must be one of: ${validEscalations.join(', ')}, or null`
        });
      }
    }

    // Validate VAT type if provided
    let normalizedVatType = 'NOT_APPLICABLE';
    if (vatType !== undefined && vatType !== null) {
      const validVatTypes = ['INCLUSIVE', 'EXCLUSIVE', 'NOT_APPLICABLE'];
      normalizedVatType = vatType.toUpperCase();
      if (!validVatTypes.includes(normalizedVatType)) {
        return res.status(400).json({
          message: `Invalid VAT type. Must be one of: ${validVatTypes.join(', ')}`
        });
      }
    }

    // Validate VAT rate
    let parsedVatRate = 0;
    if (vatRate !== undefined && vatRate !== null) {
      parsedVatRate = parseFloat(vatRate);
      if (isNaN(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100) {
        return res.status(400).json({
          message: 'VAT rate must be a number between 0 and 100'
        });
      }
    }

    // If VAT type is NOT_APPLICABLE, force vatRate to 0
    if (normalizedVatType === 'NOT_APPLICABLE') {
      parsedVatRate = 0;
    }

    // Check if KRA Pin is unique
    const existingKRA = await prisma.tenant.findUnique({
      where: { KRAPin }
    });
    if (existingKRA) {
      return res.status(400).json({ message: 'KRA Pin already exists' });
    }

    // Parse rent amount
    const parsedRent = parseFloat(rent);

    // Build tenant data
    const tenantData = {
      fullName,
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
      vatType: normalizedVatType
    };

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: tenantData,
      include: {
        unit: {
          include: { property: true }
        },
        serviceCharge: true
      }
    });

    // Update unit rent amount to match tenant's rent and set status to OCCUPIED
    await prisma.unit.update({
      where: { id: unitId },
      data: { 
        rentAmount: parsedRent,
        status: 'OCCUPIED'
      }
    });

    // Handle service charge if provided
    if (serviceCharge) {
      const { type, fixedAmount, percentage, perSqFtRate } = serviceCharge;

      // Validate service charge type
      const validServiceChargeTypes = ['FIXED', 'PERCENTAGE', 'PER_SQ_FT'];
      const normalizedType = type?.toUpperCase();
      if (!normalizedType || !validServiceChargeTypes.includes(normalizedType)) {
        // Clean up on failure
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ 
          where: { id: unitId }, 
          data: { 
            status: 'VACANT',
            rentAmount: unit.rentAmount
          } 
        });
        return res.status(400).json({
          message: `Invalid service charge type. Must be one of: ${validServiceChargeTypes.join(', ')}`
        });
      }

      // Validate values by type
      if (normalizedType === 'FIXED' && (!fixedAmount || parseFloat(fixedAmount) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ 
          where: { id: unitId }, 
          data: { 
            status: 'VACANT',
            rentAmount: unit.rentAmount
          } 
        });
        return res.status(400).json({ message: 'Fixed amount (> 0) is required for FIXED service charge' });
      }

      if (normalizedType === 'PERCENTAGE' && (!percentage || parseFloat(percentage) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ 
          where: { id: unitId }, 
          data: { 
            status: 'VACANT',
            rentAmount: unit.rentAmount
          } 
        });
        return res.status(400).json({ message: 'Percentage (> 0) is required for PERCENTAGE service charge' });
      }

      if (normalizedType === 'PER_SQ_FT' && (!perSqFtRate || parseFloat(perSqFtRate) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ 
          where: { id: unitId }, 
          data: { 
            status: 'VACANT',
            rentAmount: unit.rentAmount
          } 
        });
        return res.status(400).json({ message: 'Per sq. ft rate (> 0) is required for PER_SQ_FT service charge' });
      }

      // Create service charge
      await prisma.serviceCharge.create({
        data: {
          tenantId: tenant.id,
          type: normalizedType,
          fixedAmount: fixedAmount ? parseFloat(fixedAmount) : null,
          percentage: percentage ? parseFloat(percentage) : null,
          perSqFtRate: perSqFtRate ? parseFloat(perSqFtRate) : null
        }
      });
    }

    // Return full tenant with relations
    const completeTenant = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      include: {
        unit: { include: { property: true } },
        serviceCharge: true
      }
    });

    res.status(201).json(completeTenant);
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update tenant
// @route   PUT /api/tenants/:id
// @access  Private
export const updateTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access for managers
    if (userRole === 'MANAGER') {
      const { hasAccess } = await checkManagerTenantAccess(userId, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to this tenant' });
      }
    }

    const {
      fullName,
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

    // Fetch existing tenant
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { 
        serviceCharge: true,
        unit: true 
      }
    });

    if (!existingTenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Check KRA uniqueness if updating
    if (KRAPin && KRAPin !== existingTenant.KRAPin) {
      const existingKRA = await prisma.tenant.findUnique({ where: { KRAPin } });
      if (existingKRA) {
        return res.status(400).json({ message: 'KRA Pin already exists' });
      }
    }

    // Validate payment policy
    let normalizedPaymentPolicy = undefined;
    if (paymentPolicy !== undefined) {
      const validPolicies = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
      normalizedPaymentPolicy = paymentPolicy.toUpperCase();
      if (!validPolicies.includes(normalizedPaymentPolicy)) {
        return res.status(400).json({
          message: `Invalid payment policy. Must be one of: ${validPolicies.join(', ')}`
        });
      }
    }

    // Validate escalation frequency
    let normalizedEscalationFrequency = undefined;
    if (escalationFrequency !== undefined) {
      if (escalationFrequency === null) {
        normalizedEscalationFrequency = null;
      } else {
        const validEscalations = ['ANNUALLY', 'BI_ANNUALLY'];
        normalizedEscalationFrequency = escalationFrequency.toUpperCase();
        if (!validEscalations.includes(normalizedEscalationFrequency)) {
          return res.status(400).json({
            message: `Invalid escalation frequency. Must be one of: ${validEscalations.join(', ')}, or null`
          });
        }
      }
    }

    // Validate VAT type
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

    // Validate VAT rate
    let parsedVatRate = undefined;
    if (vatRate !== undefined) {
      if (vatRate === null) {
        parsedVatRate = 0;
      } else {
        parsedVatRate = parseFloat(vatRate);
        if (isNaN(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100) {
          return res.status(400).json({
            message: 'VAT rate must be a number between 0 and 100'
          });
        }
      }
    }

    // If VAT type is being changed to NOT_APPLICABLE, force vatRate to 0
    if (normalizedVatType === 'NOT_APPLICABLE') {
      parsedVatRate = 0;
    }

    // Parse rent amount if provided
    let parsedRent = undefined;
    if (rent !== undefined) {
      parsedRent = parseFloat(rent);
      if (isNaN(parsedRent) || parsedRent < 0) {
        return res.status(400).json({
          message: 'Rent must be a positive number'
        });
      }
    }

    // Parse numeric fields conditionally
    const updateData = {
      fullName,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent: parsedRent,
      escalationRate: escalationRate != null 
        ? (escalationRate === null ? null : parseFloat(escalationRate)) 
        : undefined,
      escalationFrequency: normalizedEscalationFrequency,
      termStart: termStart ? new Date(termStart) : undefined,
      rentStart: rentStart ? new Date(rentStart) : undefined,
      deposit: deposit != null ? parseFloat(deposit) : undefined,
      paymentPolicy: normalizedPaymentPolicy,
      vatRate: parsedVatRate,
      vatType: normalizedVatType
    };

    // Remove undefined fields to avoid overwriting with null/undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Perform tenant update
    const updatedTenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        unit: { include: { property: true } },
        serviceCharge: true
      }
    });

    // If rent was updated, also update the unit's rentAmount
    if (rent !== undefined && parsedRent !== existingTenant.rent) {
      await updateUnitRent(existingTenant.unitId, parsedRent);
    }

    // Handle service charge update or creation
    if (serviceCharge) {
      const { type, fixedAmount, percentage, perSqFtRate } = serviceCharge;

      let normalizedType = undefined;
      if (type !== undefined) {
        const validTypes = ['FIXED', 'PERCENTAGE', 'PER_SQ_FT'];
        normalizedType = type.toUpperCase();
        if (!validTypes.includes(normalizedType)) {
          return res.status(400).json({
            message: `Invalid service charge type. Must be one of: ${validTypes.join(', ')}`
          });
        }
      }

      // Prepare service charge update data
      const serviceChargeData = {
        type: normalizedType,
        fixedAmount: fixedAmount != null ? (fixedAmount === null ? null : parseFloat(fixedAmount)) : undefined,
        percentage: percentage != null ? (percentage === null ? null : parseFloat(percentage)) : undefined,
        perSqFtRate: perSqFtRate != null ? (perSqFtRate === null ? null : parseFloat(perSqFtRate)) : undefined
      };

      // Remove undefined
      Object.keys(serviceChargeData).forEach(k => serviceChargeData[k] === undefined && delete serviceChargeData[k]);

      if (Object.keys(serviceChargeData).length > 0) {
        if (existingTenant.serviceCharge) {
          // Update existing
          await prisma.serviceCharge.update({
            where: { tenantId: req.params.id },
            data: serviceChargeData
          });
        } else if (normalizedType) {
          // Create new (only if type is provided)
          await prisma.serviceCharge.create({
            data: {
              tenantId: req.params.id,
              type: normalizedType,
              fixedAmount: serviceChargeData.fixedAmount ?? null,
              percentage: serviceChargeData.percentage ?? null,
              perSqFtRate: serviceChargeData.perSqFtRate ?? null
            }
          });
        }
      }
    }

    // Fetch final updated tenant
    const finalTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { property: true } },
        serviceCharge: true
      }
    });

    res.json(finalTenant);
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete tenant
// @route   DELETE /api/tenants/:id
// @access  Private
export const deleteTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access for managers
    if (userRole === 'MANAGER') {
      const { hasAccess } = await checkManagerTenantAccess(userId, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to this tenant' });
      }
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
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update tenant service charge
// @route   PATCH /api/tenants/:id/service-charge
// @access  Private
export const updateServiceCharge = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access for managers
    if (userRole === 'MANAGER') {
      const { hasAccess } = await checkManagerTenantAccess(userId, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to this tenant' });
      }
    }

    const { type, fixedAmount, percentage, perSqFtRate } = req.body;

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

    let serviceCharge;

    if (existingTenant.serviceCharge) {
      // Update existing service charge
      serviceCharge = await prisma.serviceCharge.update({
        where: { tenantId: req.params.id },
        data: {
          type: type.toUpperCase(),
          fixedAmount: fixedAmount !== undefined ? parseFloat(fixedAmount) : null,
          percentage: percentage !== undefined ? parseFloat(percentage) : null,
          perSqFtRate: perSqFtRate !== undefined ? parseFloat(perSqFtRate) : null
        }
      });
    } else {
      // Create new service charge
      serviceCharge = await prisma.serviceCharge.create({
        data: {
          tenantId: req.params.id,
          type: type.toUpperCase(),
          fixedAmount: fixedAmount ? parseFloat(fixedAmount) : null,
          percentage: percentage ? parseFloat(percentage) : null,
          perSqFtRate: perSqFtRate ? parseFloat(perSqFtRate) : null
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
// @access  Private
export const removeServiceCharge = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access for managers
    if (userRole === 'MANAGER') {
      const { hasAccess } = await checkManagerTenantAccess(userId, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to this tenant' });
      }
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
    res.status(400).json({ message: error.message });
  }
};
