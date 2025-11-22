import { PrismaClient } from '@prisma/client';
import { calculateEscalatedRent, getRentSchedule } from '../services/rentCalculation.js';

const prisma = new PrismaClient();

// @desc    Get all tenants
// @route   GET /api/tenants
// @access  Private
export const getTenants = async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
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

    //  Calculate escalated rent and schedule
    const rentInfo = calculateEscalatedRent(tenant);
    const rentSchedule = getRentSchedule(tenant, 3); // next 3 escalations

    res.json({
      ...tenant,
      rentInfo,          // { currentRent, nextEscalationDate, escalationsApplied }
      rentSchedule       // [{ period, date, rent }, ...]
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
    const {
      fullName,
      contact,
      KRAPin,
      POBox,
      unitId,
      leaseTerm,
      rent,
      escalationRate,        //  Updated field name
      escalationFrequency,   //  New enum field
      termStart,
      rentStart,
      deposit,
      paymentPolicy,
      serviceCharge
    } = req.body;

    // Validate required fields
    if (!fullName || !contact || !KRAPin || !unitId || !leaseTerm || rent == null || !termStart || !rentStart || deposit == null || !paymentPolicy) {
      return res.status(400).json({
        message: 'All fields except POBox, escalationRate, escalationFrequency, and serviceCharge are required.'
      });
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

    // Check if KRA Pin is unique
    const existingKRA = await prisma.tenant.findUnique({
      where: { KRAPin }
    });
    if (existingKRA) {
      return res.status(400).json({ message: 'KRA Pin already exists' });
    }

    // Check if unit exists and is vacant
    const unit = await prisma.unit.findUnique({
      where: { id: unitId }
    });
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }
    if (unit.status === 'OCCUPIED') {
      return res.status(400).json({ message: 'Unit is already occupied' });
    }

    // Build tenant data
    const tenantData = {
      fullName,
      contact,
      KRAPin,
      POBox: POBox || null,
      unitId,
      leaseTerm,
      rent: parseFloat(rent),
      escalationRate: escalationRate != null ? parseFloat(escalationRate) : null,
      escalationFrequency: normalizedEscalationFrequency, // null if not provided
      termStart: new Date(termStart),
      rentStart: new Date(rentStart),
      deposit: parseFloat(deposit),
      paymentPolicy: normalizedPaymentPolicy
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

    // Handle service charge if provided
    if (serviceCharge) {
      const { type, fixedAmount, percentage, perSqFtRate } = serviceCharge;

      // Validate service charge type
      const validServiceChargeTypes = ['FIXED', 'PERCENTAGE', 'PER_SQ_FT'];
      const normalizedType = type?.toUpperCase();
      if (!normalizedType || !validServiceChargeTypes.includes(normalizedType)) {
        // Clean up on failure
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ where: { id: unitId }, data: { status: 'VACANT' } });
        return res.status(400).json({
          message: `Invalid service charge type. Must be one of: ${validServiceChargeTypes.join(', ')}`
        });
      }

      // Validate values by type
      if (normalizedType === 'FIXED' && (!fixedAmount || parseFloat(fixedAmount) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ where: { id: unitId }, data: { status: 'VACANT' } });
        return res.status(400).json({ message: 'Fixed amount (> 0) is required for FIXED service charge' });
      }

      if (normalizedType === 'PERCENTAGE' && (!percentage || parseFloat(percentage) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ where: { id: unitId }, data: { status: 'VACANT' } });
        return res.status(400).json({ message: 'Percentage (> 0) is required for PERCENTAGE service charge' });
      }

      if (normalizedType === 'PER_SQ_FT' && (!perSqFtRate || parseFloat(perSqFtRate) <= 0)) {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        await prisma.unit.update({ where: { id: unitId }, data: { status: 'VACANT' } });
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

    // Update unit status to OCCUPIED
    await prisma.unit.update({
      where: { id: unitId },
      data: { status: 'OCCUPIED' }
    });

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
    // Optional: rollback unit status if tenant creation failed partially
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update tenant
// @route   PUT /api/tenants/:id
// @access  Private
export const updateTenant = async (req, res) => {
  try {
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
      serviceCharge
    } = req.body;

    // Fetch existing tenant
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { serviceCharge: true }
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

    // Parse numeric fields conditionally
    const updateData = {
      fullName,
      contact,
      KRAPin,
      POBox,
      leaseTerm,
      rent: rent != null ? parseFloat(rent) : undefined,
      escalationRate: escalationRate != null 
        ? (escalationRate === null ? null : parseFloat(escalationRate)) 
        : undefined,
      escalationFrequency: normalizedEscalationFrequency, // could be string, null, or undefined
      termStart: termStart ? new Date(termStart) : undefined,
      rentStart: rentStart ? new Date(rentStart) : undefined,
      deposit: deposit != null ? parseFloat(deposit) : undefined,
      paymentPolicy: normalizedPaymentPolicy
    };

    // Remove undefined fields to avoid overwriting with null/undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Perform update
    const updatedTenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        unit: { include: { property: true } },
        serviceCharge: true
      }
    });

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

    // Delete service charge if exists
    if (tenant.serviceCharge) {
      await prisma.serviceCharge.delete({
        where: { tenantId: tenant.id }
      });
    }

    // Update unit status to vacant
    await prisma.unit.update({
      where: { id: tenant.unitId },
      data: { status: 'VACANT' }
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