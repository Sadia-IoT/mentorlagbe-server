import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../config/db.js";
import { verifyToken, verifyTutor } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const MODES = ["Online", "Offline"];
const FREE_TUITION_LIMIT = 2;

// Only approved + active tuitions are public
const PUBLIC_FILTER = { approvalStatus: "approved", isActive: true };

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Case-insensitive exact match (for dropdown filters)
const exactMatch = (value) => ({
  $regex: `^${escapeRegex(value)}$`,
  $options: "i",
});

function parseId(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ message: "Invalid tuition id" });
    return null;
  }
  return new ObjectId(req.params.id);
}

/** Validate and clean the body of create/update requests. */
function cleanTuition(body) {
  const data = {
    title: String(body.title ?? "").trim(),
    subject: String(body.subject ?? "").trim(),
    classLevel: String(body.classLevel ?? "").trim(),
    mode: String(body.mode ?? "").trim(),
    location: String(body.location ?? "").trim(),
    monthlyFee: Number(body.monthlyFee),
    daysPerWeek: Number(body.daysPerWeek),
    bannerImage: String(body.bannerImage ?? "").trim(),
    description: String(body.description ?? "").trim(),
  };

  if (!data.title || !data.subject || !data.classLevel || !data.description) {
    return { error: "Title, subject, class level and description are required" };
  }
  if (!MODES.includes(data.mode)) {
    return { error: "Mode must be Online or Offline" };
  }
  if (data.mode === "Offline" && !data.location) {
    return { error: "Location is required for offline tuition" };
  }
  if (!Number.isFinite(data.monthlyFee) || data.monthlyFee <= 0) {
    return { error: "Monthly fee must be a positive number" };
  }
  if (
    !Number.isInteger(data.daysPerWeek) ||
    data.daysPerWeek < 1 ||
    data.daysPerWeek > 7
  ) {
    return { error: "Days per week must be between 1 and 7" };
  }

  return { data };
}

/* ------------------------------------------------------------------ */
/* Public routes                                                       */
/* ------------------------------------------------------------------ */

// GET /tuitions?search=&subject=&classLevel=&mode=&page=&limit=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();
    const { search, subject, classLevel, mode } = req.query;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);

    const filter = { ...PUBLIC_FILTER };

    if (search?.trim()) {
      const pattern = { $regex: escapeRegex(search.trim()), $options: "i" };
      filter.$or = [{ title: pattern }, { subject: pattern }];
    }
    if (subject) filter.subject = exactMatch(subject);
    if (classLevel) filter.classLevel = exactMatch(classLevel);
    if (MODES.includes(mode)) filter.mode = mode;

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

// GET /tuitions/featured  (latest 6 for the home page)
router.get(
  "/featured",
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();
    const items = await tuitions
      .find(PUBLIC_FILTER)
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.json(items);
  })
);

// GET /tuitions/filters  (values for the filter dropdowns + subject counts)
router.get(
  "/filters",
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();

    const [subjects, classLevels] = await Promise.all([
      tuitions
        .aggregate([
          { $match: PUBLIC_FILTER },
          { $group: { _id: "$subject", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ])
        .toArray(),
      tuitions.distinct("classLevel", PUBLIC_FILTER),
    ]);

    res.json({
      subjects: subjects.map((s) => ({ name: s._id, count: s.count })),
      classLevels: classLevels.sort(),
    });
  })
);

/* ------------------------------------------------------------------ */
/* Tutor routes (must be declared before "/:id")                       */
/* ------------------------------------------------------------------ */

// GET /tuitions/my/list
router.get(
  "/my/list",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();
    const items = await tuitions
      .find({ tutorEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  })
);

// POST /tuitions  (Free plan: max 2 posts, Pro: unlimited)
router.post(
  "/",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const { tuitions } = collections();

    const { data, error } = cleanTuition(req.body);
    if (error) return res.status(400).json({ message: error });

    if (req.user.plan !== "pro") {
      const count = await tuitions.countDocuments({
        tutorEmail: req.user.email,
      });
      if (count >= FREE_TUITION_LIMIT) {
        return res.status(403).json({
          message: `Free plan allows only ${FREE_TUITION_LIMIT} tuition posts. Upgrade to Pro for unlimited posts.`,
        });
      }
    }

    const tuition = {
      ...data,
      tutorName: req.user.name,
      tutorEmail: req.user.email,
      approvalStatus: "pending",
      isActive: true,
      createdAt: new Date(),
    };

    const result = await tuitions.insertOne(tuition);
    res.status(201).json({ ...tuition, _id: result.insertedId });
  })
);

// PATCH /tuitions/:id/toggle  (Active <-> Closed)
router.patch(
  "/:id/toggle",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;

    const { tuitions } = collections();
    const tuition = await tuitions.findOne({
      _id: id,
      tutorEmail: req.user.email,
    });
    if (!tuition) return res.status(404).json({ message: "Tuition not found" });

    await tuitions.updateOne({ _id: id }, { $set: { isActive: !tuition.isActive } });
    res.json({ isActive: !tuition.isActive });
  })
);

// PATCH /tuitions/:id  (edit; goes back to "pending" for admin to re-check)
router.patch(
  "/:id",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;

    const { data, error } = cleanTuition(req.body);
    if (error) return res.status(400).json({ message: error });

    const { tuitions } = collections();
    const result = await tuitions.updateOne(
      { _id: id, tutorEmail: req.user.email },
      { $set: { ...data, approvalStatus: "pending" } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Tuition not found" });
    }
    res.json({ message: "Tuition updated and sent for approval again" });
  })
);

// DELETE /tuitions/:id
router.delete(
  "/:id",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;

    const { tuitions } = collections();
    const result = await tuitions.deleteOne({
      _id: id,
      tutorEmail: req.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Tuition not found" });
    }
    res.json({ message: "Tuition deleted" });
  })
);

/* ------------------------------------------------------------------ */
/* Public details (keep LAST so it does not swallow the routes above)  */
/* ------------------------------------------------------------------ */

// GET /tuitions/:id  (with a short tutor profile)
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;

    const { tuitions, users, applications } = collections();
    const tuition = await tuitions.findOne({ _id: id, ...PUBLIC_FILTER });
    if (!tuition) return res.status(404).json({ message: "Tuition not found" });

    const [tutor, reviewDocs] = await Promise.all([
      users.findOne(
        { email: tuition.tutorEmail },
        { projection: { name: 1, image: 1, bio: 1, plan: 1, createdAt: 1 } }
      ),
      applications
        .find(
          { tuitionId: id, "review.rating": { $exists: true } },
          { projection: { review: 1 } }
        )
        .sort({ "review.reviewedAt": -1 })
        .limit(8)
        .toArray(),
    ]);

    const reviews = reviewDocs.map((item) => item.review);
    const ratingAverage = reviews.length
      ? Number(
          (
            reviews.reduce((sum, review) => sum + review.rating, 0) /
            reviews.length
          ).toFixed(1)
        )
      : 0;

    res.json({
      ...tuition,
      tutor: tutor
        ? {
            name: tutor.name,
            image: tutor.image || "",
            bio: tutor.bio || "",
            isPro: tutor.plan === "pro",
            memberSince: tutor.createdAt || null,
          }
        : null,
      reviews,
      ratingAverage,
      reviewCount: reviews.length,
    });
  })
);

export default router;