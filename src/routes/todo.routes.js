import express from 'express';
import {
  getTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  getTodoStats,
  approveSelfCreatedTask
} from '../controllers/todo.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Routes accessible by all authenticated users
router.route('/')
  .get(getTodos)
  .post(createTodo);

// Stats route - using colon for parameter and handling optional in controller
// Remove the ? - Express will match /stats and /stats/:userId both
router.get('/stats/', getTodoStats);
router.get('/stats/:userId', getTodoStats);

// Manager/Admin only route for approving self-created tasks
router.put('/:id/approve-self-task', authorize('ADMIN', 'MANAGER'), approveSelfCreatedTask);

// Delete route - only admins and managers can delete tasks
router.delete('/:id', authorize('ADMIN', 'MANAGER'), deleteTodo);

// Other ID routes with mixed authorization (handled in controller)
router.route('/:id')
  .get(getTodo)
  .put(updateTodo);

export default router;