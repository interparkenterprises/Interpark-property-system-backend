import {
  sendDocumentViaWhatsApp,
  downloadAllPaymentReportsBuffer,
  sendBulkDocuments,
  sendAllPaymentReportsViaWhatsApp,
  getDocumentSendStatus,
  getCommunicationLogs,
  handleWebhook,
  verifyWebhookSignature,
  sendBillReportViaWhatsApp,
  downloadBillReportBuffer,
  sendComprehensiveReportViaWhatsApp,
  downloadComprehensiveReportBuffer,
  formatcontactForWhatsApp
} from '../services/whatsappService.js';

import prisma from '../lib/prisma.js';
import permissionService from '../services/permissionService.js';

// ======================================================
// SHARED HELPERS
// ======================================================

/**
 * Resolve a tenant's propertyId (used for permission scoping).
 * Returns null if the tenant or its unit/property cannot be found.
 */
async function getTenantPropertyId(tenantId) {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      fullName: true,
      unit: { select: { propertyId: true } }
    }
  });
  return tenant ? { tenant, propertyId: tenant.unit?.propertyId || null } : null;
}

/**
 * Resolve propertyId for a given document record (invoice, bill invoice,
 * demand letter) so we can scope the send permission.
 */
async function resolveDocumentPropertyId(documentType, documentId) {
  switch (documentType) {
    case 'Invoice':
      return (await prisma.invoice.findUnique({
        where: { id: documentId },
        select: { tenant: { select: { unit: { select: { propertyId: true } } } } }
      }))?.tenant?.unit?.propertyId;

    case 'Bill Invoices':
      return (await prisma.billInvoice.findUnique({
        where: { id: documentId },
        select: { tenant: { select: { unit: { select: { propertyId: true } } } } }
      }))?.tenant?.unit?.propertyId;

    case 'Demand Letter':
      return (await prisma.demandLetter.findUnique({
        where: { id: documentId },
        select: { propertyId: true }
      }))?.propertyId;

    default:
      return null;
  }
}

/**
 * Send a 403 unless the user has the given report-download permission
 * (or is ADMIN / owning MANAGER) for the tenant's property.
 */
async function assertCanDownloadForTenant(req, res, tenantId, operation, friendlyLabel) {
  const resolved = await getTenantPropertyId(tenantId);
  if (!resolved) {
    res.status(404).json({ success: false, message: 'Tenant not found' });
    return false;
  }
  const allowed = await permissionService.canDownloadReportForProperty(
    req.user.id,
    req.user.role,
    resolved.propertyId,
    operation
  );
  if (!allowed) {
    res.status(403).json({
      success: false,
      message: `You do not have permission to download ${friendlyLabel} for this property`
    });
    return false;
  }
  return true;
}

// ======================================================
// SEND DOCUMENT
// ======================================================

/**
 * Send document via WhatsApp
 * POST /api/whatsapp/send-document
 * Required roles: MANAGER, ADMINISTRATOR
 */
export async function sendDocument(req, res, next) {
  try {
    const {
      documentId, documentType, propertyId, managerId, customMessage
    } = req.body;

    if (!documentId || !documentType) {
      return res.status(400).json({
        success: false,
        message: 'documentId and documentType are required'
      });
    }

    // Resolve propertyId from the document so permission scoping works
    // even when the caller omitted it.
    const resolvedPropertyId =
      propertyId || await resolveDocumentPropertyId(documentType, documentId);

    if (resolvedPropertyId) {
      // Sending a document is treated as a "download-ish" capability: it
      // requires the appropriate report-send/download permission for the
      // property. We map documentType -> permission operation.
      const opMap = {
        'Invoice': 'downloadReport',                    // invoice PDF
        'Bill Invoices': 'downloadBillReport',          // bill invoice PDF
        'Demand Letter': 'downloadComprehensiveReport'  // hmm: use send-adjacent perm
      };
      const operation = opMap[documentType] || 'downloadReport';

      const allowed = await permissionService.canDownloadReportForProperty(
        req.user.id,
        req.user.role,
        resolvedPropertyId,
        operation
      );

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: `You do not have permission to send ${documentType} for this property`
        });
      }
    }

    const result = await sendDocumentViaWhatsApp({
      documentId,
      documentType,
      propertyId: resolvedPropertyId,
      managerId: req.user?.id || managerId,
      customMessage
    });
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    next(error);
  }
}

// ======================================================
// PAYMENT REPORT DOWNLOADS / SENDS
// ======================================================

/**
 * Download the combined payment reports PDF directly (no WhatsApp)
 * GET /api/whatsapp/payment-reports/:tenantId/download
 * Requires: DOWNLOAD_PAYMENT_REPORT (per-property scoped)
 */
