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

export const getOverview = execute('getOverview');
export const getReceivablesSummary = execute('getReceivablesSummary');
export const getReceivablesStatusDistribution = execute('getStatusDistribution');
export const getReceivablesTrend = execute('getReceivablesTrend');
export const getCollectionsTrend = execute('getCollectionsTrend');
export const getRevenueByProperty = execute('getRevenueByProperty');
export const getOccupancySummary = execute('getOccupancySummary');
export const getTenantsSummary = execute('getTenantsSummary');
