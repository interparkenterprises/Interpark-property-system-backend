import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  createPersonnelAssignment,
  createPersonnelSchedule,
  createServicePersonnel,
  getPropertyServicePersonnel,
  getPropertyServicePersonnelOptions,
  getServicePersonnel,
  getServicePersonnelMetadata,
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
router.get('/:id', getServicePersonnel);
router.patch('/:id', updateServicePersonnel);
router.post('/:id/assignments', createPersonnelAssignment);

export default router;