export async function downloadAllPaymentReports(req, res, next) {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadReport', 'payment reports'
    );
    if (!ok) return;

    const { buffer, tenant } = await downloadAllPaymentReportsBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payment_Reports_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Send ALL payment reports for a tenant as one combined WhatsApp document.
 * POST /api/whatsapp/send-payment-reports/:tenantId
 * Requires: DOWNLOAD_PAYMENT_REPORT (the same permission gates sending,
 * since sending is strictly more consequential than downloading)
 */
export async function sendAllPaymentReports(req, res, next) {
  try {
    const { tenantId } = req.params;
    const { customMessage } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadReport', 'payment reports'
    );
    if (!ok) return;

    const result = await sendAllPaymentReportsViaWhatsApp({
      tenantId,
      customMessage,
      managerId: req.user?.id
    });

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

// ======================================================
// BILL REPORT DOWNLOADS / SENDS
// ======================================================

/**
 * Download bill report PDF
 * GET /api/whatsapp/bill-report/:tenantId/download
 * Requires: DOWNLOAD_BILL_REPORT
 */
export async function downloadBillReport(req, res, next) {
  try {
    const { tenantId } = req.params;

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadBillReport', 'bill reports'
    );
    if (!ok) return;

    const { buffer, tenant } = await downloadBillReportBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill_Report_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

/**
 * Send bill report via WhatsApp
 * POST /api/whatsapp/send-bill-report/:tenantId
 * Requires: DOWNLOAD_BILL_REPORT
 */
export async function sendBillReport(req, res, next) {
  try {
    const { tenantId } = req.params;

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadBillReport', 'bill reports'
    );
    if (!ok) return;

    const result = await sendBillReportViaWhatsApp({
      tenantId,
      customMessage: req.body?.customMessage,
      managerId: req.user?.id
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

// ======================================================
// COMPREHENSIVE REPORT DOWNLOADS / SENDS
// ======================================================

/**
 * Download comprehensive report PDF
 * GET /api/whatsapp/comprehensive-report/:tenantId/download
 * Requires: DOWNLOAD_COMPREHENSIVE_REPORT
 */
export async function downloadComprehensiveReport(req, res, next) {
  try {
    const { tenantId } = req.params;

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadComprehensiveReport', 'comprehensive reports'
    );
    if (!ok) return;

    const { buffer, tenant } = await downloadComprehensiveReportBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Comprehensive_Report_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

/**
 * Send comprehensive report via WhatsApp
 * POST /api/whatsapp/send-comprehensive-report/:tenantId
 * Requires: DOWNLOAD_COMPREHENSIVE_REPORT
 */
export async function sendComprehensiveReport(req, res, next) {
  try {
    const { tenantId } = req.params;

    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadComprehensiveReport', 'comprehensive reports'
    );
    if (!ok) return;

    const result = await sendComprehensiveReportViaWhatsApp({
      tenantId,
      customMessage: req.body?.customMessage,
      managerId: req.user?.id
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

// ======================================================
// BULK SEND
// ======================================================

/**
 * Send documents in bulk
 * POST /api/whatsapp/bulk-send
 * Required roles: ADMINISTRATOR
 *
 * For each document, resolves its tenant's propertyId and checks the
 * matching send/download permission. Documents the caller can't access
 * are skipped (with a per-document error) rather than failing the batch.
 */
export async function bulkSendDocuments(req, res, next) {
  try {
    const { documents } = req.body;

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'documents array is required and must not be empty'
      });
    }

    for (const doc of documents) {
      if (!doc.documentId || !doc.documentType) {
        return res.status(400).json({
          success: false,
          message: 'Each document must have documentId and documentType'
        });
      }
    }

    // Filter to documents the caller is allowed to send
    const allowedDocuments = [];
    const skipped = [];

    for (const doc of documents) {
      const propertyId = await resolveDocumentPropertyId(doc.documentType, doc.documentId);
      const opMap = {
        'Invoice': 'downloadReport',
        'Bill Invoices': 'downloadBillReport',
        'Demand Letter': 'downloadComprehensiveReport'
      };
      const operation = opMap[doc.documentType] || 'downloadReport';

      const allowed = propertyId
        ? await permissionService.canDownloadReportForProperty(
            req.user.id, req.user.role, propertyId, operation
          )
        : false;

      if (allowed) {
        allowedDocuments.push({ ...doc, propertyId });
      } else {
        skipped.push({
          documentId: doc.documentId,
          documentType: doc.documentType,
          reason: 'No permission for this property'
        });
      }
    }

    const result = allowedDocuments.length > 0
      ? await sendBulkDocuments(allowedDocuments)
      : { total: 0, successCount: 0, failedCount: 0, results: { success: [], failed: [] } };

    return res.status(200).json({
      success: true,
      ...result,
      skipped
    });
  } catch (error) {
    next(error);
  }
}

// ======================================================
// STATUS / LOGS
// ======================================================

/**
 * Get document send status for a tenant
 * GET /api/whatsapp/status/:tenantId
 */
export async function getSendStatus(req, res, next) {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenantId is required'
      });
    }

    // Reuse the report-download permission to gate reading send history.
    // (You can add a dedicated VIEW_WHATSAPP_LOGS permission later if you
    // want finer granularity.)
    const ok = await assertCanDownloadForTenant(
      req, res, tenantId, 'downloadReport', 'WhatsApp send history'
    );
    if (!ok) return;

    const status = await getDocumentSendStatus(tenantId);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}

/**
 * Get WhatsApp communication logs
 * GET /api/whatsapp/logs
 */
export async function getLogs(req, res, next) {
  try {
    const filters = {
      tenantId: req.query.tenantId,
      propertyId: req.query.propertyId,
      documentType: req.query.documentType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      managerId: req.query.managerId,
      limit: req.query.limit || 100,
      page: req.query.page || 1
    };

    // If a specific tenant is requested, enforce per-property access
    if (filters.tenantId) {
      const ok = await assertCanDownloadForTenant(
        req, res, filters.tenantId, 'downloadReport', 'WhatsApp logs'
      );
      if (!ok) return;
    }

    const result = await getCommunicationLogs(filters);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single WhatsApp log details
 * GET /api/whatsapp/logs/:id
 */
export async function getLogDetails(req, res, next) {
  try {
    const { id } = req.params;

    const log = await prisma.whatsAppLog.findUnique({
      where: { id },
      include: {
        tenant: {
          select: { id: true, fullName: true, contact: true, email: true }
        },
        property: {
          select: { id: true, name: true, address: true }
        }
      }
    });

    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }

    // Enforce access to the log's property
    if (log.propertyId) {
      const allowed = await permissionService.canDownloadReportForProperty(
        req.user.id, req.user.role, log.propertyId, 'downloadReport'
      );
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this log'
        });
      }
    }

    return res.status(200).json({ success: true, data: log });
  } catch (error) {
    next(error);
  }
}

// ======================================================
// WEBHOOK
// ======================================================

/**
 * Handle WhatsApp webhook
 * POST /api/whatsapp/webhook
 * Public endpoint (with verification)
 */
export async function webhookHandler(req, res, next) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  res.sendStatus(200);

  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('Rejected WhatsApp webhook: invalid signature');
      return;
    }
    await handleWebhook({ body: req.body });
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
}

