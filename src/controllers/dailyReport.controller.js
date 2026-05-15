import prisma from "../lib/prisma.js";
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { DailyReportHelper } from '../utils/dailyReportHelper.js';
import permissionService from "../services/permissionService.js";

export class DailyReportController {
  // Create daily report with PDF generation
  async createReport(req, res) {
    try {
      const { propertyId, reportDate, ...reportData } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 1. Check if property exists
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

      // 2. Use permission service for access check
      let hasAccess = false;

      if (userRole === 'ADMIN') {
        hasAccess = true;
      } else {
        // Check general CREATE_DAILY_REPORTS permission
        const canCreateReport = await permissionService.checkPermission(
          userId, 
          'report', 
          'create', 
          propertyId
        );
        
        if (canCreateReport) {
          hasAccess = true;
        } else {
          // Fallback: Check if user is the property manager
          hasAccess = property.managerId === userId;
        }
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to create reports for this property'
        });
      }

      // 3. Check if report already exists for this date
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

      // 4. Extract day from reportDate
      const reportDateObj = new Date(reportDate);
      const day = reportDateObj.toLocaleDateString('en-US', { weekday: 'long' });

      // 5. Prepare report data for initial creation
      const initialReportData = {
        propertyId,
        managerId: userRole === 'MANAGER' ? userId : (property.managerId || userId),
        reportDate: reportDateObj,
        preparedBy: req.user.name,
        timeSubmitted: new Date(),
        status: 'DRAFT',
        day: day,
        ...DailyReportHelper.prepareReportData(reportData)
      };

      // 6. Create the report first (without PDF)
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

      // 7. Generate PDF
      const pdfBuffer = await DailyReportHelper.generateReportPDF(report);
      
      // 8. Upload PDF to storage
      const fileName = generateFileName(`daily_report_${property.name.replace(/\s+/g, '_')}_${reportDateObj.getTime()}`);
      const pdfUrl = await uploadToStorage(pdfBuffer, fileName, 'reports');

      // 9. Create attachment object
      const attachment = {
        type: 'PDF',
        fileName,
        fileUrl: pdfUrl,
        uploadedAt: new Date(),
        isPrimary: true
      };

      // 10. Update report with attachment
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
      const userId = req.user.id;

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

      // Use permission service for access check
      const hasAccess = await permissionService.checkPermission(
        userId, 
        'report', 
        'view', 
        report.propertyId
      );

      if (!hasAccess) {
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
      const userRole = req.user.role;

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

      // Use permission service for access check
      let hasAccess = false;

      if (userRole === 'ADMIN') {
        hasAccess = true;
      } else {
        // Check EDIT_DAILY_REPORTS permission
        hasAccess = await permissionService.checkPermission(
          userId, 
          'report', 
          'edit', 
          existingReport.propertyId
        );
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this report'
        });
      }

      // Non-admin users can only update DRAFT reports
      if (userRole !== 'ADMIN' && existingReport.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Only DRAFT reports can be updated'
        });
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
      const userRole = req.user.role;

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

      // Use permission service for access check
      let hasAccess = false;

      if (userRole === 'ADMIN') {
        hasAccess = true;
      } else {
        // Check SUBMIT_DAILY_REPORTS permission
        hasAccess = await permissionService.checkPermission(
          userId, 
          'report', 
          'submit', 
          existingReport.propertyId
        );
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to submit this report'
        });
      }

      // Check if report is in DRAFT status
      if (existingReport.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Only DRAFT reports can be submitted'
        });
      }

      // Update only status and updatedAt
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
      const userId = req.user.id;

      // Use permission service to check if user has access to this property
      const hasAccess = await permissionService.checkPropertyAccess(
        userId, 
        propertyId, 
        'canView'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view reports for this property'
        });
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

  // Get all reports by manager (for managers to see their team's reports)
  async getReportsByManager(req, res) {
    try {
      const { startDate, endDate, status, propertyId } = req.query;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Check permission for viewing reports by manager
      let hasPermission = false;
      
      if (userRole === 'ADMIN') {
        hasPermission = true;
      } else if (userRole === 'MANAGER') {
        hasPermission = await permissionService.checkPermission(
          userId, 
          'report', 
          'view'
        );
      }

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view reports by manager'
        });
      }

      let managerId = userId;
      
      // Admin can specify a different manager
      if (userRole === 'ADMIN' && req.query.managerId) {
        managerId = req.query.managerId;
      }

      const where = {
        managerId
      };

      if (propertyId) {
        where.propertyId = propertyId;
      }

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
      console.error('Error getting manager reports:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get manager reports',
        error: error.message
      });
    }
  }

  // Delete report
  async deleteReport(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

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

      // Use permission service for access check
      let hasAccess = false;

      if (userRole === 'ADMIN') {
        hasAccess = true;
      } else {
        // Check DELETE_DAILY_REPORTS permission
        hasAccess = await permissionService.checkPermission(
          userId, 
          'report', 
          'delete', 
          existingReport.propertyId
        );
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this report'
        });
      }

      // Non-admin users can only delete DRAFT reports
      if (userRole !== 'ADMIN' && existingReport.status !== 'DRAFT') {
        return res.status(400).json({
          success: false,
          message: 'Only DRAFT reports can be deleted'
        });
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
      const userId = req.user.id;

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

      // Use permission service for access check
      const hasAccess = await permissionService.checkPermission(
        userId, 
        'report', 
        'view', 
        report.propertyId
      );

      if (!hasAccess) {
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
      const userId = req.user.id;
      const userRole = req.user.role;

      // Check if user has VIEW_DAILY_REPORTS permission
      const hasPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_DAILY_REPORTS'
      );

      if (!hasPermission && userRole !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view all reports'
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

  // Review report (approve/reject)
  async reviewReport(req, res) {
    try {
      const { id } = req.params;
      const { action, comments } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      const existingReport = await prisma.dailyReport.findUnique({
        where: { id },
        include: {
          property: true,
          manager: true
        }
      });

      if (!existingReport) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Check if user has APPROVE_DAILY_REPORTS permission
      let hasPermission = false;
      
      if (userRole === 'ADMIN') {
        hasPermission = true;
      } else {
        hasPermission = await permissionService.checkPermission(
          userId, 
          'report', 
          'approve', 
          existingReport.propertyId
        );
      }

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators or users with approval permission can review reports'
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
          reviewedBy: userId,
          reviewComments: comments,
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

  // Get reports by managed user (for managed users to see their reports)
  async getMyReports(req, res) {
    try {
      const { startDate, endDate, status, propertyId } = req.query;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Check if user has VIEW_DAILY_REPORTS permission
      const hasViewPermission = await permissionService.hasPermission(
        userId, 
        'VIEW_DAILY_REPORTS'
      );

      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view reports'
        });
      }

      // Get all properties the user has access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);

      if (accessiblePropertyIds.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          data: []
        });
      }

      const where = {
        propertyId: {
          in: accessiblePropertyIds
        }
      };

      if (propertyId) {
        // Verify user has access to this specific property
        const hasAccess = accessiblePropertyIds.includes(propertyId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to this property'
          });
        }
        where.propertyId = propertyId;
      }

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
      console.error('Error getting my reports:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get reports',
        error: error.message
      });
    }
  }
}

export default new DailyReportController();