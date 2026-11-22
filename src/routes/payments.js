import { Router } from "express";
import Stripe from "stripe";
import { collections } from "../config/db.js";
import { verifyToken } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const PLAN_PRICES = {
  tutor: { amount: 1500, planName: "Pro Tutor", label: "Unlimited tuition posts" },
  student: { amount: 1000, planName: "Pro Student", label: "Unlimited bookmarks" },
};

let stripeClient;
function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return key.startsWith("sk_") && !key.includes("xxx");
}

function clientBaseUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")[0]
    .trim();
}

/**
 * Idempotent: the success page AND the webhook may both call this for the
 * same Stripe session. The unique index on stripeSessionId keeps one record.
 */
async function finalizePayment(session) {
  if (!session || session.payment_status !== "paid") {
    return { paid: false };
  }

  const { payments, users } = collections();
  const meta = session.metadata || {};

  if (!meta.userEmail) return { paid: false };

  const record = {
    userEmail: meta.userEmail,
    userName: meta.userName || "",
    userRole: meta.userRole || "",
    planName: meta.planName || "Pro",
    amount: (session.amount_total || 0) / 100,
    currency: (session.currency || "usd").toUpperCase(),
    transactionId: session.payment_intent || session.id,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  await payments.updateOne(
    { stripeSessionId: session.id },
    { $setOnInsert: record },
    { upsert: true }
  );

  await users.updateOne(
    { email: meta.userEmail },
    { $set: { plan: "pro", updatedAt: new Date() } }
  );

  return { paid: true, payment: record };
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

// POST /payments/checkout  -> { url } for Stripe Checkout
router.post(
  "/checkout",
  verifyToken,
  asyncHandler(async (req, res) => {
    if (!isStripeConfigured()) {
      return res.status(503).json({
        message:
          "Stripe is not configured. Add a real STRIPE_SECRET_KEY to the server .env file.",
      });
    }

    const role = req.user.role;
    if (!["student", "tutor"].includes(role)) {
      return res
        .status(403)
        .json({ message: "Only students and tutors can upgrade to Pro" });
    }
    if (req.user.plan === "pro") {
      return res
        .status(400)
        .json({ message: "You are already on the Pro plan" });
    }

    const plan = PLAN_PRICES[role];
    const base = clientBaseUrl();

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: plan.amount,
            product_data: {
              name: `${plan.planName} — MentorLagbe`,
              description: plan.label,
            },
          },
        },
      ],
      metadata: {
        userEmail: req.user.email,
        userName: req.user.name || "",
        userRole: role,
        planName: plan.planName,
        amount: String(plan.amount),
      },
      success_url: `${base}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/payment/cancel`,
    });

    res.json({ url: session.url, sessionId: session.id });
  })
);

// GET /payments/verify?session_id=...  -> called by the success page
router.get(
  "/verify",
  verifyToken,
  asyncHandler(async (req, res) => {
    if (!isStripeConfigured()) {
      return res.status(503).json({ message: "Stripe is not configured" });
    }

    const sessionId = String(req.query.session_id ?? "").trim();
    if (!sessionId) {
      return res.status(400).json({ message: "session_id is required" });
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    // A user must never be able to verify someone else's session
    if (session.metadata?.userEmail !== req.user.email) {
      return res.status(403).json({ message: "This payment is not yours" });
    }

    const result = await finalizePayment(session);
    if (!result.paid) {
      return res
        .status(402)
        .json({ message: "Payment is not completed yet", paid: false });
    }

    res.json({ paid: true, plan: "pro", payment: result.payment });
  })
);

// GET /payments/my  -> a user's own Pro receipts
router.get(
  "/my",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { payments } = collections();
    const items = await payments
      .find({ userEmail: req.user.email })
      .sort({ paidAt: -1 })
      .toArray();
    res.json(items);
  })
);

/* ------------------------------------------------------------------ */
/* Webhook (registered in index.js BEFORE express.json)                */
/* ------------------------------------------------------------------ */

export async function stripeWebhook(req, res) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ message: "Stripe webhook is not configured" });
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res
      .status(400)
      .json({ message: `Webhook signature failed: ${error.message}` });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      await finalizePayment(event.data.object);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("Webhook handling failed:", error.message);
    res.status(500).json({ message: "Webhook handling failed" });
  }
}

export default router;
