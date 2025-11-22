import express from 'express';
import {
  getNews,
  getNewsItem,
  createNews,
  updateNews,
  deleteNews
} from '../controllers/news.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getNews)
  .post(authorize('ADMIN'), createNews);

router.route('/:id')
  .get(getNewsItem)
  .put(authorize('ADMIN'), updateNews)
  .delete(authorize('ADMIN'), deleteNews);

export default router;