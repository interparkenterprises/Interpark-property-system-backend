import express from 'express';
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead
} from '../controllers/lead.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getLeads)
  .post(authorize('ADMIN', 'MANAGER'), createLead);

router.route('/:id')
  .get(getLead)
  .put(authorize('ADMIN', 'MANAGER'), updateLead)
  .delete(authorize('ADMIN', 'MANAGER'), deleteLead);

export default router;