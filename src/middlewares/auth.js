import { createRemoteJWKSet, jwtVerify } from "jose";
import { collections } from "../config/db.js";

// Better Auth lives on the Next.js app, so its public keys are served from there.
// Create the key set once and reuse it for every request.
let JWKS;
function getJWKS() {
  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`)
    );
  }
  return JWKS;
}

/**
 * 1) Check the Bearer token (signature, expiry, issuer)
 * 2) Load the latest user from OUR database (never trust role from the token)
 * 3) Attach it as req.user
 */
export async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: process.env.BETTER_AUTH_URL,
    });

    const { users } = collections();
    const user = await users.findOne({ email: payload.email });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Authorization: what is this user allowed to do?
const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) {
    return res.status(403).json({ message: `${role} access required` });
  }
  next();
};

export const verifyStudent = requireRole("student");
export const verifyTutor = requireRole("tutor");
export const verifyAdmin = requireRole("admin");