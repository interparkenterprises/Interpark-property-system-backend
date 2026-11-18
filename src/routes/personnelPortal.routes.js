import express from 'express';
import { getPersonnelMe } from '../controllers/personnelPortal.controller.js';
import { protectPersonnel } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', protectPersonnel, getPersonnelMe);

export default router;
