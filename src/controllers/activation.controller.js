import { PrismaClient } from '@prisma/client';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { generateActivationHTML } from '../utils/activationTemplate.js';

const prisma = new PrismaClient();

/**
 * Sanitize activation data - remove fields not in Prisma schema
 */
const sanitizeActivationData = (data) => {
  const {
    // Remove any fields that shouldn't be in the create/update
    id,
    requestNumber,
    createdAt,
    updatedAt,
    property,
    manager,
    documentUrl, // Don't allow manual setting
    submittedAt,
    reviewedAt,
    approvedAt,
    rejectedAt,
    reviewComments,
    reviewedBy,
    durationDays,
    ...sanitizedData
  } = data;

  // Convert date strings to Date objects if they exist
  if (sanitizedData.startDate) {
    sanitizedData.startDate = new Date(sanitizedData.startDate);
  }
  if (sanitizedData.endDate) {
    sanitizedData.endDate = new Date(sanitizedData.endDate);
  }
  if (sanitizedData.signatureDate) {
    sanitizedData.signatureDate = new Date(sanitizedData.signatureDate);
  }

  // Convert numeric strings to numbers
  if (sanitizedData.spaceRequired) {
    sanitizedData.spaceRequired = parseFloat(sanitizedData.spaceRequired);
  }
  if (sanitizedData.expectedVisitors) {
    sanitizedData.expectedVisitors = parseInt(sanitizedData.expectedVisitors);
  }
  if (sanitizedData.parkingSpaces) {
    sanitizedData.parkingSpaces = parseInt(sanitizedData.parkingSpaces);
  }
  if (sanitizedData.proposedBudget) {
    sanitizedData.proposedBudget = parseFloat(sanitizedData.proposedBudget);
  }
  if (sanitizedData.proposedRent) {
    sanitizedData.proposedRent = parseFloat(sanitizedData.proposedRent);
  }
  if (sanitizedData.proposedServiceCharge) {
    sanitizedData.proposedServiceCharge = parseFloat(sanitizedData.proposedServiceCharge);
  }
  if (sanitizedData.proposedDeposit) {
    sanitizedData.proposedDeposit = parseFloat(sanitizedData.proposedDeposit);
  }

  // Remove undefined values to let Prisma use defaults
  Object.keys(sanitizedData).forEach(key => {
    if (sanitizedData[key] === undefined || sanitizedData[key] === '') {
      delete sanitizedData[key];
    }
  });

  return sanitizedData;
};

/**
 * Create new activation request
 * POST /api/activations
 */
export const createActivationRequest = async (req, res) => {
  try {
    const managerId = req.user.id;
    const activationData = req.body;

    // Validate property access
    const property = await prisma.property.findFirst({
      where: {
        id: activationData.propertyId,
        managerId: managerId
      },
      include: {
        landlord: true
      }
    });

    if (!property) {
      return res.status(403).json({ 
        success: false,
        message: 'You do not have access to this property' 
      });
    }

    // Generate unique request number
    const requestNumber = await generateRequestNumber();

    // Sanitize data
    const sanitizedData = sanitizeActivationData(activationData);

    // Create activation request
    const activation = await prisma.activationRequest.create({
      data: {
        ...sanitizedData,
        requestNumber,
        managerId,
        status: 'DRAFT'
      },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Activation request created successfully',
      data: activation
    });

  } catch (error) {
    console.error('Error creating activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create activation request',
      error: error.message 
    });
  }
};

/**
 * Get all activation requests for manager
 * GET /api/activations
 */
export const getActivationRequests = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { propertyId, status, startDate, endDate, page = 1, limit = 10 } = req.query;

    const where = { managerId };

    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [activations, totalCount] = await Promise.all([
      prisma.activationRequest.findMany({
        where,
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true
            }
          },
          manager: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take
      }),
      prisma.activationRequest.count({ where })
    ]);

    res.json({
      success: true,
      count: activations.length,
      totalCount,
      data: activations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching activation requests:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch activation requests',
      error: error.message 
    });
  }
};

/**
 * Get single activation request
 * GET /api/activations/:id
 */
export const getActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: {
        id,
        managerId
      },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    res.json({
      success: true,
      data: activation
    });

  } catch (error) {
    console.error('Error fetching activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch activation request',
      error: error.message 
    });
  }
};

/**
 * Update activation request
 * PUT /api/activations/:id
 */
export const updateActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;
    const updateData = req.body;

    // Check if activation exists and belongs to manager
    const existing = await prisma.activationRequest.findFirst({
      where: { id, managerId }
    });

    if (!existing) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Don't allow updates to approved/completed requests
    if (['APPROVED', 'COMPLETED'].includes(existing.status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Cannot update approved or completed requests' 
      });
    }

    // Sanitize data
    const sanitizedData = sanitizeActivationData(updateData);

    const activation = await prisma.activationRequest.update({
      where: { id },
      data: sanitizedData,
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Activation request updated successfully',
      data: activation
    });

  } catch (error) {
    console.error('Error updating activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update activation request',
      error: error.message 
    });
  }
};

