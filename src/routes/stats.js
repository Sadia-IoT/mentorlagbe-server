import { Router } from "express";
import { collections } from "../config/db.js";
import {
  verifyToken,
  verifyStudent,
  verifyTutor,
  verifyAdmin,
} from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// GET /stats/public  -> counters used on the landing page
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const { users, tuitions, applications } = collections();

    const [
      students,
      tutors,
      tuitionCount,
      applicationCount,
      reviewAgg,
      subjectAgg,
    ] = await Promise.all([
      users.countDocuments({ role: "student" }),
      users.countDocuments({ role: "tutor" }),
      tuitions.countDocuments({ approvalStatus: "approved", isActive: true }),
      applications.countDocuments({ status: "accepted" }),
      applications
        .aggregate([
          { $match: { "review.rating": { $exists: true } } },
          {
            $group: {
              _id: null,
              average: { $avg: "$review.rating" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      tuitions
        .aggregate([
          { $match: { approvalStatus: "approved", isActive: true } },
          { $group: { _id: "$subject", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 6 },
        ])
        .toArray(),
    ]);

    res.json({
      students,
      tutors,
      tuitions: tuitionCount,
      acceptedApplications: applicationCount,
      averageRating: Number((reviewAgg[0]?.average || 0).toFixed(1)),
      reviewCount: reviewAgg[0]?.count || 0,
      subjects: subjectAgg.map((item) => ({
        name: item._id,
        count: item.count,
      })),
    });
  })
);

// GET /stats/student
router.get(
  "/student",
  verifyToken,
  verifyStudent,
  asyncHandler(async (req, res) => {
    const { applications, users } = collections();

    const [total, accepted, pending, rejected, user] = await Promise.all([
      applications.countDocuments({ studentEmail: req.user.email }),
      applications.countDocuments({
        studentEmail: req.user.email,
        status: "accepted",
      }),
      applications.countDocuments({
        studentEmail: req.user.email,
        status: "pending",
      }),
      applications.countDocuments({
        studentEmail: req.user.email,
        status: "rejected",
      }),
      users.findOne(
        { _id: req.user.id },
        { projection: { plan: 1, bookmarks: 1 } }
      ),
    ]);

    res.json({
      totalApplied: total,
      accepted,
      pending,
      rejected,
      plan: user?.plan || "free",
      bookmarks: (user?.bookmarks || []).length,
    });
  })
);

// GET /stats/tutor
router.get(
  "/tutor",
  verifyToken,
  verifyTutor,
  asyncHandler(async (req, res) => {
    const { tuitions, applications, users } = collections();

    const [totalTuitions, approved, active, applicants, pendingApplicants, user] =
      await Promise.all([
        tuitions.countDocuments({ tutorEmail: req.user.email }),
        tuitions.countDocuments({
          tutorEmail: req.user.email,
          approvalStatus: "approved",
        }),
        tuitions.countDocuments({
          tutorEmail: req.user.email,
          isActive: true,
        }),
        applications.countDocuments({ tutorEmail: req.user.email }),
        applications.countDocuments({
          tutorEmail: req.user.email,
          status: "pending",
        }),
        users.findOne({ _id: req.user.id }, { projection: { plan: 1 } }),
      ]);

    res.json({
      totalTuitions,
      approved,
      active,
      applicants,
      pendingApplicants,
      plan: user?.plan || "free",
      freeLimit: 2,
    });
  })
);

// GET /stats/admin
router.get(
  "/admin",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const { users, tuitions, applications, payments } = collections();

    const [
      totalUsers,
      students,
      tutors,
      admins,
      pendingTuitions,
      approvedTuitions,
      rejectedTuitions,
      totalApplications,
      revenueAgg,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ role: "student" }),
      users.countDocuments({ role: "tutor" }),
      users.countDocuments({ role: "admin" }),
      tuitions.countDocuments({ approvalStatus: "pending" }),
      tuitions.countDocuments({ approvalStatus: "approved" }),
      tuitions.countDocuments({ approvalStatus: "rejected" }),
      applications.countDocuments({}),
      payments
        .aggregate([
          { $match: { paymentStatus: "paid" } },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);

    res.json({
      totalUsers,
      students,
      tutors,
      admins,
      pendingTuitions,
      approvedTuitions,
      rejectedTuitions,
      totalApplications,
      totalRevenue: revenueAgg[0]?.total || 0,
      totalTransactions: revenueAgg[0]?.count || 0,
    });
  })
);

export default router;
