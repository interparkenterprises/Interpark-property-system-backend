import prisma from '../lib/prisma.js';
import permissionService from '../services/permissionService.js';
import {
  ASSIGNMENT_STATUSES,
  PERSONNEL_STATUSES,
  PERSONNEL_TYPES,
  ServicePersonnelService,
  SERVICE_CATEGORIES,
  SHIFT_TYPES,
  WEEK_DAYS
} from '../services/servicePersonnel.service.js';

const servicePersonnelService = new ServicePersonnelService(prisma, permissionService);

const respond = (res, data, status = 200) => res.status(status).json({ success: true, data });

const handleError = (res, error) => {
  console.error('Service personnel error:', error);
  return res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : 'Unable to process the service personnel request'
  });
};

export const getServicePersonnelMetadata = async (_req, res) => respond(res, {
  serviceCategories: SERVICE_CATEGORIES,
  personnelTypes: PERSONNEL_TYPES,
  personnelStatuses: PERSONNEL_STATUSES,
  assignmentStatuses: ASSIGNMENT_STATUSES,
  shiftTypes: SHIFT_TYPES,
  weekDays: WEEK_DAYS
});

export const getPropertyServicePersonnel = async (req, res) => {
  try {
    const data = await servicePersonnelService.getPropertyPersonnel(
      req.user,
      req.params.propertyId,
      req.query
    );
    return respond(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getPropertyServicePersonnelOptions = async (req, res) => {
  try {
    const data = await servicePersonnelService.getOptions(req.user, req.params.propertyId);
    return respond(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getServicePersonnel = async (req, res) => {
  try {
    return respond(res, await servicePersonnelService.getPersonnel(req.user, req.params.id));
  } catch (error) {
    return handleError(res, error);
  }
};

export const createServicePersonnel = async (req, res) => {
  try {
    return respond(res, await servicePersonnelService.createPersonnel(req.user, req.body), 201);
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateServicePersonnel = async (req, res) => {
  try {
    return respond(res, await servicePersonnelService.updatePersonnel(req.user, req.params.id, req.body));
  } catch (error) {
    return handleError(res, error);
  }
};

export const createPersonnelAssignment = async (req, res) => {
  try {
    return respond(
      res,
      await servicePersonnelService.createAssignment(req.user, req.params.id, req.body),
      201
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const updatePersonnelAssignment = async (req, res) => {
  try {
    return respond(
      res,
      await servicePersonnelService.updateAssignment(req.user, req.params.assignmentId, req.body)
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const createPersonnelSchedule = async (req, res) => {
  try {
    return respond(
      res,
      await servicePersonnelService.createSchedule(req.user, req.params.assignmentId, req.body),
      201
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const updatePersonnelSchedule = async (req, res) => {
  try {
    return respond(
      res,
      await servicePersonnelService.updateSchedule(req.user, req.params.scheduleId, req.body)
    );
  } catch (error) {
    return handleError(res, error);
  }
};
