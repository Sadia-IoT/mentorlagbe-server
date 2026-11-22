import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../config/db.js";
import {
  verifyToken,
  verifyStudent,
  verifyAdmin,
} from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const ROLES = ["student", "tutor", "admin"];
const FREE_BOOKMARK_LIMIT = 5;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toObjectId = (value) =>
  ObjectId.isValid(value) ? new ObjectId(value) : null;

/* ------------------------------------------------------------------ */
/* Current user                                                        */
/* ------------------------------------------------------------------ */

// GET /users/me  -> fresh profile of the logged-in user
router.get(
  "/me",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { users } = collections();
    const user = await users.findOne(
      { _id: req.user.id },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          plan: 1,
          phone: 1,
          bio: 1,
          createdAt: 1,
        },
      }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  })
);

// PATCH /users/me  -> update name, phone, bio and profile image
router.patch(
  "/me",
  verifyToken,
  asyncHandler(async (req, res) => {
    const name = String(req.body.name ?? "").trim();
    const phone = String(req.body.phone ?? "").trim();
    const bio = String(req.body.bio ?? "").trim();
    const image = String(req.body.image ?? "").trim();

    if (name.length < 2 || name.length > 80) {
      return res
        .status(400)
        .json({ message: "Name must be between 2 and 80 characters" });
    }
    if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }
    if (bio.length > 500) {
      return res
        .status(400)
        .json({ message: "Bio must be under 500 characters" });
    }
    if (image && !/^https?:\/\/\S+$/i.test(image)) {
      return res.status(400).json({ message: "Image must be a valid URL" });
    }

    const { users } = collections();
    const update = { name, phone, bio, updatedAt: new Date() };
    if (image) update.image = image;

    await users.updateOne({ _id: req.user.id }, { $set: update });

    const user = await users.findOne(
      { _id: req.user.id },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          plan: 1,
          phone: 1,
          bio: 1,
        },
      }
    );
    res.json({ message: "Profile updated", user });
  })
);

/* ------------------------------------------------------------------ */
/* Bookmarks (students)                                                */
/* ------------------------------------------------------------------ */

// GET /users/me/bookmarks
router.get(
  "/me/bookmarks",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const { users, tuitions } = collections();
    const user = await users.findOne({ _id: req.user.id });
    const ids = (user?.bookmarks || []).filter((id) => id instanceof ObjectId);

    if (!ids.length) return res.json([]);

    const items = await tuitions.find({ _id: { $in: ids } }).toArray();
    // Keep the order in which the student saved them (newest first)
    const ordered = ids
      .map((id) => items.find((item) => item._id.equals(id)))
      .filter(Boolean)
      .reverse();
    res.json(ordered);
  })
);

// POST /users/me/bookmarks/:tuitionId  -> toggle a bookmark
router.post(
  "/me/bookmarks/:tuitionId",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const tuitionId = toObjectId(req.params.tuitionId);
    if (!tuitionId) {
      return res.status(400).json({ message: "Invalid tuition id" });
    }

    const { users, tuitions } = collections();
    const tuition = await tuitions.findOne({
      _id: tuitionId,
      approvalStatus: "approved",
      isActive: true,
    });
    if (!tuition) {
      return res.status(404).json({ message: "Tuition not found" });
    }

    const user = await users.findOne({ _id: req.user.id });
    const bookmarks = (user?.bookmarks || []).filter(
      (id) => id instanceof ObjectId
    );
    const alreadySaved = bookmarks.some((id) => id.equals(tuitionId));

    if (alreadySaved) {
      await users.updateOne(
        { _id: req.user.id },
        { $pull: { bookmarks: tuitionId } }
      );
      return res.json({ saved: false, message: "Removed from saved tuitions" });
    }

    if (user?.plan !== "pro" && bookmarks.length >= FREE_BOOKMARK_LIMIT) {
      return res.status(403).json({
        message: `Free plan allows ${FREE_BOOKMARK_LIMIT} saved tuitions. Upgrade to Pro for unlimited bookmarks.`,
      });
    }

    await users.updateOne(
      { _id: req.user.id },
      { $push: { bookmarks: tuitionId } }
    );
    res.json({ saved: true, message: "Saved to your bookmarks" });
  })
);

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

// GET /users?search=&role=&page=&limit=
router.get(
  "/",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const { users } = collections();
    const { search, role } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    const filter = {};
    if (ROLES.includes(role)) filter.role = role;
    if (search?.trim()) {
      const pattern = {
        $regex: escapeRegex(search.trim()),
        $options: "i",
      };
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const [items, total] = await Promise.all([
      users
        .find(filter, {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            plan: 1,
            phone: 1,
            createdAt: 1,
          },
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      users.countDocuments(filter),
    ]);

    res.json({
      users: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  })
);

// PATCH /users/:id/role
router.patch(
  "/:id/role",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid user id" });

    const role = String(req.body.role ?? "").trim();
    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ message: "Role must be student, tutor or admin" });
    }
    if (String(req.user.id) === String(id) && role !== "admin") {
      return res
        .status(400)
        .json({ message: "You cannot remove your own admin access" });
    }

    const { users } = collections();
    const result = await users.updateOne(
      { _id: id },
      { $set: { role, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: `Role updated to ${role}`, role });
  })
);

export default router;
