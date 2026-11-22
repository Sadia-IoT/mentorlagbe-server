import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../config/db.js";
import { verifyToken, verifyAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const STATUSES = ["pending", "approved", "rejected"];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ */
/* Tuition moderation                                                  */
/* ------------------------------------------------------------------ */

// GET /admin/tuitions?status=&search=&page=&limit=
router.get(
  "/tuitions",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();
    const { status, search } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    const filter = {};
    if (STATUSES.includes(status)) filter.approvalStatus = status;
    if (search?.trim()) {
      const pattern = { $regex: escapeRegex(search.trim()), $options: "i" };
      filter.$or = [
        { title: pattern },
        { subject: pattern },
        { tutorEmail: pattern },
        { tutorName: pattern },
      ];
    }

    const [items, total] = await Promise.all([
      tuitions
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      tuitions.countDocuments(filter),
    ]);

    res.json({
      tuitions: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  })
);

// PATCH /admin/tuitions/:id/status  -> approve / reject a listing
router.patch(
  "/tuitions/:id/status",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid tuition id" });
    }

    const approvalStatus = String(req.body.approvalStatus ?? "").trim();
    if (!["approved", "rejected", "pending"].includes(approvalStatus)) {
      return res.status(400).json({
        message: "approvalStatus must be approved, rejected or pending",
      });
    }

    const { tuitions } = collections();
    const result = await tuitions.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          approvalStatus,
          reviewedAt: new Date(),
          reviewedBy: req.user.email,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Tuition not found" });
    }
    res.json({ message: `Tuition ${approvalStatus}`, approvalStatus });
  })
);

/* ------------------------------------------------------------------ */
/* Payments / transactions                                             */
/* ------------------------------------------------------------------ */

// GET /admin/transactions?page=&limit=&search=
router.get(
  "/transactions",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const { payments } = collections();
    const { search } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    const filter = {};
    if (search?.trim()) {
      const pattern = { $regex: escapeRegex(search.trim()), $options: "i" };
      filter.$or = [
        { userEmail: pattern },
        { userName: pattern },
        { transactionId: pattern },
        { planName: pattern },
      ];
    }

    const [items, total, revenue] = await Promise.all([
      payments
        .find(filter)
        .sort({ paidAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      payments.countDocuments(filter),
      payments
        .aggregate([
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
        .toArray(),
    ]);

    res.json({
      transactions: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      revenue: revenue[0]?.total || 0,
    });
  })
);

export default router;
