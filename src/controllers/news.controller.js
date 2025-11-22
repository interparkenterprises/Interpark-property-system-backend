import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all news
// @route   GET /api/news
// @access  Private
export const getNews = async (req, res) => {
  try {
    const news = await prisma.news.findMany({
      orderBy: { publishedAt: 'desc' }
    });
    res.json(news);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single news
// @route   GET /api/news/:id
// @access  Private
export const getNewsItem = async (req, res) => {
  try {
    const newsItem = await prisma.news.findUnique({
      where: { id: req.params.id }
    });

    if (!newsItem) {
      return res.status(404).json({ message: 'News item not found' });
    }

    res.json(newsItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create news
// @route   POST /api/news
// @access  Private (Admin only)
export const createNews = async (req, res) => {
  try {
    const { title, content } = req.body;

    const newsItem = await prisma.news.create({
      data: {
        title,
        content
      }
    });

    res.status(201).json(newsItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update news
// @route   PUT /api/news/:id
// @access  Private (Admin only)
export const updateNews = async (req, res) => {
  try {
    const { title, content } = req.body;

    const newsItem = await prisma.news.update({
      where: { id: req.params.id },
      data: {
        title,
        content
      }
    });

    res.json(newsItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete news
// @route   DELETE /api/news/:id
// @access  Private (Admin only)
export const deleteNews = async (req, res) => {
  try {
    await prisma.news.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'News item deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};