// ======================================================
// LOG MAINTENANCE
// ======================================================

/**
 * Update WhatsApp log status manually
 * PATCH /api/whatsapp/logs/:id/status
 * Required roles: ADMINISTRATOR
 */
export async function updateLogStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, errorMessage } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    const validStatuses = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const log = await prisma.whatsAppLog.update({
      where: { id },
      data: { status, errorMessage, updatedAt: new Date() }
    });

    return res.status(200).json({ success: true, data: log });
  } catch (error) {
    next(error);
  }
}

/**
 * Resend a document
 * POST /api/whatsapp/resend/:logId
 */
export async function resendDocument(req, res, next) {
  try {
    const { logId } = req.params;
    const { customMessage } = req.body;

    const log = await prisma.whatsAppLog.findUnique({ where: { id: logId } });
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }

    // Enforce send permission for the log's property
    if (log.propertyId) {
      const opMap = {
        'Invoice': 'downloadReport',
        'Bill Invoices': 'downloadBillReport',
        'Demand Letter': 'downloadComprehensiveReport',
        'All Payment Reports': 'downloadReport',
        'Bill Report': 'downloadBillReport',
        'Full Report': 'downloadComprehensiveReport'
      };
      const operation = opMap[log.documentType] || 'downloadReport';

      const allowed = await permissionService.canDownloadReportForProperty(
        req.user.id, req.user.role, log.propertyId, operation
      );
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to resend this document'
        });
      }
    }

    const result = await sendDocumentViaWhatsApp({
      documentId: log.documentId,
      documentType: log.documentType,
      propertyId: log.propertyId,
      managerId: req.user?.id,
      customMessage
    });

    if (result.success) {
      await prisma.whatsAppLog.update({
        where: { id: logId },
        data: { status: 'resent', updatedAt: new Date() }
      });
    }

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export default {
  sendDocument,
  downloadAllPaymentReports,
  bulkSendDocuments,
  getSendStatus,
  getLogs,
  getLogDetails,
  webhookHandler,
  updateLogStatus,
  sendAllPaymentReports,
  downloadComprehensiveReport,
  sendComprehensiveReport,
  downloadBillReport,
  sendBillReport,
  resendDocument
};