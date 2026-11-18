import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { personnelInvitationResendRateLimit } from '../middleware/personnelAuthRateLimits.js';
import {
  createPersonnelAssignment,
  createPersonnelSchedule,
  createServicePersonnel,
  disablePersonnelPortalAccess,
  enablePersonnelPortalAccess,
  getPropertyServicePersonnel,
  getPropertyServicePersonnelOptions,
  getServicePersonnel,
  getServicePersonnelMetadata,
  getPersonnelPortalAccess,
  invitePersonnelPortalAccess,
  resendPersonnelPortalAccess,
  updatePersonnelAssignment,
  updatePersonnelSchedule,
  updateServicePersonnel
} from '../controllers/servicePersonnel.controller.js';

const router = express.Router();

router.use(protect);
router.use(authorize('ADMIN', 'MANAGER', 'USER'));

router.get('/metadata', getServicePersonnelMetadata);
router.get('/property/:propertyId', getPropertyServicePersonnel);
router.get('/property/:propertyId/options', getPropertyServicePersonnelOptions);
router.post('/', createServicePersonnel);
router.patch('/assignments/:assignmentId', updatePersonnelAssignment);
router.post('/assignments/:assignmentId/schedules', createPersonnelSchedule);
router.patch('/schedules/:scheduleId', updatePersonnelSchedule);
router.get('/:personnelId/portal-access', authorize('ADMIN', 'MANAGER'), getPersonnelPortalAccess);
router.post('/:personnelId/portal-access/invite', authorize('ADMIN', 'MANAGER'), invitePersonnelPortalAccess);
router.post('/:personnelId/portal-access/resend', personnelInvitationResendRateLimit, authorize('ADMIN', 'MANAGER'), resendPersonnelPortalAccess);
router.post('/:personnelId/portal-access/disable', authorize('ADMIN', 'MANAGER'), disablePersonnelPortalAccess);
router.post('/:personnelId/portal-access/enable', authorize('ADMIN', 'MANAGER'), enablePersonnelPortalAccess);
router.get('/:id', getServicePersonnel);
router.patch('/:id', updateServicePersonnel);
router.post('/:id/assignments', createPersonnelAssignment);

export default router;
