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

const config = () => ({
  cloudName: (process.env.CLOUDINARY_CLOUD_NAME || "").trim(),
  preset: (process.env.CLOUDINARY_UPLOAD_PRESET || "").trim(),
  imgbbKey: (process.env.IMGBB_API_KEY || "").trim(),
});

/**
 * Upload through Cloudinary's unsigned preset. The preset name and cloud name
 * are public identifiers; no secret key is needed or shipped to the browser.
 */
async function uploadToCloudinary(req, { cloudName, preset }) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([req.file.buffer], { type: req.file.mimetype }),
    req.file.originalname || "mentorlagbe.jpg"
  );
  form.append("upload_preset", preset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    { method: "POST", body: form }
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result?.secure_url) {
    throw new Error(result?.error?.message || "Cloudinary upload failed");
  }

  return {
    url: result.secure_url,
    displayUrl: result.secure_url,
    thumbnail: result.secure_url,
    deleteUrl: "",
  };
}

/** Legacy provider kept as a fallback when Cloudinary is not configured. */
async function uploadToImgBB(req, apiKey) {
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
    throw new Error(result?.error?.message || "ImgBB upload failed");
  }

  return {
    url: result.data.url,
    displayUrl: result.data.display_url,
    thumbnail: result.data.thumb?.url || result.data.url,
    deleteUrl: result.data.delete_url || "",
  };
}

/**
 * POST /upload/image
 * Multipart form-data with a single "image" field.
 * Media provider credentials stay on the server — never in the browser.
 */
router.post(
  "/image",
  verifyToken,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const { cloudName, preset, imgbbKey } = config();

    if (!cloudName && !preset && !imgbbKey) {
      return res.status(503).json({
        message:
          "Image upload is not configured. Add CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET to the server .env file (or IMGBB_API_KEY for the legacy provider).",
      });
    }

    if ((cloudName || preset) && !(cloudName && preset)) {
      return res.status(503).json({
        message:
          "Cloudinary upload needs both CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET.",
      });
    }

    try {
      const uploaded =
        cloudName && preset
          ? await uploadToCloudinary(req, { cloudName, preset })
          : await uploadToImgBB(req, imgbbKey);
      return res.status(201).json(uploaded);
    } catch (error) {
      return res.status(502).json({
        message: error?.message || "Image upload failed",
      });
    }
  })
);

export default router;
