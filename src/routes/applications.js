import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../config/db.js";
import { verifyToken, verifyStudent, verifyTutor } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const toObjectId = (value) =>
  ObjectId.isValid(value) ? new ObjectId(value) : null;

/* ------------------------------------------------------------------ */
/* Student routes                                                      */
/* ------------------------------------------------------------------ */

// POST /applications  -> a student applies to an approved + active tuition
router.post(
  "/",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const { tuitions, applications } = collections();

    const tuitionId = toObjectId(req.body.tuitionId);
    if (!tuitionId) {
      return res.status(400).json({ message: "Invalid tuition id" });
    }

    const studentPhone = String(req.body.studentPhone ?? "").trim();
    const preferredSchedule = String(req.body.preferredSchedule ?? "").trim();
    const studentNote = String(req.body.studentNote ?? "").trim();

    if (!studentPhone) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    if (!/^[0-9+\-\s()]{6,20}$/.test(studentPhone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }
    if (!preferredSchedule) {
      return res
        .status(400)
        .json({ message: "Preferred schedule is required" });
    }
    if (studentNote.length > 600) {
      return res
        .status(400)
        .json({ message: "Learning note must be under 600 characters" });
    }

    // Only approved + active tuitions can receive applications
    const tuition = await tuitions.findOne({
      _id: tuitionId,
      approvalStatus: "approved",
      isActive: true,
    });
    if (!tuition) {
      return res
        .status(404)
        .json({ message: "This tuition is not open for applications" });
    }

    const alreadyApplied = await applications.findOne({
      tuitionId,
      studentEmail: req.user.email,
    });
    if (alreadyApplied) {
      return res
        .status(409)
        .json({ message: "You have already applied for this tuition" });
    }

    const application = {
      tuitionId,
      tuitionTitle: tuition.title,
      subject: tuition.subject,
      monthlyFee: tuition.monthlyFee,
      bannerImage: tuition.bannerImage || "",
      tutorEmail: tuition.tutorEmail,
      tutorName: tuition.tutorName,
      studentName: req.user.name,
      studentEmail: req.user.email,
      studentPhone,
      preferredSchedule,
      studentNote,
      status: "pending",
      appliedAt: new Date(),
    };

    try {
      const result = await applications.insertOne(application);
      res.status(201).json({ ...application, _id: result.insertedId });
    } catch (error) {
      // Unique index (tuitionId + studentEmail) is the final guard
      if (error.code === 11000) {
        return res
          .status(409)
          .json({ message: "You have already applied for this tuition" });
      }
      throw error;
    }
  })
);

// GET /applications/my  -> student's own applications
router.get(
  "/my",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const { applications } = collections();
    const items = await applications
      .find({ studentEmail: req.user.email })
      .sort({ appliedAt: -1 })
      .toArray();
    res.json(items);
  })
);

// DELETE /applications/:id  -> student can cancel only while status is pending
router.delete(
  "/:id",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid application id" });

    const { applications } = collections();
    const application = await applications.findOne({
      _id: id,
      studentEmail: req.user.email,
    });
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }
    if (application.status !== "pending") {
      return res.status(400).json({
        message: "Only pending applications can be cancelled",
      });
    }

    await applications.deleteOne({ _id: id });
    res.json({ message: "Application cancelled" });
  })
);

// POST /applications/:id/review  -> accepted student rates the tuition once
router.post(
  "/:id/review",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid application id" });

    const rating = Number(req.body.rating);
    const feedback = String(req.body.feedback ?? "").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be a whole number from 1 to 5" });
    }
    if (feedback.length > 500) {
      return res
        .status(400)
        .json({ message: "Feedback must be under 500 characters" });
    }

    const { applications } = collections();
    const application = await applications.findOne({
      _id: id,
      studentEmail: req.user.email,
    });
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }
    if (application.status !== "accepted") {
      return res.status(403).json({
        message: "Only accepted students can review this tuition",
      });
    }
    if (application.review) {
      return res
        .status(409)
        .json({ message: "You have already reviewed this tuition" });
    }

    const review = {
      rating,
      feedback,
      studentName: req.user.name,
      reviewedAt: new Date(),
    };

    await applications.updateOne({ _id: id }, { $set: { review } });
    res.status(201).json({ message: "Thanks for your review", review });
  })
);

/* ------------------------------------------------------------------ */
/* Tutor routes                                                        */
/* ------------------------------------------------------------------ */

// GET /applications/tutor  -> every application received on my tuitions
router.get(
  "/tutor",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const { applications } = collections();
    const items = await applications
      .find({ tutorEmail: req.user.email })
      .sort({ appliedAt: -1 })
      .toArray();
    res.json(items);
  })
);

// PATCH /applications/:id/status  -> tutor accepts / rejects an applicant
router.patch(
  "/:id/status",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid application id" });

    const status = String(req.body.status ?? "").trim();
    if (!["accepted", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be accepted or rejected" });
    }

    const { applications } = collections();
    const result = await applications.updateOne(
      { _id: id, tutorEmail: req.user.email },
      { $set: { status, statusUpdatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Application not found" });
    }
    res.json({ message: `Application ${status}`, status });
  })
);

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

// GET /applications/reviews/:tuitionId  -> public reviews for a tuition
router.get(
  "/reviews/:tuitionId",
  asyncHandler(async (req, res) => {
    const tuitionId = toObjectId(req.params.tuitionId);
    if (!tuitionId) {
      return res.status(400).json({ message: "Invalid tuition id" });
    }

    const { applications } = collections();
    const reviews = await applications
      .find(
        { tuitionId, "review.rating": { $exists: true } },
        { projection: { review: 1 } }
      )
      .sort({ "review.reviewedAt": -1 })
      .limit(12)
      .toArray();

    res.json(reviews.map((item) => item.review));
  })
);

export default router;
