// controllers/demandLetter.controller.js
import prisma from '../lib/prisma.js';
import { generateDemandLetterPDF } from '../utils/demandLetterTemplate.js';
import { uploadDocument } from '../utils/uploadHelper.js';
import { generateFileName } from '../utils/storage.js';

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
 * Generate demand letter for a specific tenant
 * POST /api/demand-letters/generate
 */
export const generateDemandLetter = async (req, res) => {
  try {
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
 */
export const autoGenerateDemandLetter = async (req, res) => {
  try {
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
 * Get overdue invoices for a tenant (with deduplication)
 * GET /api/demand-letters/overdue-invoices/:tenantId
 */
export const getOverdueInvoices = async (req, res) => {
  try {
    const { tenantId } = req.params;

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
 */
export const getDemandLetters = async (req, res) => {
  try {
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

    // Build where clause
    const where = {};

    if (tenantId) where.tenantId = tenantId;
    if (propertyId) where.propertyId = propertyId;
    if (landlordId) where.landlordId = landlordId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.issueDate = {};
      if (startDate) where.issueDate.gte = new Date(startDate);
      if (endDate) where.issueDate.lte = new Date(endDate);
    }

    // If user is a MANAGER, only show their properties
    if (req.user.role === 'MANAGER') {
      const managerProperties = await prisma.property.findMany({
        where: { managerId: req.user.id },
        select: { id: true }
      });
      where.propertyId = {
        in: managerProperties.map(p => p.id)
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
              address: true
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
 */
export const getDemandLetterById = async (req, res) => {
  try {
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

    // Check authorization for managers
    if (req.user.role === 'MANAGER') {
      const property = await prisma.property.findUnique({
        where: { id: demandLetter.propertyId },
        select: { managerId: true }
      });

      if (property.managerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
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

/**
 * Download demand letter PDF
 * GET /api/demand-letters/:id/download
 */
export const downloadDemandLetter = async (req, res) => {
  try {
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

    // Check authorization for managers
    if (req.user.role === 'MANAGER') {
      const property = await prisma.property.findUnique({
        where: { id: demandLetter.propertyId },
        select: { managerId: true }
      });

      if (property.managerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this demand letter'
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

/**
 * Update demand letter status
 * PATCH /api/demand-letters/:id/status
 */
export const updateDemandLetterStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['DRAFT', 'GENERATED', 'SENT', 'ACKNOWLEDGED', 'SETTLED', 'ESCALATED'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const demandLetter = await prisma.demandLetter.update({
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
      data: demandLetter
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

/**
 * Delete demand letter
 * DELETE /api/demand-letters/:id
 */
export const deleteDemandLetter = async (req, res) => {
  try {
    const { id } = req.params;

    const demandLetter = await prisma.demandLetter.findUnique({
      where: { id }
    });

    if (!demandLetter) {
      return res.status(404).json({
        success: false,
        message: 'Demand letter not found'
      });
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

/**
 * Batch generate demand letters for multiple tenants
 * POST /api/demand-letters/batch-generate
 */
export const batchGenerateDemandLetters = async (req, res) => {
  try {
    const { tenantIds, demandPeriod = '7 days', notes } = req.body;

    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'tenantIds array is required'
      });
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
            landlordId: 'unknown', // You might need to fetch this
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