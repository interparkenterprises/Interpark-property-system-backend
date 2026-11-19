import prisma from '../lib/prisma.js';
import { assertIn } from '../middleware/portalScopeMiddleware.js';

// ======================================================
// SAFE PROJECTIONS
//
// Every endpoint that returns a Property / Unit / Tenant /
// DemandLetter / DailyReport / ManagerCommission MUST use one
// of these projections. Never spread a full Prisma record into
// a landlord-portal response — those records carry bank fields,
// tenant PII, manager-commission internals, etc.
// ======================================================

const SAFE_PROPERTY_SUMMARY = {
  id: true,
  name: true,
  address: true,
  lrNumber: true,
  form: true,
  usage: true,
  commissionFee: true,
  image: true,
  createdAt: true,
  updatedAt: true,
};

const SAFE_PROPERTY_DETAIL = {
  ...SAFE_PROPERTY_SUMMARY,
  landlordId: true,
  managerId: true,
  manager: { select: { id: true, name: true, email: true } },
};

const SAFE_UNIT = {
  id: true,
  unitNo: true,
  type: true,
  unitType: true,
  floor: true,
  sizeSqFt: true,
  bedrooms: true,
  bathrooms: true,
  status: true,
  rentType: true,
  rentAmount: true,
  usage: true,
};

const SAFE_TENANT = {
  id: true,
  fullName: true,
  leaseTerm: true,
  termStart: true,
  rentStart: true,
  status: true,
  leftAt: true,
  leftReason: true,
  isFrozen: true,
  unit: { select: { id: true, unitNo: true, floor: true, type: true } },
  // Explicitly excluded: KRAPin, email, contact, POBox, rent, deposit,
  // paymentPolicy, vatRate, vatType, escalation*, withholding*, and all
  // financial relations.
};

const SAFE_DEMAND_LETTER = {
  id: true,
  letterNumber: true,
  issueDate: true,
  dueDate: true,
  rentalPeriod: true,
  outstandingAmount: true,
  partialPayment: true,
  partialPaymentDate: true,
  status: true,
  documentUrl: true,
  notes: true,
  tenant: { select: { id: true, fullName: true } },
  unit: { select: { id: true, unitNo: true } },
  // Excluded: tenantContact, landlordContact (redundant for landlord),
  // referenceNumber, previousInvoiceRef, generatedById, invoiceId.
};

const SAFE_DAILY_REPORT = {
  id: true,
  reportDate: true,
  day: true,
  timeSubmitted: true,
  preparedBy: true,
  status: true,
  securityProvider: true,
  securityIncidents: true,
  cleaningContractor: true,
  cleanlinessStandard: true,
  tenantComplaints: true,
  landlordInstructions: true,
  landlordStatus: true,
  occupancyLevel: true,
  waterStatus: true,
  electricityStatus: true,
  otherServicesStatus: true,
  operationalChallenges: true,
  healthSafetyIssues: true,
  // Excluded: managerId, manager, attachments (JSON; could contain
  // internal notes), preventiveTasks, repairs, bookings* — these are
  // operational internals not needed for a landlord summary view.
};

const SAFE_COMMISSION = {
  id: true,
  propertyId: true,
  commissionFee: true,
  incomeAmount: true,
  commissionAmount: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  paidDate: true,
  notes: true,
  createdAt: true,
  property: { select: { id: true, name: true, address: true, lrNumber: true } },
  // Excluded: managerId, manager (identity of the property's manager
  // is already visible via the property endpoint — no need to leak
  // managerCommission.managerId into the landlord's commission view).
};

// ======================================================
// PROFILE
// ======================================================