/**
 * Generate PDF for activation request
 * POST /api/activations/:id/generate-pdf
 */
export const generateActivationPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Generate HTML from template
    const htmlContent = generateActivationHTML(activation);

    // Generate PDF
    const pdfBuffer = await generatePDF(htmlContent);

    // Upload to storage
    const fileName = generateFileName(`activation_${activation.requestNumber}`);
    const documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');

    // Update activation with document URL
    const updatedActivation = await prisma.activationRequest.update({
      where: { id },
      data: { documentUrl },
      include: {
        property: true,
        manager: true
      }
    });

    res.json({
      success: true,
      message: 'PDF generated successfully',
      documentUrl,
      activation: updatedActivation
    });

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to generate PDF',
      error: error.message 
    });
  }
};

/**
 * Submit activation request for review
 * POST /api/activations/:id/submit
 */
export const submitActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    if (activation.status !== 'DRAFT') {
      return res.status(400).json({ 
        success: false,
        message: 'Only draft requests can be submitted' 
      });
    }

    // Validate required fields
    const requiredFields = [
      'companyName', 'contactPerson', 'email', 'mobileNo',
      'startDate', 'endDate', 'activationType', 'spaceRequired'
    ];

    const missingFields = requiredFields.filter(field => !activation[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields 
      });
    }

    // Generate PDF if not already generated
    let documentUrl = activation.documentUrl;
    if (!documentUrl) {
      const activationWithRelations = await prisma.activationRequest.findUnique({
        where: { id },
        include: {
          property: {
            include: {
              landlord: true
            }
          },
          manager: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      const htmlContent = generateActivationHTML(activationWithRelations);
      const pdfBuffer = await generatePDF(htmlContent);
      const fileName = generateFileName(`activation_${activation.requestNumber}`);
      documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');
    }

    const updatedActivation = await prisma.activationRequest.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        documentUrl
      },
      include: {
        property: true,
        manager: true
      }
    });

    res.json({
      success: true,
      message: 'Activation request submitted successfully',
      data: updatedActivation
    });

  } catch (error) {
    console.error('Error submitting activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to submit activation request',
      error: error.message 
    });
  }
};

/**
 * Delete activation request
 * DELETE /api/activations/:id
 */
export const deleteActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Only allow deletion of draft or rejected requests
    if (!['DRAFT', 'REJECTED'].includes(activation.status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Only draft or rejected requests can be deleted' 
      });
    }

    await prisma.activationRequest.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Activation request deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete activation request',
      error: error.message 
    });
  }
};

/**
 * Download activation PDF
 * GET /api/activations/:id/download
 */
export const downloadActivationPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Check if documentUrl exists and is accessible
    let pdfBuffer;
    
    if (activation.documentUrl && activation.documentUrl.startsWith('http')) {
      // If we have a stored URL, try to fetch it
      try {
        const response = await fetch(activation.documentUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          pdfBuffer = Buffer.from(arrayBuffer);
        } else {
          // If URL fetch fails, generate fresh PDF
          throw new Error('Stored PDF not accessible');
        }
      } catch (error) {
        console.log('Could not fetch stored PDF, generating fresh one:', error.message);
        // Fall through to generate fresh PDF
      }
    }

    // If no PDF buffer yet (either no documentUrl or fetch failed), generate fresh
    if (!pdfBuffer) {
      const htmlContent = generateActivationHTML(activation);
      pdfBuffer = await generatePDF(htmlContent);
      
      // Optionally update the documentUrl in database
      // Uncomment if you want to store the newly generated PDF
      /*
      const fileName = generateFileName(`activation_${activation.requestNumber}`);
      const documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');
      await prisma.activationRequest.update({
        where: { id },
        data: { documentUrl }
      });
      */
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="activation_${activation.requestNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error downloading activation PDF:', error);
    
    // Don't send JSON when expecting PDF - generate an error PDF or return proper error
    try {
      // Create a simple error message as PDF
      const errorHtml = `
        <html>
          <body>
            <h1>Error Generating PDF</h1>
            <p>${error.message}</p>
          </body>
        </html>
      `;
      const pdfBuffer = await generatePDF(errorHtml);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="error.pdf"');
      res.send(pdfBuffer);
    } catch (pdfError) {
      // If even error PDF fails, send JSON
      res.status(500).json({ 
        success: false,
        message: 'Failed to download activation PDF',
        error: error.message 
      });
    }
  }
};

/**
 * Helper function to generate unique request number
 */
async function generateRequestNumber() {
  const prefix = 'ACT';
  const year = new Date().getFullYear();
  
  // Get count of requests this year
  const count = await prisma.activationRequest.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31 23:59:59`)
      }
    }
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}-${year}-${sequence}`;
}
