import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import userRoutes from "./routes/users.js";
import tuitionRoutes from "./routes/tuitions.js";
import applicationRoutes from "./routes/applications.js";
import adminRoutes from "./routes/admin.js";
import statsRoutes from "./routes/stats.js";
import paymentRoutes, { stripeWebhook } from "./routes/payments.js";
import uploadRoutes from "./routes/upload.js";

const app = express();

app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: curl, Postman, Stripe webhook, server-to-server
      if (!origin) return callback(null, true);
      // Local development with an empty CLIENT_URL
      if (!allowedOrigins.length) return callback(null, true);
      return callback(null, allowedOrigins.includes(origin.replace(/\/$/, "")));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Make sure the DB is connected before any route (or webhook) runs
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("DB connection failed:", error.message);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// IMPORTANT (Stripe): the webhook needs the RAW body and must be registered
// BEFORE express.json(), otherwise signature verification always fails.
app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({
    message: "MentorLagbe server is running",
    time: new Date().toISOString(),
  });
});

// Routes
app.use("/users", userRoutes);
app.use("/tuitions", tuitionRoutes);
app.use("/applications", applicationRoutes);
app.use("/admin", adminRoutes);
app.use("/stats", statsRoutes);
app.use("/payments", paymentRoutes);
app.use("/upload", uploadRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error(error);

  if (error.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ message: "Image is too large. Maximum size is 5 MB." });
  }

  res.status(error.status || 500).json({
    message: error.message || "Internal server error",
  });
});

// Vercel runs the exported app; locally we listen on a port
if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

export default app;
