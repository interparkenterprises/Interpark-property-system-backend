// src/routes/income.routes.js
import express from "express";
import {
  createIncome,
  getAllIncomes,
  getIncomeById,
  updateIncome,
  deleteIncome,
} from "../controllers/income.controller.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Managers and Admins only
router.use(protect);
router.use(authorize("ADMIN", "MANAGER"));

router.post("/", createIncome);
router.get("/", getAllIncomes);
router.get("/:id", getIncomeById);
router.put("/:id", updateIncome);
//  Admin ONLY
router.delete("/:id", authorize("ADMIN"), deleteIncome);

export default router;
