import analyticsService from '../services/analytics/analytics.service.js';
import { normalizeAnalyticsFilters } from '../services/analytics/analyticsFilter.service.js';

const execute = serviceMethod => async (req, res, next) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    const result = await analyticsService[serviceMethod](req.user, filters);
    return res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        ...(error.field ? { field: error.field } : {})
      });
    }
    return next(error);
  }
};

// ========== EXISTING METHODS ==========
export const getOverview = execute('getOverview');
export const getReceivablesSummary = execute('getReceivablesSummary');
export const getReceivablesStatusDistribution = execute('getStatusDistribution');
export const getReceivablesTrend = execute('getReceivablesTrend');
export const getCollectionsTrend = execute('getCollectionsTrend');
export const getRevenueByProperty = execute('getRevenueByProperty');
export const getOccupancySummary = execute('getOccupancySummary');
export const getTenantsSummary = execute('getTenantsSummary');
export const getBillInvoiceAnalytics = execute('getBillInvoiceAnalytics');
export const getServiceProviderAnalytics = execute('getServiceProviderAnalytics');
export const getCommissionAnalytics = execute('getCommissionAnalytics');
export const getDemandLetterAnalytics = execute('getDemandLetterAnalytics');
export const getTenantAnalytics = execute('getTenantAnalytics');
export const getOtherIncomeAnalytics = execute('getOtherIncomeAnalytics');
export const getEmployeeAnalytics = execute('getEmployeeAnalytics');

// ========== NEW INVOICE ANALYTICS ==========
export const getComprehensiveInvoiceAnalytics = execute('getComprehensiveInvoiceAnalytics');
export const getRentInvoiceAnalytics = execute('getRentInvoiceAnalytics');
export const getBillInvoiceAnalyticsDetailed = execute('getBillInvoiceAnalyticsDetailed');
export const getInvoiceAgingReport = execute('getInvoiceAgingReport');
export const getInvoiceReconciliationReport = execute('getInvoiceReconciliationReport');

// ========== OTHER NEW ANALYTICS ==========
export const getBillAnalytics = execute('getBillAnalytics');
export const getTenantLifecycleAnalytics = execute('getTenantLifecycleAnalytics');
export const getLeadAnalytics = execute('getLeadAnalytics');
export const getDataQualityAnalytics = execute('getDataQualityAnalytics');
export const getPerformanceAnalytics = execute('getPerformanceAnalytics');
export const getVATAnalytics = execute('getVATAnalytics');