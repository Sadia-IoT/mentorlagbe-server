import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import userRoutes from "./routes/users.js";

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// IMPORTANT (Stripe, later): the webhook route must be registered BEFORE
// express.json() and use express.raw({ type: "application/json" }),
// otherwise signature verification will always fail.

app.use(express.json());

// Make sure the DB is connected before any route runs
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("DB connection failed:", error.message);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({ message: "MentorLagbe server is running" });
});

// Routes
app.use("/users", userRoutes);
// app.use("/tuitions", tuitionRoutes);
// app.use("/applications", applicationRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error(error);
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