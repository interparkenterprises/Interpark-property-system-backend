// controllers/demandLetter.controller.js
import prisma from '../lib/prisma.js';
import { generateDemandLetterPDF } from '../utils/demandLetterTemplate.js';
import { uploadDocument } from '../utils/uploadHelper.js';
import { generateFileName } from '../utils/storage.js';
import permissionService from "../services/permissionService.js";

// ======================================================
// PERMISSION HELPER FUNCTIONS
// ======================================================

// Helper to check if user can access demand letter based on property
async function canAccessDemandLetter(userId, userRole, demandLetterId) {
  // ADMIN can access everything
  if (userRole === 'ADMIN') return true;
  
  const demandLetter = await prisma.demandLetter.findUnique({
    where: { id: demandLetterId },
    select: { propertyId: true }
  });
  
  if (!demandLetter) return false;
  
  const propertyId = demandLetter.propertyId;
  
  // MANAGER can access properties they own
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  // USER role needs explicit permission
  return permissionService.checkPropertyAccess(userId, propertyId, 'canView');
}

// Helper to check if user can create demand letters for a property
async function canCreateDemandLetterForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  return permissionService.hasPermission(userId, 'CREATE_DEMAND_LETTER', propertyId);
}

// Helper to check if user can view demand letters for a property
async function canViewDemandLettersForProperty(userId, userRole, propertyId) {
  if (userRole === 'ADMIN') return true;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { managerId: true }
    });
    return property?.managerId === userId;
  }
  
  return permissionService.hasPermission(userId, 'VIEW_DEMAND_LETTERS', propertyId);
}

// ======================================================
// HELPER FUNCTIONS
// ======================================================

/**
 * Deduplicate invoices to avoid counting balances twice
 * When a PARTIAL invoice and its UNPAID balance invoice both exist for the same payment report,
 * only count the PARTIAL one (which already contains the balance)
 */
function deduplicateInvoices(invoices) {
  const paymentReportMap = new Map();
  const result = [];
  
  // First, separate invoices with and without payment reports
  const invoicesWithReport = [];
  const invoicesWithoutReport = [];
  
  for (const invoice of invoices) {
    if (invoice.paymentReportId) {
      invoicesWithReport.push(invoice);
    } else {
      invoicesWithoutReport.push(invoice);
    }
  }
  
  // Invoices without payment reports (regular invoices) are always included
  result.push(...invoicesWithoutReport);
  
  // Group invoices by payment report
  for (const invoice of invoicesWithReport) {
    if (!paymentReportMap.has(invoice.paymentReportId)) {
      paymentReportMap.set(invoice.paymentReportId, []);
    }
    paymentReportMap.get(invoice.paymentReportId).push(invoice);
  }
  
  // Process grouped invoices
  for (const [paymentReportId, reportInvoices] of paymentReportMap) {
    // Sort by creation date to ensure consistency
    reportInvoices.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    const paidInvoices = reportInvoices.filter(i => i.status === 'PAID');
    const partialInvoices = reportInvoices.filter(i => i.status === 'PARTIAL');
    const unpaidInvoices = reportInvoices.filter(i => i.status === 'UNPAID' || i.status === 'OVERDUE');
    
    // NEW LOGIC: If there's a PAID invoice for this payment report
    if (paidInvoices.length > 0) {
      // Check if the PAID invoice has a balance of 0
      const fullyPaidInvoice = paidInvoices.find(i => i.balance <= 0);
      if (fullyPaidInvoice) {
        // If a payment report is fully paid, exclude ALL unpaid invoices for that report
        console.log(`Deduplication: Payment report ${paymentReportId} is fully PAID. Excluding ${unpaidInvoices.length} unpaid invoice(s)`);
        console.log(`- Paid invoice: ${fullyPaidInvoice.invoiceNumber} (balance: ${fullyPaidInvoice.balance})`);
        console.log(`- Excluded unpaid invoices: ${unpaidInvoices.map(i => `${i.invoiceNumber} (balance: ${i.balance})`).join(', ')}`);
        
        // Only include the PAID invoice
        result.push(fullyPaidInvoice);
        continue; // Skip to next payment report
      }
    }
    
    // Original logic for partial/unpaid scenarios
    if (partialInvoices.length > 0 && unpaidInvoices.length > 0) {
      // When both exist, include PARTIAL and exclude UNPAID (balance invoices)
      result.push(...partialInvoices);
      
      console.log(`Deduplication: Excluded ${unpaidInvoices.length} balance invoice(s) for payment report ${paymentReportId}`);
      console.log(`- Kept: ${partialInvoices.map(i => `${i.invoiceNumber} (${i.status})`).join(', ')}`);
      console.log(`- Excluded: ${unpaidInvoices.map(i => `${i.invoiceNumber} (${i.status})`).join(', ')}`);
    } else {
      // Otherwise include all
      result.push(...reportInvoices);
    }
  }
  
  return result;
}

