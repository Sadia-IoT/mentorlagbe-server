import { MongoClient, ServerApiVersion } from "mongodb";

let client;
let db;

/**
 * Connect once and reuse the connection (important on serverless hosts
 * like Vercel, where the function can be re-invoked many times).
 */
export async function connectDB() {
  if (db) return db;

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  db = client.db(process.env.DB_NAME || "mentorlagbe");
  await ensureIndexes(db);

  console.log("MongoDB connected");
  return db;
}

/** Use inside controllers after connectDB() has run. */
export function getDB() {
  if (!db) throw new Error("Database not connected yet");
  return db;
}

/** Shortcut for the 4 collections used in this project. */
export function collections() {
  const database = getDB();
  return {
    users: database.collection("users"),
    tuitions: database.collection("tuitions"),
    applications: database.collection("applications"),
    payments: database.collection("payments"),
  };
}

/**
 * Indexes are safe to run many times; MongoDB skips ones that already exist.
 * NOTE: store tuitionId in applications as an ObjectId everywhere
 * (or as a string everywhere). Do not mix the two.
 */
async function ensureIndexes(database) {
  await Promise.all([
    // One account per email
    database.collection("users").createIndex({ email: 1 }, { unique: true }),

    // Public browse page: approved + active, newest first
    database
      .collection("tuitions")
      .createIndex({ approvalStatus: 1, isActive: 1, createdAt: -1 }),
    // Tutor "my tuitions" and the free-plan 2-post limit check
    database.collection("tuitions").createIndex({ tutorEmail: 1 }),

    // Same student cannot apply twice to the same tuition
    database
      .collection("applications")
      .createIndex({ tuitionId: 1, studentEmail: 1 }, { unique: true }),
    database.collection("applications").createIndex({ tutorEmail: 1 }),
    database.collection("applications").createIndex({ studentEmail: 1 }),

    // Same Stripe session cannot be saved twice (success page + webhook)
    database
      .collection("payments")
      .createIndex({ stripeSessionId: 1 }, { unique: true }),
    database.collection("payments").createIndex({ userEmail: 1 }),
  ]);
}