// @desc    Get own landlord profile + property count
// @route   GET /api/portal/landlord/profile
// @access  Private (LANDLORD)
export const getProfile = async (req, res) => {
  try {
    const landlordId = req.landlordProfileId;

    const [landlord, propertyCount, unitCount] = await Promise.all([
      prisma.landlord.findUnique({
        where: { id: landlordId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          idNumber: true,
          createdAt: true,
          updatedAt: true,
        }
      }),
      prisma.property.count({ where: { landlordId } }),
      prisma.unit.count({ where: { property: { landlordId } } })
    ]);

    if (!landlord) {
      return res.status(404).json({ message: 'Landlord profile not found' });
    }

    res.json({
      success: true,
      data: {
        landlord,
        stats: { propertyCount, unitCount }
      }
    });
  } catch (error) {
    console.error('Landlord portal getProfile error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// PROPERTIES
// ======================================================

// @desc    List own properties
// @route   GET /api/portal/landlord/properties
// @access  Private (LANDLORD)
export const getProperties = async (req, res) => {
  try {
    const landlordId = req.landlordProfileId;

    const properties = await prisma.property.findMany({
      where: { landlordId },
      select: {
        ...SAFE_PROPERTY_SUMMARY,
        manager: { select: { id: true, name: true } },
        _count: { select: { units: true } },
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: properties.length,
      data: properties
    });
  } catch (error) {
    console.error('Landlord portal getProperties error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get one own property (full detail)
// @route   GET /api/portal/landlord/properties/:propertyId
// @access  Private (LANDLORD)
export const getProperty = async (req, res) => {
  try {
    const { propertyId } = req.params;
    // 404 (not 403) if out of scope — caller cannot confirm existence.
    assertIn(req.landlordPropertyIds, propertyId);

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        ...SAFE_PROPERTY_DETAIL,
        units: {
          select: { ...SAFE_UNIT },
          orderBy: [{ unitNo: 'asc' }]
        },
        _count: {
          select: {
            units: true,
            // Counting tenant records would leak volume info across
            // statuses; we only expose counts the landlord can derive
            // from their own /units and /tenants views.
          }
        }
      }
    });

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    res.json({ success: true, data: property });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getProperty error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// UNITS
// ======================================================

// @desc    List units of an own property
// @route   GET /api/portal/landlord/properties/:propertyId/units
// @access  Private (LANDLORD)
export const getPropertyUnits = async (req, res) => {
  try {
    const { propertyId } = req.params;
    assertIn(req.landlordPropertyIds, propertyId);

    const units = await prisma.unit.findMany({
      where: { propertyId },
      select: { ...SAFE_UNIT },
      orderBy: [{ unitNo: 'asc' }]
    });

    res.json({
      success: true,
      count: units.length,
      data: units
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getPropertyUnits error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// TENANTS (REDACTED)
// ======================================================

// @desc    List tenants of an own property (redacted view)
// @route   GET /api/portal/landlord/properties/:propertyId/tenants
// @access  Private (LANDLORD)
//
// Query params:
//   status = ACTIVE | LEFT | ALL     (default: ACTIVE)
export const getPropertyTenants = async (req, res) => {
  try {
    const { propertyId } = req.params;
    assertIn(req.landlordPropertyIds, propertyId);

    const { status } = req.query;
    const where = { unit: { propertyId } };

    if (status === 'ALL') {
      // no status filter
    } else if (status === 'LEFT') {
      where.status = 'LEFT';
    } else if (status === 'ACTIVE') {
      where.status = 'ACTIVE';
    } else {
      where.status = 'ACTIVE';
    }

    const tenants = await prisma.tenant.findMany({
      where,
      select: { ...SAFE_TENANT },
      orderBy: { fullName: 'asc' }
    });

    const [activeCount, leftCount, frozenCount] = await Promise.all([
      prisma.tenant.count({ where: { unit: { propertyId }, status: 'ACTIVE' } }),
      prisma.tenant.count({ where: { unit: { propertyId }, status: 'LEFT' } }),
      prisma.tenant.count({ where: { unit: { propertyId }, status: 'ACTIVE', isFrozen: true } })
    ]);

    res.json({
      success: true,
      count: tenants.length,
      metadata: {
        activeTenantsCount: activeCount,
        leftTenantsCount: leftCount,
        frozenTenantsCount: frozenCount,
        filter: status === 'ALL' ? 'all tenants'
              : status === 'LEFT' ? 'left tenants only'
              : 'active tenants only'
      },
      data: tenants
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getPropertyTenants error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// DEMAND LETTERS
// ======================================================

// @desc    List demand letters of an own property
// @route   GET /api/portal/landlord/properties/:propertyId/demand-letters
// @access  Private (LANDLORD)
export const getPropertyDemandLetters = async (req, res) => {
  try {
    const { propertyId } = req.params;
    assertIn(req.landlordPropertyIds, propertyId);

    const letters = await prisma.demandLetter.findMany({
      where: { propertyId },
      select: { ...SAFE_DEMAND_LETTER },
      orderBy: { issueDate: 'desc' }
    });

    res.json({
      success: true,
      count: letters.length,
      data: letters
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getPropertyDemandLetters error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// DAILY REPORTS
// ======================================================

// @desc    List operational daily reports of an own property
// @route   GET /api/portal/landlord/properties/:propertyId/daily-reports
// @access  Private (LANDLORD)
//
// Only SUBMITTED and REVIEWED reports are exposed. DRAFT/ARCHIVED are
// manager-internal states and stay hidden.
export const getPropertyDailyReports = async (req, res) => {
  try {
    const { propertyId } = req.params;
    assertIn(req.landlordPropertyIds, propertyId);

    const reports = await prisma.dailyReport.findMany({
      where: {
        propertyId,
        status: { in: ['SUBMITTED', 'REVIEWED'] }
      },
      select: { ...SAFE_DAILY_REPORT },
      orderBy: { reportDate: 'desc' }
    });

    res.json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getPropertyDailyReports error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// MANAGER COMMISSIONS
// ======================================================

// @desc    List manager commissions across own properties
// @route   GET /api/portal/landlord/commissions
// @access  Private (LANDLORD)
//
// Query params:
//   propertyId = <id>        (optional; must be one of req.landlordPropertyIds)
//   status     = PENDING | PAID | PROCESSING | CANCELLED
//   page / limit (simple pagination; defaults page=1, limit=50, max=200)
export const getCommissions = async (req, res) => {
  try {
    const { propertyId, status } = req.query;

    // If a specific propertyId was requested, verify it's in scope.
    if (propertyId) {
      assertIn(req.landlordPropertyIds, propertyId);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const where = {
      propertyId: propertyId
        ? propertyId
        : { in: req.landlordPropertyIds }
    };
    if (status) {
      const valid = ['PENDING', 'PAID', 'PROCESSING', 'CANCELLED'];
      if (!valid.includes(status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      where.status = status;
    }

    const [total, rows] = await Promise.all([
      prisma.managerCommission.count({ where }),
      prisma.managerCommission.findMany({
        where,
        select: { ...SAFE_COMMISSION },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      })
    ]);

    res.json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      data: rows
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    console.error('Landlord portal getCommissions error:', error);
    res.status(400).json({ message: error.message });
  }
};