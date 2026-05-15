import express from 'express';
import {
  getLeads,
  getLead,
  createLead,
  createLeadWithOffer,
  updateLead,
  deleteLead
} from '../controllers/lead.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ======================================================
// LEAD ROUTES WITH PERMISSION CHECKS
// ======================================================

// GET /api/leads - View all leads
// POST /api/leads - Create new lead
router.route('/')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getLeads
  )
  .post(
    authorize('ADMIN', 'MANAGER', 'USER'),
    createLead
  );

// POST /api/leads/with-offer - Create lead with offer letter
router.post(
  '/with-offer',
  authorize('ADMIN', 'MANAGER', 'USER'),
  createLeadWithOffer
);

// GET /api/leads/:id - Get single lead
// PUT /api/leads/:id - Update lead
// DELETE /api/leads/:id - Delete lead
router.route('/:id')
  .get(
    authorize('ADMIN', 'MANAGER', 'USER'),
    getLead
  )
  .put(
    authorize('ADMIN', 'MANAGER', 'USER'),
    updateLead
  )
  .delete(
    authorize('ADMIN', 'MANAGER', 'USER'),
    deleteLead
  );

export default router;