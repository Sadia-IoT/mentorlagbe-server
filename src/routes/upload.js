import { Router } from "express";
import multer from "multer";
import { verifyToken } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed"));
  },
});

/**
 * POST /upload/image
 * Multipart form-data with a single "image" field.
 * The ImgBB API key stays on the server — it is never shipped to the browser.
 */
router.post(
  "/image",
  verifyToken,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey || apiKey.includes("xxx")) {
      return res.status(503).json({
        message:
          "ImgBB is not configured. Add IMGBB_API_KEY to the server .env file.",
      });
    }

    const form = new FormData();
    form.append(
      "image",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname || "mentorlagbe.jpg"
    );

    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      { method: "POST", body: form }
    );
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result?.success) {
      return res.status(502).json({
        message: result?.error?.message || "ImgBB upload failed",
      });
    }

    res.status(201).json({
      url: result.data.url,
      displayUrl: result.data.display_url,
      thumbnail: result.data.thumb?.url || result.data.url,
      deleteUrl: result.data.delete_url || "",
    });
  })
);

export default router;
