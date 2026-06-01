import prisma from '../lib/prisma.js';
import pkg from '@prisma/client';

const { ToDoStatus, TaskPriority } = pkg;

// Helper function to check if user is a manager of the target user
const isManagerOfUser = async (managerId, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdByManagerId: true }
  });
  return user?.createdByManagerId === managerId;
};

// Helper function to update overdue tasks
const updateOverdueTasks = async () => {
  const now = new Date();
  await prisma.toDo.updateMany({
    where: {
      dueDate: { lt: now },
      status: { in: [ToDoStatus.PENDING, ToDoStatus.IN_PROGRESS] },
      NOT: { dueDate: null }
    },
    data: { status: ToDoStatus.OVERDUE }
  });
};

// @desc    Get all todos for current user (with manager view)
// @route   GET /api/todos
// @access  Private
export const getTodos = async (req, res) => {
  try {
    await updateOverdueTasks();
    
    const { status, priority, userId } = req.query;
    
    // Determine who we're fetching tasks for
    let targetUserId = req.user.id;
    let includeAssignedByMe = false;
    
    // Admin or Manager requesting specific user's tasks
    if (userId && (req.user.role === 'ADMIN' || req.user.role === 'MANAGER')) {
      if (req.user.role === 'MANAGER') {
        const isManager = await isManagerOfUser(req.user.id, userId);
        if (!isManager) {
          return res.status(403).json({ message: 'Not authorized to view these tasks' });
        }
      }
      targetUserId = userId;
    }
    // Manager viewing without specific userId - include tasks they assigned
    else if (req.user.role === 'MANAGER' && !userId) {
      includeAssignedByMe = true;
    }
    
    // Build the where clause
    let where = {};
    
    if (includeAssignedByMe) {
      where = {
        OR: [
          { userId: targetUserId },
          { assignedById: req.user.id }
        ]
      };
    } else {
      where.userId = targetUserId;
    }
    
    // Apply status filter
    if (status) {
      if (where.OR) {
        where.OR = where.OR.map(condition => ({ ...condition, status }));
      } else {
        where.status = status;
      }
    }
    
    // Apply priority filter
    if (priority) {
      if (where.OR) {
        where.OR = where.OR.map(condition => ({ ...condition, priority }));
      } else {
        where.priority = priority;
      }
    }
    
    const todos = await prisma.toDo.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    res.json(todos);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
// @desc    Get single todo with permission checks
// @route   GET /api/todos/:id
// @access  Private
export const getTodo = async (req, res) => {
  try {
    const todo = await prisma.toDo.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } }
      }
    });

    if (!todo) {
      return res.status(404).json({ message: 'Todo not found' });
    }

    // Check authorization
    const isOwner = todo.userId === req.user.id;
    const isAssigner = todo.assignedById === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    const isManagerOfTargetUser = req.user.role === 'MANAGER' && await isManagerOfUser(req.user.id, todo.userId);

    if (!isOwner && !isAssigner && !isAdmin && !isManagerOfTargetUser) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(todo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create todo (Manager assigns to user OR User creates for self)
// @route   POST /api/todos
// @access  Private
export const createTodo = async (req, res) => {
  try {
    const { 
      title, 
      description, 
      dueDate, 
      priority,
      assignedUserId // For managers assigning tasks
    } = req.body;

    let targetUserId = req.user.id;
    let isSelfCreated = true;
    let requiresApproval = false;
    let assignedById = null;
    
    // If assigning to another user (manager only)
    if (assignedUserId && assignedUserId !== req.user.id) {
      // Check if user is manager or admin
      if (req.user.role !== 'MANAGER' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Only managers can assign tasks to other users' });
      }
      
      // Verify manager has authority over this user
      if (req.user.role === 'MANAGER') {
        const hasManagerAccess = await isManagerOfUser(req.user.id, assignedUserId);
        if (!hasManagerAccess) {
          return res.status(403).json({ message: 'You can only assign tasks to users you manage' });
        }
      }
      
      targetUserId = assignedUserId;
      isSelfCreated = false;
      assignedById = req.user.id;
      requiresApproval = false; // Manager-assigned tasks don't need approval
    } 
    // User creating task for themselves
    else {
      // Self-created tasks need manager approval
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, createdByManagerId: true }
      });
      
      // Regular users (non-managers, non-admins) need approval for self-created tasks
      if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
        requiresApproval = true;
        isSelfCreated = true;
      }
    }
    
    const todo = await prisma.toDo.create({
      data: {
        userId: targetUserId,
        title,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: priority || TaskPriority.MEDIUM,
        status: requiresApproval ? ToDoStatus.PENDING_APPROVAL : ToDoStatus.PENDING,
        isSelfCreated,
        requiresApproval,
        assignedById
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } }
      }
    });
    
    // If requires approval, notify manager (you can implement email/notification here)
    
    res.status(201).json(todo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update todo
// @route   PUT /api/todos/:id
// @access  Private
export const updateTodo = async (req, res) => {
  try {
    const { title, description, status, dueDate, priority, completionNotes, rejectionReason } = req.body;
    
    const existingTodo = await prisma.toDo.findUnique({
      where: { id: req.params.id },
      include: { user: true }
    });
    
    if (!existingTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }
    
    // Check authorization
    const isOwner = existingTodo.userId === req.user.id;
    const isAssigner = existingTodo.assignedById === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    const isManagerOfTargetUser = req.user.role === 'MANAGER' && await isManagerOfUser(req.user.id, existingTodo.userId);
    
    if (!isOwner && !isAssigner && !isAdmin && !isManagerOfTargetUser) {
      return res.status(403).json({ message: 'Not authorized to update this task' });
    }
    
    // Handle status transitions
    let newStatus = status || existingTodo.status;
    let updateData = {};
    
    // User marking task as complete (pending approval)
    if (status === ToDoStatus.PENDING_APPROVAL && isOwner && !isAssigner) {
      if (existingTodo.isSelfCreated) {
        // Self-created tasks need manager approval
        newStatus = ToDoStatus.PENDING_APPROVAL;
        updateData.completionNotes = completionNotes || null;
      } else if (existingTodo.assignedById) {
        // Assigned tasks need manager approval
        newStatus = ToDoStatus.PENDING_APPROVAL;
        updateData.completionNotes = completionNotes || null;
      }
    }
    
    // Manager approving a completed task
    if (status === ToDoStatus.COMPLETED && (isAssigner || isAdmin || isManagerOfTargetUser)) {
      if (existingTodo.status === ToDoStatus.PENDING_APPROVAL) {
        newStatus = ToDoStatus.COMPLETED;
        updateData.completedAt = new Date();
        updateData.reviewedById = req.user.id;
        updateData.reviewedAt = new Date();
      }
    }
    
    // Manager rejecting a task
    if (status === ToDoStatus.REJECTED && (isAssigner || isAdmin || isManagerOfTargetUser)) {
      if (existingTodo.status === ToDoStatus.PENDING_APPROVAL) {
        newStatus = ToDoStatus.REJECTED;
        updateData.rejectionReason = rejectionReason;
        updateData.reviewedById = req.user.id;
        updateData.reviewedAt = new Date();
      }
    }
    
    // Manager approving self-created task
    if (status === ToDoStatus.PENDING && (isAssigner || isAdmin || isManagerOfTargetUser) && existingTodo.isSelfCreated) {
      if (existingTodo.status === ToDoStatus.PENDING_APPROVAL) {
        newStatus = ToDoStatus.PENDING;
        updateData.approvedById = req.user.id;
        updateData.approvedAt = new Date();
        updateData.requiresApproval = false;
      }
    }
    
    // Validate enum values
    if (status && !Object.values(ToDoStatus).includes(newStatus)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    
    if (priority && !Object.values(TaskPriority).includes(priority)) {
      return res.status(400).json({ message: 'Invalid priority value' });
    }
    
    updateData = {
      ...updateData,
      title: title ?? existingTodo.title,
      description: description ?? existingTodo.description,
      status: newStatus,
      priority: priority ?? existingTodo.priority,
      dueDate: dueDate ? new Date(dueDate) : existingTodo.dueDate,
      updatedAt: new Date()
    };
    
    const todo = await prisma.toDo.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } }
      }
    });
    
    res.json(todo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete todo
// @route   DELETE /api/todos/:id
// @access  Private
export const deleteTodo = async (req, res) => {
  try {
    const existingTodo = await prisma.toDo.findUnique({
      where: { id: req.params.id }
    });
    
    if (!existingTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }
    
    // Only admins, assigners, and the user themselves can delete
    const isOwner = existingTodo.userId === req.user.id;
    const isAssigner = existingTodo.assignedById === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    const isManagerOfTargetUser = req.user.role === 'MANAGER' && await isManagerOfUser(req.user.id, existingTodo.userId);
    
    if (!isOwner && !isAssigner && !isAdmin && !isManagerOfTargetUser) {
      return res.status(403).json({ message: 'Not authorized to delete this task' });
    }
    
    await prisma.toDo.delete({
      where: { id: req.params.id }
    });
    
    res.json({ message: 'Todo deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Helper function to get week number
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// @desc    Get task statistics for a user
// @route   GET /api/todos/stats/:userId?
// @access  Private
export const getTodoStats = async (req, res) => {
  try {
    let targetUserId = req.params.userId || req.user.id;
    
    // Check authorization for viewing other user's stats
    if (targetUserId !== req.user.id) {
      const isAdmin = req.user.role === 'ADMIN';
      const hasManagerAccess = req.user.role === 'MANAGER' && await isManagerOfUser(req.user.id, targetUserId);
      
      if (!isAdmin && !hasManagerAccess) {
        return res.status(403).json({ message: 'Not authorized to view these statistics' });
      }
    }
    
    // Get current date for overdue calculation
    const now = new Date();
    
    // Get all tasks for the user
    const allTasks = await prisma.toDo.findMany({
      where: { userId: targetUserId },
      select: {
        status: true,
        createdAt: true,
        completedAt: true,
        dueDate: true,
        priority: true
      }
    });
    
    // Calculate statistics
    const stats = {
      total: allTasks.length,
      byStatus: {
        pending: allTasks.filter(t => t.status === ToDoStatus.PENDING).length,
        inProgress: allTasks.filter(t => t.status === ToDoStatus.IN_PROGRESS).length,
        pendingApproval: allTasks.filter(t => t.status === ToDoStatus.PENDING_APPROVAL).length,
        completed: allTasks.filter(t => t.status === ToDoStatus.COMPLETED).length,
        overdue: allTasks.filter(t => t.status === ToDoStatus.OVERDUE).length,
        rejected: allTasks.filter(t => t.status === ToDoStatus.REJECTED).length
      },
      byPriority: {
        low: allTasks.filter(t => t.priority === TaskPriority.LOW).length,
        medium: allTasks.filter(t => t.priority === TaskPriority.MEDIUM).length,
        high: allTasks.filter(t => t.priority === TaskPriority.HIGH).length,
        urgent: allTasks.filter(t => t.priority === TaskPriority.URGENT).length
      },
      completion: {
        completionRate: allTasks.length > 0 
          ? ((allTasks.filter(t => t.status === ToDoStatus.COMPLETED).length / allTasks.length) * 100).toFixed(2)
          : 0,
        averageCompletionTime: null,
        tasksCompletedOnTime: 0,
        tasksCompletedLate: 0
      },
      dailyActivity: {},
      weeklyActivity: {},
      monthlyActivity: {}
    };
    
    // Calculate completion time statistics for completed tasks
    const completedTasks = allTasks.filter(t => t.status === ToDoStatus.COMPLETED && t.completedAt);
    
    if (completedTasks.length > 0) {
      let totalCompletionTime = 0;
      let onTimeCount = 0;
      let lateCount = 0;
      
      completedTasks.forEach(task => {
        const completionTime = task.completedAt - task.createdAt;
        totalCompletionTime += completionTime;
        
        if (task.dueDate && task.completedAt <= task.dueDate) {
          onTimeCount++;
        } else if (task.dueDate && task.completedAt > task.dueDate) {
          lateCount++;
        }
      });
      
      stats.completion.averageCompletionTime = (totalCompletionTime / completedTasks.length / (1000 * 3600)).toFixed(2); // in hours
      stats.completion.tasksCompletedOnTime = onTimeCount;
      stats.completion.tasksCompletedLate = lateCount;
    }
    
    // Get daily activity (tasks created/completed per day for last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentTasks = allTasks.filter(t => t.createdAt >= thirtyDaysAgo);
    
    // Group by date
    const dailyMap = new Map();
    recentTasks.forEach(task => {
      const date = task.createdAt.toISOString().split('T')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { created: 0, completed: 0 });
      }
      const dayData = dailyMap.get(date);
      dayData.created++;
      
      if (task.status === ToDoStatus.COMPLETED && task.completedAt) {
        const completedDate = task.completedAt.toISOString().split('T')[0];
        if (completedDate === date) {
          dayData.completed++;
        }
      }
    });
    
    stats.dailyActivity = Object.fromEntries(dailyMap);
    
    // Get weekly activity (last 12 weeks)
    const weeklyMap = new Map();
    allTasks.forEach(task => {
      const weekNumber = getWeekNumber(task.createdAt);
      const weekKey = `${task.createdAt.getFullYear()}-W${weekNumber}`;
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, { created: 0, completed: 0 });
      }
      const weekData = weeklyMap.get(weekKey);
      weekData.created++;
      
      if (task.status === ToDoStatus.COMPLETED && task.completedAt) {
        const completedWeek = getWeekNumber(task.completedAt);
        const completedWeekKey = `${task.completedAt.getFullYear()}-W${completedWeek}`;
        if (completedWeekKey === weekKey) {
          weekData.completed++;
        }
      }
    });
    
    stats.weeklyActivity = Object.fromEntries(weeklyMap);
    
    // Get most productive days
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const productiveDays = new Array(7).fill(0);
    
    completedTasks.forEach(task => {
      if (task.completedAt) {
        const dayOfWeek = task.completedAt.getDay();
        productiveDays[dayOfWeek]++;
      }
    });
    
    stats.mostProductiveDays = dayNames.map((day, index) => ({
      day,
      tasksCompleted: productiveDays[index]
    })).sort((a, b) => b.tasksCompleted - a.tasksCompleted);
    
    res.json(stats);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Manager approves self-created task
// @route   PUT /api/todos/:id/approve-self-task
// @access  Private (Manager only)
export const approveSelfCreatedTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved } = req.body; // true or false
    
    const existingTodo = await prisma.toDo.findUnique({
      where: { id },
      include: { user: true }
    });
    
    if (!existingTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }
    
    if (!existingTodo.isSelfCreated) {
      return res.status(400).json({ message: 'This is not a self-created task' });
    }
    
    // Check if current user is manager of the task owner
    const hasManagerAccess = await isManagerOfUser(req.user.id, existingTodo.userId);
    if (!hasManagerAccess && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only the manager can approve self-created tasks' });
    }
    
    const updatedTodo = await prisma.toDo.update({
      where: { id },
      data: {
        status: approved ? ToDoStatus.PENDING : ToDoStatus.REJECTED,
        requiresApproval: approved ? false : existingTodo.requiresApproval,
        approvedById: approved ? req.user.id : null,
        approvedAt: approved ? new Date() : null,
        rejectionReason: !approved ? (req.body.rejectionReason || 'Task not approved') : null,
        reviewedById: !approved ? req.user.id : null,
        reviewedAt: !approved ? new Date() : null
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } }
      }
    });
    
    res.json({
      message: approved ? 'Task approved successfully' : 'Task rejected',
      todo: updatedTodo
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};