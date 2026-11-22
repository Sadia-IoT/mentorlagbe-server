import { Router } from "express";
import { verifyToken } from "../middlewares/auth.js";

const router = Router();

// Returns the logged-in user (used to test that JWT verification works)
router.get("/me", verifyToken, (req, res) => {
  res.json(req.user);
});

export default router;