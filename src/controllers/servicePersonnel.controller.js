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
import { PersonnelPortalAccessService } from '../services/personnelPortalAccess.service.js';

const servicePersonnelService = new ServicePersonnelService(prisma, permissionService);
const personnelPortalAccessService = new PersonnelPortalAccessService(prisma);

const respond = (res, data, status = 200) => res.status(status).json({ success: true, data });

const respondInvitation = (res, data, successStatus = 200) => {
  if (data.invitation && !data.invitation.delivered) {
    return res.status(502).json({
      success: false,
      message: 'Portal access was prepared, but the invitation email was not delivered. It can be retried safely.',
      data
    });
  }
  return respond(res, data, successStatus);
};

const handleError = (res, error) => {
  console.error('Service personnel error:', error);
  if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
  return res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : 'Unable to process the service personnel request',
    ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
  });
};

const requestMetadata = req => ({
  ipAddress: req.ip || null,
  userAgent: req.get('user-agent') || null
});

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

export const getPersonnelPortalAccess = async (req, res) => {
  try {
    return respond(res, await personnelPortalAccessService.getAccess(req.user, req.params.personnelId));
  } catch (error) {
    return handleError(res, error);
  }
};

export const invitePersonnelPortalAccess = async (req, res) => {
  try {
    return respondInvitation(
      res,
      await personnelPortalAccessService.invite(req.user, req.params.personnelId, requestMetadata(req)),
      201
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const resendPersonnelPortalAccess = async (req, res) => {
  try {
    return respondInvitation(
      res,
      await personnelPortalAccessService.resend(req.user, req.params.personnelId, requestMetadata(req))
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const disablePersonnelPortalAccess = async (req, res) => {
  try {
    return respond(
      res,
      await personnelPortalAccessService.disable(req.user, req.params.personnelId, requestMetadata(req))
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const enablePersonnelPortalAccess = async (req, res) => {
  try {
    return respondInvitation(
      res,
      await personnelPortalAccessService.enable(req.user, req.params.personnelId, requestMetadata(req))
    );
  } catch (error) {
    return handleError(res, error);
  }
};