/**
 * Helper function to generate unique letter number
 */
async function generateLetterNumber() {
  const year = new Date().getFullYear();
  const prefix = `DL-${year}`;
  
  // Get the latest letter number for this year
  const latestLetter = await prisma.demandLetter.findFirst({
    where: {
      letterNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      letterNumber: 'desc'
    }
  });

  if (!latestLetter) {
    return `${prefix}-0001`;
  }

  // Extract the sequence number and increment
  const lastNumber = parseInt(latestLetter.letterNumber.split('-')[2]);
  const newNumber = (lastNumber + 1).toString().padStart(4, '0');

  return `${prefix}-${newNumber}`;
}

/**
 * Format payment policy for display
 */
function formatPaymentPolicy(policy) {
  const policies = {
    'MONTHLY': 'Monthly',
    'QUARTERLY': 'Quarterly',
    'ANNUAL': 'Annually'
  };
  return policies[policy] || policy;
}

// ======================================================
// DEMAND LETTER GENERATION FUNCTIONS
// ======================================================

/**
 * Generate demand letter for a specific tenant
 * POST /api/demand-letters/generate
 * Requires: CREATE_DEMAND_LETTER permission
 */
export const generateDemandLetter = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      tenantId,
      invoiceId,
      outstandingAmount,
      rentalPeriod,
      dueDate,
      demandPeriod = '7 days',
      partialPayment,
      partialPaymentDate,
      referenceNumber,
      notes
    } = req.body;

    // Validate required fields
    if (!tenantId || !outstandingAmount || !rentalPeriod || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: tenantId, outstandingAmount, rentalPeriod, dueDate'
      });
    }

    // Fetch tenant with all related data
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: {
              include: {
                landlord: true
              }
            }
          }
        }
      }
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const propertyId = tenant.unit?.propertyId;

    // CHECK PERMISSION TO CREATE DEMAND LETTER
    if (userRole !== 'ADMIN') {
      const canCreate = await canCreateDemandLetterForProperty(userId, userRole, propertyId);
      if (!canCreate) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create demand letters for this property'
        });
      }
      
      const hasCreatePermission = await permissionService.hasPermission(
        userId, 
        'CREATE_DEMAND_LETTER', 
        propertyId
      );
      
      if (!hasCreatePermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create demand letters'
        });
      }
    }

    // Fetch invoice if provided
    let invoice = null;
    if (invoiceId) {
      invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId }
      });
    }

    const property = tenant.unit.property;
    const landlord = property.landlord;
    const unit = tenant.unit;

    // Generate unique letter number
    const letterNumber = await generateLetterNumber();

    // Create demand letter record
    const demandLetter = await prisma.demandLetter.create({
      data: {
        letterNumber,
        tenantId,
        propertyId: property.id,
        landlordId: landlord.id,
        unitId: unit.id,
        invoiceId: invoiceId || null,
        generatedById: req.user.id,
        issueDate: new Date(),
        outstandingAmount: parseFloat(outstandingAmount),
        rentalPeriod,
        dueDate: new Date(dueDate),
        demandPeriod,
        partialPayment: partialPayment ? parseFloat(partialPayment) : 0,
        partialPaymentDate: partialPaymentDate ? new Date(partialPaymentDate) : null,
        referenceNumber: referenceNumber || letterNumber,
        previousInvoiceRef: invoice?.invoiceNumber || null,
        paymentPolicy: tenant.paymentPolicy,
        landlordContact: landlord.phone || landlord.email,
        tenantContact: tenant.contact || tenant.email,
        status: 'DRAFT',
        notes
      }
    });

    // Prepare data for PDF generation
    const pdfData = {
      // Property Information
      propertyName: property.name,
      propertyAddress: property.address,
      propertyLRNumber: property.lrNumber,
      
      // Landlord Information
      landlordName: landlord.name,
      landlordPOBox: landlord.address || 'P.O. Box …………….',
      landlordPhone: landlord.phone || '……………………',
      landlordEmail: landlord.email || '…………………………',
      
      // Tenant Information
      tenantName: tenant.fullName,
      tenantPOBox: tenant.POBox || '………………………',
      tenantContact: tenant.contact,
      tenantEmail: tenant.email,
      
      // Letter Details
      letterNumber,
      issueDate: new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      referenceNumber: demandLetter.referenceNumber,
      
      // Financial Information
      outstandingAmount: parseFloat(outstandingAmount).toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      rentalPeriod,
      rentAmount: tenant.rent.toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      paymentPolicy: formatPaymentPolicy(tenant.paymentPolicy),
      dueDate: new Date(dueDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      demandPeriod,
      
      // Unit Information
      unitNo: unit.unitNo || 'N/A',
      
      // Optional fields
      partialPayment: partialPayment ? parseFloat(partialPayment).toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) : null,
      partialPaymentDate: partialPaymentDate ? new Date(partialPaymentDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }) : null,
      
      notes
    };

    // Generate PDF
    const pdfBuffer = await generateDemandLetterPDF(pdfData);

    // Generate filename and upload
    const fileName = generateFileName(`demand_letter_${letterNumber}`);
    const filePath = `demand-letters/${fileName}`;
    const documentUrl = await uploadDocument(pdfBuffer, filePath);

    // Update demand letter with document URL and status
    const updatedDemandLetter = await prisma.demandLetter.update({
      where: { id: demandLetter.id },
      data: {
        documentUrl,
        status: 'GENERATED',
        generatedAt: new Date()
      },
      include: {
        tenant: true,
        property: true,
        landlord: true,
        unit: true,
        invoice: true,
        generatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Demand letter generated successfully',
      data: updatedDemandLetter
    });

  } catch (error) {
    console.error('Error generating demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate demand letter',
      error: error.message
    });
  }
};

