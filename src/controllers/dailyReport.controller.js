import { PrismaClient } from '@prisma/client';
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { DailyReportHelper } from '../utils/dailyReportHelper.js';

const prisma = new PrismaClient();

export class DailyReportController {
  // Create daily report with PDF generation
  async createReport(req, res) {
    try {
      const { propertyId, reportDate, ...reportData } = req.body;
      const managerId = req.user.id;

      // 1. Check if user has permission for this property
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        include: {
          manager: true,
          landlord: true
        }
      });

      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      }

      // Check if manager has access to this property
      if (req.user.role === 'MANAGER' && property.managerId !== managerId) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create reports for this property'
        });
      }

      // 2. Check if report already exists for this date
      const startOfDay = new Date(reportDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(reportDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingReport = await prisma.dailyReport.findFirst({
        where: {
          propertyId,
          reportDate: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      });

      if (existingReport) {
        return res.status(400).json({
          success: false,
          message: 'A report already exists for this date'
        });
      }

      // 3. Extract day from reportDate
      const reportDateObj = new Date(reportDate);
      const day = reportDateObj.toLocaleDateString('en-US', { weekday: 'long' });

      // 4. Prepare report data for initial creation
      const initialReportData = {
        propertyId,
        managerId,
        reportDate: reportDateObj,
        preparedBy: req.user.name,
        timeSubmitted: new Date(),
        status: 'DRAFT',
        day: day,
        ...DailyReportHelper.prepareReportData(reportData)
      };

      // 5. Create the report first (without PDF)
      const report = await prisma.dailyReport.create({
        data: initialReportData,
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
              email: true,
              role: true
            }
          }
        }
      });

      // 6. Generate PDF
      const pdfBuffer = await DailyReportHelper.generateReportPDF(report);
      
      // 7. Upload PDF to storage
      const fileName = generateFileName(`daily_report_${property.name.replace(/\s+/g, '_')}_${reportDateObj.getTime()}`);
      const pdfUrl = await uploadToStorage(pdfBuffer, fileName, 'reports');

      // 8. Create attachment object
      const attachment = {
        type: 'PDF',
        fileName,
        fileUrl: pdfUrl,
        uploadedAt: new Date(),
        isPrimary: true
      };

      // 9. Update report with attachment
      const updatedReport = await prisma.dailyReport.update({
        where: { id: report.id },
        data: {
          attachments: [attachment]
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
              email: true,
              role: true
            }
          }
        }
      });

      // Add PDF URL to the response for backward compatibility
      updatedReport.pdfUrl = pdfUrl;

      res.status(201).json({
        success: true,
        message: 'Daily report created successfully',
        data: updatedReport
      });

    } catch (error) {
      console.error('Error creating daily report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create daily report',
        error: error.message
      });
    }
  }

  // Get report by ID with PDF generation option
  async getReport(req, res) {
    try {
      const { id } = req.params;
      const { includePdf } = req.query;

      const report = await prisma.dailyReport.findUnique({
        where: { id },
        include: {
          property: {
            include: {
              landlord: true,
              manager: true
            }
          },
          manager: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        }
      });

      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check permissions
      if (req.user.role === 'MANAGER' && report.managerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this report'
        });
      }

      // If PDF is requested, generate it
      if (includePdf === 'true') {
        const pdfBuffer = await DailyReportHelper.generateReportPDF(report);
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="daily_report_${report.id}.pdf"`
        });
        return res.send(pdfBuffer);
      }

      res.status(200).json({
        success: true,
        data: report
      });

    } catch (error) {
      console.error('Error getting report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get report',
        error: error.message
      });
    }
  }

  // Update report
  async updateReport(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user.id;

      // Check if report exists
      const existingReport = await prisma.dailyReport.findUnique({
        where: { id },
        include: {
          property: true
        }
      });

      if (!existingReport) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check permissions
      if (req.user.role === 'MANAGER') {
        if (existingReport.managerId !== userId) {
          return res.status(403).json({
            success: false,
            message: 'You can only update your own reports'
          });
        }

        // Managers can only update DRAFT reports
        if (existingReport.status !== 'DRAFT') {
          return res.status(400).json({
            success: false,
            message: 'Only DRAFT reports can be updated'
          });
        }
      }

      // Prepare update data
      const preparedData = DailyReportHelper.prepareReportData(updateData);
      
      // If reportDate is being updated, update day field as well
      if (updateData.reportDate) {
        const reportDateObj = new Date(updateData.reportDate);
        preparedData.day = reportDateObj.toLocaleDateString('en-US', { weekday: 'long' });
        preparedData.reportDate = reportDateObj;
      }

      // Update report
      const updatedReport = await prisma.dailyReport.update({
        where: { id },
        data: {
          ...preparedData,
          updatedAt: new Date()
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
              email: true,
              role: true
            }
          }
        }
      });

      // Regenerate PDF if needed
      if (Object.keys(updateData).length > 0) {
        // Generate PDF
        const pdfBuffer = await DailyReportHelper.generateReportPDF(updatedReport);
        
        // Upload PDF to storage
        const fileName = generateFileName(`daily_report_updated_${existingReport.property.name.replace(/\s+/g, '_')}_${new Date().getTime()}`);
        const pdfUrl = await uploadToStorage(pdfBuffer, fileName, 'reports');

        // Get existing attachments or create new array
        const reportWithAttachments = await prisma.dailyReport.findUnique({
          where: { id },
          select: { attachments: true }
        });

        const existingAttachments = reportWithAttachments?.attachments || [];
        
        // Create new attachment object
        const newAttachment = {
          type: 'PDF',
          fileName,
          fileUrl: pdfUrl,
          uploadedAt: new Date(),
          version: 'updated',
          isPrimary: false
        };

        // Update with new attachments array
        await prisma.dailyReport.update({
          where: { id },
          data: {
            attachments: [...existingAttachments, newAttachment]
          }
        });

        // Add PDF URL to the response
        updatedReport.pdfUrl = pdfUrl;
      }

      res.status(200).json({
        success: true,
        message: 'Report updated successfully',
        data: updatedReport
      });

    } catch (error) {
      console.error('Error updating report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update report',
        error: error.message
      });
    }
  }

  // Submit report
  async submitReport(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existingReport = await prisma.dailyReport.findUnique({
        where: { id }
      });

      if (!existingReport) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check if user is the report owner
      if (existingReport.managerId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only submit your own reports'
        });
      }

      // Check if report is in DRAFT status
      if (existingReport.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Only DRAFT reports can be submitted'
        });
      }

      // Update only status and updatedAt (no submittedAt field in your model)
      const submittedReport = await prisma.dailyReport.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          updatedAt: new Date()
        }
      });

      res.status(200).json({
        success: true,
        message: 'Report submitted successfully',
        data: submittedReport
      });

    } catch (error) {
      console.error('Error submitting report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit report',
        error: error.message
      });
    }
  }

  // Get reports by property
  async getReportsByProperty(req, res) {
    try {
      const { propertyId } = req.params;
      const { startDate, endDate, status } = req.query;

      // Check if user has access to this property
      if (req.user.role === 'MANAGER') {
        const property = await prisma.property.findUnique({
          where: { id: propertyId }
        });

        if (!property || property.managerId !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view reports for this property'
          });
        }
      }

      const where = {
        propertyId
      };

      if (startDate && endDate) {
        where.reportDate = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      if (status) {
        where.status = status;
      }

      const reports = await prisma.dailyReport.findMany({
        where,
        orderBy: {
          reportDate: 'desc'
        },
        include: {
          manager: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      res.status(200).json({
        success: true,
        count: reports.length,
        data: reports
      });

    } catch (error) {
      console.error('Error getting property reports:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get property reports',
        error: error.message
      });
    }
  }

  // Delete report
  async deleteReport(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existingReport = await prisma.dailyReport.findUnique({
        where: { id }
      });

      if (!existingReport) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check permissions
      if (req.user.role === 'MANAGER') {
        if (existingReport.managerId !== userId) {
          return res.status(403).json({
            success: false,
            message: 'You can only delete your own reports'
          });
        }

        // Managers can only delete DRAFT reports
        if (existingReport.status !== 'DRAFT') {
          return res.status(400).json({
            success: false,
            message: 'Only DRAFT reports can be deleted'
          });
        }
      }

      await prisma.dailyReport.delete({
        where: { id }
      });

      res.status(200).json({
        success: true,
        message: 'Report deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete report',
        error: error.message
      });
    }
  }

  // Download report PDF
  async downloadReportPDF(req, res) {
    try {
      const { id } = req.params;

      const report = await prisma.dailyReport.findUnique({
        where: { id },
        include: {
          property: {
            include: {
              landlord: true
            }
          }
        }
      });

      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check permissions
      if (req.user.role === 'MANAGER' && report.managerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download this report'
        });
      }

      // Generate PDF
      const pdfBuffer = await DailyReportHelper.generateReportPDF(report);

      // Set response headers
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="daily_report_${report.property.name.replace(/\s+/g, '_')}_${report.reportDate.toISOString().split('T')[0]}.pdf"`,
        'Content-Length': pdfBuffer.length
      });

      res.send(pdfBuffer);

    } catch (error) {
      console.error('Error downloading report PDF:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download report PDF',
        error: error.message
      });
    }
  }

  // Get all reports (admin only)
  async getAllReports(req, res) {
    try {
      const { startDate, endDate, status, propertyId, managerId } = req.query;

      // Check if user is admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can view all reports'
        });
      }

      const where = {};

      if (startDate && endDate) {
        where.reportDate = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      if (status) {
        where.status = status;
      }

      if (propertyId) {
        where.propertyId = propertyId;
      }

      if (managerId) {
        where.managerId = managerId;
      }

      const reports = await prisma.dailyReport.findMany({
        where,
        orderBy: {
          reportDate: 'desc'
        },
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
        }
      });

      res.status(200).json({
        success: true,
        count: reports.length,
        data: reports
      });

    } catch (error) {
      console.error('Error getting all reports:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get reports',
        error: error.message
      });
    }
  }

  // Review report (approve/reject - admin only)
  async reviewReport(req, res) {
    try {
      const { id } = req.params;
      const { action, comments } = req.body;
      const reviewerId = req.user.id;

      // Check if user is admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can review reports'
        });
      }

      const existingReport = await prisma.dailyReport.findUnique({
        where: { id }
      });

      if (!existingReport) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      if (existingReport.status !== 'SUBMITTED') {
        return res.status(400).json({
          success: false,
          message: 'Only SUBMITTED reports can be reviewed'
        });
      }

      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      const reviewedReport = await prisma.dailyReport.update({
        where: { id },
        data: {
          status: newStatus,
          reviewedBy: reviewerId,
          reviewComments: comments,
          updatedAt: new Date()
        },
        include: {
          property: {
            include: {
              landlord: true
            }
          }
        }
      });

      res.status(200).json({
        success: true,
        message: `Report ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully`,
        data: reviewedReport
      });

    } catch (error) {
      console.error('Error reviewing report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to review report',
        error: error.message
      });
    }
  }
}

export default new DailyReportController();