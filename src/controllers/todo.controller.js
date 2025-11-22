import { PrismaClient, ToDoStatus } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all todos for current user
// @route   GET /api/todos
// @access  Private
export const getTodos = async (req, res) => {
  try {
    const todos = await prisma.toDo.findMany({
      where: { userId: req.user.id },
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(todos);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single todo
// @route   GET /api/todos/:id
// @access  Private
export const getTodo = async (req, res) => {
  try {
    const todo = await prisma.toDo.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    if (!todo) {
      return res.status(404).json({ message: 'Todo not found' });
    }

    if (todo.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(todo);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create todo
// @route   POST /api/todos
// @access  Private
export const createTodo = async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;

    const todo = await prisma.toDo.create({
      data: {
        userId: req.user.id,
        title,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

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
    const { title, description, status, dueDate } = req.body;

    const existingTodo = await prisma.toDo.findUnique({
      where: { id: req.params.id }
    });

    if (!existingTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }

    if (existingTodo.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Validate enum
    if (status && !Object.values(ToDoStatus).includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const todo = await prisma.toDo.update({
      where: { id: req.params.id },
      data: {
        title: title ?? existingTodo.title,
        description: description ?? existingTodo.description,
        status: status ?? existingTodo.status,
        dueDate: dueDate ? new Date(dueDate) : existingTodo.dueDate,
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
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

    if (existingTodo.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await prisma.toDo.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Todo deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