/**
 * Auto-generate demand letter for tenant with overdue invoices
 * POST /api/demand-letters/auto-generate/:tenantId
 * Requires: AUTO_GENERATE_DEMAND_LETTER permission
 */
export const autoGenerateDemandLetter = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;
    const { demandPeriod = '7 days', notes } = req.body;

    // Fetch tenant with overdue invoices
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: {
              include: {
                landlord: true
              }
            }
          }
        },
        invoices: {
          where: {
            status: {
              in: ['UNPAID', 'OVERDUE', 'PARTIAL']
            }
          },
          orderBy: {
            dueDate: 'asc'
          },
          include: {
            paymentReport: {
              select: {
                id: true
              }
            }
          }
        }
      }
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const propertyId = tenant.unit?.propertyId;

    // CHECK PERMISSION FOR AUTO-GENERATE
    if (userRole !== 'ADMIN') {
      const canCreate = await canCreateDemandLetterForProperty(userId, userRole, propertyId);
      if (!canCreate) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to auto-generate demand letters for this property'
        });
      }
      
      const hasAutoGeneratePermission = await permissionService.hasPermission(
        userId, 
        'AUTO_GENERATE_DEMAND_LETTER', 
        propertyId
      );
      
      if (!hasAutoGeneratePermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to auto-generate demand letters'
        });
      }
    }

    if (!tenant.invoices || tenant.invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No overdue invoices found for this tenant'
      });
    }

    // Deduplicate invoices to avoid double counting
    const deduplicatedInvoices = deduplicateInvoices(tenant.invoices);
    
    if (deduplicatedInvoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid overdue invoices found after deduplication'
      });
    }

    // Calculate total outstanding amount from deduplicated invoices
    const outstandingAmount = deduplicatedInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);

    // Get the oldest overdue invoice from deduplicated list
    const oldestInvoice = deduplicatedInvoices[0];

    // Prepare auto-generation data
    const demandLetterData = {
      tenantId,
      invoiceId: oldestInvoice.id,
      outstandingAmount,
      rentalPeriod: oldestInvoice.paymentPeriod,
      dueDate: oldestInvoice.dueDate,
      demandPeriod,
      referenceNumber: oldestInvoice.invoiceNumber,
      notes: notes || `Auto-generated demand letter for ${deduplicatedInvoices.length} overdue invoice(s) (after deduplication)`
    };

    // Use the main generate function
    req.body = demandLetterData;
    return generateDemandLetter(req, res);

  } catch (error) {
    console.error('Error auto-generating demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-generate demand letter',
      error: error.message
    });
  }
};

/**
 * Batch generate demand letters for multiple tenants
 * POST /api/demand-letters/batch-generate
 * Requires: BATCH_GENERATE_DEMAND_LETTERS permission
 */
export const batchGenerateDemandLetters = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantIds, demandPeriod = '7 days', notes } = req.body;

    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'tenantIds array is required'
      });
    }

    // CHECK PERMISSION FOR BATCH GENERATE
    if (userRole !== 'ADMIN') {
      const hasBatchPermission = await permissionService.hasPermission(
        userId, 
        'BATCH_GENERATE_DEMAND_LETTERS'
      );
      
      if (!hasBatchPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to batch generate demand letters'
        });
      }
    }

    const results = {
      success: [],
      failed: []
    };

    // Process each tenant
    for (const tenantId of tenantIds) {
      try {
        // Fetch tenant with overdue invoices
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          include: {
            unit: {
              include: {
                property: true
              }
            },
            invoices: {
              where: {
                status: {
                  in: ['UNPAID', 'OVERDUE', 'PARTIAL']
                }
              },
              orderBy: {
                dueDate: 'asc'
              },
              include: {
                paymentReport: {
                  select: {
                    id: true
                  }
                }
              }
            }
          }
        });

        if (!tenant) {
          results.failed.push({
            tenantId,
            reason: 'Tenant not found'
          });
          continue;
        }

        if (!tenant.invoices || tenant.invoices.length === 0) {
          results.failed.push({
            tenantId,
            reason: 'No overdue invoices found'
          });
          continue;
        }

        // Deduplicate invoices
        const deduplicatedInvoices = deduplicateInvoices(tenant.invoices);
        
        if (deduplicatedInvoices.length === 0) {
          results.failed.push({
            tenantId,
            reason: 'No valid overdue invoices found after deduplication'
          });
          continue;
        }

        // Calculate outstanding amount
        const outstandingAmount = deduplicatedInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);
        const oldestInvoice = deduplicatedInvoices[0];

        // Generate demand letter data
        const demandLetterData = {
          tenantId,
          invoiceId: oldestInvoice.id,
          outstandingAmount,
          rentalPeriod: oldestInvoice.paymentPeriod,
          dueDate: oldestInvoice.dueDate,
          demandPeriod,
          referenceNumber: oldestInvoice.invoiceNumber,
          notes: notes || `Batch generated demand letter for ${deduplicatedInvoices.length} overdue invoice(s) (after deduplication)`
        };

        // Simulate the generation process
        const demandLetter = await prisma.demandLetter.create({
          data: {
            letterNumber: await generateLetterNumber(),
            tenantId,
            propertyId: tenant.unit?.propertyId || 'unknown',
            landlordId: 'unknown',
            unitId: tenant.unitId || 'unknown',
            invoiceId: oldestInvoice.id,
            generatedById: req.user.id,
            issueDate: new Date(),
            outstandingAmount,
            rentalPeriod: oldestInvoice.paymentPeriod,
            dueDate: oldestInvoice.dueDate,
            demandPeriod,
            referenceNumber: oldestInvoice.invoiceNumber,
            paymentPolicy: tenant.paymentPolicy,
            status: 'GENERATED',
            notes: notes || `Batch generated demand letter for ${deduplicatedInvoices.length} overdue invoice(s)`
          }
        });

        results.success.push({
          tenantId,
          tenantName: tenant.fullName,
          demandLetterId: demandLetter.id,
          letterNumber: demandLetter.letterNumber,
          outstandingAmount,
          invoiceCount: deduplicatedInvoices.length,
          deduplicationApplied: deduplicatedInvoices.length !== tenant.invoices.length
        });

      } catch (error) {
        results.failed.push({
          tenantId,
          reason: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Batch generation completed. ${results.success.length} succeeded, ${results.failed.length} failed`,
      data: results
    });

  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to batch generate demand letters',
      error: error.message
    });
  }
};

// ======================================================
// DEMAND LETTER VIEWING FUNCTIONS
// ======================================================

/**
 * Get overdue invoices for a tenant (with deduplication)
 * GET /api/demand-letters/overdue-invoices/:tenantId
 * Requires: VIEW_OVERDUE_INVOICES permission
 */
export const getOverdueInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;

    // Fetch tenant to get property info
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
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const propertyId = tenant.unit?.propertyId;

    // CHECK PERMISSION TO VIEW OVERDUE INVOICES
    if (userRole !== 'ADMIN') {
      const canView = await canViewDemandLettersForProperty(userId, userRole, propertyId);
      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view overdue invoices for this property'
        });
      }
      
      const hasOverduePermission = await permissionService.hasPermission(
        userId, 
        'VIEW_OVERDUE_INVOICES', 
        propertyId
      );
      
      if (!hasOverduePermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view overdue invoices'
        });
      }
    }

    // Fetch all invoices with specific statuses
    const allInvoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        status: {
          in: ['UNPAID', 'OVERDUE', 'PARTIAL']
        }
      },
      orderBy: {
        dueDate: 'asc'
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            email: true
          }
        },
        paymentReport: {
          select: {
            id: true
          }
        }
      }
    });

    if (!allInvoices || allInvoices.length === 0) {
      return res.json({
        success: true,
        data: {
          invoices: [],
          totalOutstanding: 0,
          count: 0,
          deduplicationApplied: false
        }
      });
    }

    // Apply deduplication logic
    const deduplicatedInvoices = deduplicateInvoices(allInvoices);
    
    // Calculate total outstanding from deduplicated invoices
    const totalOutstanding = deduplicatedInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);

    res.json({
      success: true,
      data: {
        invoices: deduplicatedInvoices,
        totalOutstanding,
        count: deduplicatedInvoices.length,
        originalCount: allInvoices.length,
        deduplicationApplied: deduplicatedInvoices.length !== allInvoices.length
      }
    });

  } catch (error) {
    console.error('Error fetching overdue invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue invoices',
      error: error.message
    });
  }
};

/**
 * Get all demand letters with filters
 * GET /api/demand-letters
 * Requires: VIEW_DEMAND_LETTERS permission
 */
export const getDemandLetters = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      tenantId,
      propertyId,
      landlordId,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    // CHECK BASE PERMISSION
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      const hasViewPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_DEMAND_LETTERS'
      );
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view demand letters'
        });
      }
    }

    // Build where clause
    const where = {};

    if (tenantId) where.tenantId = tenantId;
    if (landlordId) where.landlordId = landlordId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.issueDate = {};
      if (startDate) where.issueDate.gte = new Date(startDate);
      if (endDate) where.issueDate.lte = new Date(endDate);
    }

    // Handle property filtering with permission checks
    if (propertyId) {
      if (userRole !== 'ADMIN') {
        const canView = await canViewDemandLettersForProperty(userId, userRole, propertyId);
        if (!canView) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view demand letters for this property'
          });
        }
      }
      where.propertyId = propertyId;
    } else if (userRole === 'MANAGER') {
      // MANAGER can only see their own properties
      const managerProperties = await prisma.property.findMany({
        where: { managerId: userId },
        select: { id: true }
      });
      where.propertyId = {
        in: managerProperties.map(p => p.id)
      };
    } else if (userRole !== 'ADMIN') {
      // USER role - only properties they have access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      where.propertyId = {
        in: accessiblePropertyIds
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [demandLetters, total] = await Promise.all([
      prisma.demandLetter.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: {
          issueDate: 'desc'
        },
        include: {
          tenant: {
            select: {
              fullName: true,
              contact: true,
              email: true
            }
          },
          property: {
            select: {
              name: true,
              address: true,
              managerId: true
            }
          },
          landlord: {
            select: {
              name: true,
              phone: true,
              email: true
            }
          },
          unit: {
            select: {
              unitNo: true,
              type: true
            }
          },
          invoice: {
            select: {
              invoiceNumber: true,
              totalDue: true,
              balance: true,
              status: true
            }
          },
          generatedBy: {
            select: {
              name: true,
              email: true,
              role: true
            }
          }
        }
      }),
      prisma.demandLetter.count({ where })
    ]);

    res.json({
      success: true,
      data: demandLetters,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching demand letters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demand letters',
      error: error.message
    });
  }
};

/**
 * Get specific demand letter by ID
 * GET /api/demand-letters/:id
 * Requires: VIEW_DEMAND_LETTER_DETAILS permission
 */
export const getDemandLetterById = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id },
      include: {
        tenant: true,
        property: {
          include: {
            landlord: true
          }
        },
        landlord: true,
        unit: true,
        invoice: true,
        generatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
    }

    // Check authorization
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessDemandLetter(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
        });
      }
      
      const hasViewDetailsPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_DEMAND_LETTER_DETAILS'
      );
      
      if (!hasViewDetailsPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view demand letter details'
        });
      }
    }

    res.json({
      success: true,
      data: demandLetter
    });

  } catch (error) {
    console.error('Error fetching demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demand letter',
      error: error.message
    });
  }
};

// ======================================================
// DEMAND LETTER DOWNLOAD FUNCTION
// ======================================================

/**
 * Download demand letter PDF
 * GET /api/demand-letters/:id/download
 * Requires: DOWNLOAD_DEMAND_LETTER permission
 */
export const downloadDemandLetter = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id },
      select: {
        documentUrl: true,
        letterNumber: true,
        propertyId: true
      }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
    }

    if (!demandLetter.documentUrl) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter PDF not generated yet'
      });
    }

    // Check authorization
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessDemandLetter(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
        });
      }
      
      const hasDownloadPermission = await permissionService.hasPermission(
        userId, 
        'DOWNLOAD_DEMAND_LETTER'
      );
      
      if (!hasDownloadPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download demand letters'
        });
      }
    }

    res.json({
      success: true,
      data: {
        documentUrl: demandLetter.documentUrl,
        letterNumber: demandLetter.letterNumber
      }
    });

  } catch (error) {
    console.error('Error downloading demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download demand letter',
      error: error.message
    });
  }
};

// ======================================================
// DEMAND LETTER UPDATE FUNCTIONS
// ======================================================

/**
 * Update demand letter status
 * PATCH /api/demand-letters/:id/status
 * Requires: EDIT_DEMAND_LETTER_STATUS permission
 */
export const updateDemandLetterStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['DRAFT', 'GENERATED', 'SENT', 'ACKNOWLEDGED', 'SETTLED', 'ESCALATED'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id },
      select: { propertyId: true }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
    }

    const propertyId = demandLetter.propertyId;

    // CHECK PERMISSION TO UPDATE STATUS
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessDemandLetter(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
        });
      }
      
      const hasEditPermission = await permissionService.hasPermission(
        userId, 
        'EDIT_DEMAND_LETTER_STATUS', 
        propertyId
      );
      
      if (!hasEditPermission && userRole !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update demand letter status'
        });
      }
    }

    const updatedDemandLetter = await prisma.demandLetter.update({
      where: { id },
      data: {
        status,
        notes: notes || undefined,
        updatedAt: new Date()
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true
          }
        },
        property: {
          select: {
            name: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Demand letter status updated successfully',
      data: updatedDemandLetter
    });

  } catch (error) {
    console.error('Error updating demand letter status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update demand letter status',
      error: error.message
    });
  }
};

// ======================================================
// DEMAND LETTER DELETE FUNCTIONS
// ======================================================

/**
 * Delete demand letter
 * DELETE /api/demand-letters/:id
 * Requires: DELETE_DEMAND_LETTER permission
 */
export const deleteDemandLetter = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id },
      select: { propertyId: true }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
    }

    const propertyId = demandLetter.propertyId;

    // CHECK PERMISSION TO DELETE
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessDemandLetter(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
        });
      }
      
      const hasDeletePermission = await permissionService.hasPermission(
        userId, 
        'DELETE_DEMAND_LETTER', 
        propertyId
      );
      
      if (!hasDeletePermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete demand letters'
        });
      }
    }

    await prisma.demandLetter.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Demand letter deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete demand letter',
      error: error.message
    });
  }
};

// ======================================================
// DEMAND LETTER SEND FUNCTION
// ======================================================

/**
 * Send demand letter to tenant
 * POST /api/demand-letters/:id/send
 * Requires: SEND_DEMAND_LETTERS permission
 */
export const sendDemandLetter = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { email, phone, notes } = req.body;

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id },
      include: {
        tenant: true,
        property: true
      }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
    }

    const propertyId = demandLetter.propertyId;

    // CHECK PERMISSION TO SEND
    if (userRole !== 'ADMIN') {
      const canAccess = await canAccessDemandLetter(userId, userRole, id);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
        });
      }
      
      const hasSendPermission = await permissionService.hasPermission(
        userId, 
        'SEND_DEMAND_LETTERS', 
        propertyId
      );
      
      if (!hasSendPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to send demand letters'
        });
      }
    }

    // Here you would implement actual email/SMS sending logic
    // For now, just update the status to SENT and record delivery method

    const sentTo = [];
    if (email || demandLetter.tenant.email) {
      sentTo.push(email || demandLetter.tenant.email);
    }
    if (phone || demandLetter.tenant.contact) {
      sentTo.push(phone || demandLetter.tenant.contact);
    }

    const updatedDemandLetter = await prisma.demandLetter.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sentTo: sentTo.join(', '),
        notes: notes || `Demand letter sent to ${sentTo.join(', ')}`,
        updatedAt: new Date()
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            email: true
          }
        },
        property: {
          select: {
            name: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Demand letter sent successfully',
      data: updatedDemandLetter
    });

  } catch (error) {
    console.error('Error sending demand letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send demand letter',
      error: error.message
    });
  }
};

// ======================================================
// DEBUG FUNCTION (Remove in production)
// ======================================================

/**
 * Debug endpoint to check user permissions
 * GET /api/demand-letters/debug/user

export const debugUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Get user permissions
    const permissions = await permissionService.getUserPermissions(userId);
    
    // Get accessible properties
    const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
    
    res.json({
      success: true,
      user: {
        id: userId,
        role: userRole,
        name: req.user.name,
        email: req.user.email
      },
      permissions,
      accessiblePropertyCount: accessiblePropertyIds.length,
      accessiblePropertyIds: accessiblePropertyIds.slice(0, 10) // Limit for response size
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}; */