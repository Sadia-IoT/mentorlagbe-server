# MentorLagbe — Server (Express + MongoDB)

MentorLagbe is a role-based tuition & mentorship marketplace. Students find verified
tutors by subject, class level, mode and budget; tutors publish tuition batches and
manage applications; admins moderate listings, users and Stripe revenue.

This repository is the **REST API** (Node.js + Express + MongoDB) that powers the
Next.js client. Authentication is handled by **Better Auth** on the client: every
protected request carries a Better Auth **JWT** which this server verifies against
the client's JWKS endpoint.

- **Live API:** `https://mentorlagbe-server-five.vercel.app`
- **Client live site:** `https://mentorlagbe-client-cyan.vercel.app`
- **Server repo:** `https://github.com/Sadia-IoT/mentorlagbe-server`
- **Client repo:** `https://github.com/Sadia-IoT/mentorlagbe-client`

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 18+ (ES Modules) |
| Framework | Express 4 |
| Database | MongoDB Atlas (`mongodb` driver, no ODM) |
| Auth | Better Auth JWT verified with `jose` + remote JWKS |
| Payments | Stripe Checkout + Webhook |
| Media | ImgBB API (server-side proxy upload) |
| Deployment | Vercel (`vercel.json`, serverless handler) |

## Collections (logical design)

| Collection | Purpose |
| --- | --- |
| `users` | Better Auth accounts + `role`, `plan`, `phone`, `bio`, `image`, `bookmarks[]` |
| `tuitions` | Tuition batches / 1-on-1 mentorship posts with `approvalStatus`, `isActive` |
| `applications` | Student applications + tutor decision + optional student `review` |
| `payments` | Stripe Pro subscription receipts |

> Better Auth also creates its internal `session`, `account` and `verification`
> collections — that is part of the auth stack, not business data.

## Key features

- Public browse API with **server-side search, filters and pagination** (`skip`/`limit`)
- Latest **6 featured tuitions** for the landing page + filter facets endpoint
- Role middleware chain: `verifyToken` → `verifyStudent` / `verifyTutor` / `verifyAdmin`
- Tutor CRUD on tuitions, **Free plan limited to 2 posts**, Pro unlimited
- Student applications with **duplicate protection** (unique index + API guard)
- Tutor accepts/rejects applicants; accepted students can leave a **1–5 star review**
- **Bookmarks** for students (Free: 5, Pro: unlimited)
- **Stripe Checkout** for Pro Tutor ($15) / Pro Student ($10) + webhook + session verify
- **ImgBB upload proxy** so the API key never reaches the browser
- Admin user management, tuition moderation and transaction reports
- Dashboard statistics endpoints for student / tutor / admin
- Central error handler, CORS allow-list, health check, 404 JSON

## API overview

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/` | public (health) |
| GET | `/tuitions` | public — `search, subject, classLevel, mode, page, limit` |
| GET | `/tuitions/featured` | public |
| GET | `/tuitions/filters` | public |
| GET | `/tuitions/:id` | public (includes tutor summary + reviews) |
| GET | `/tuitions/my/list` | tutor |
| POST | `/tuitions` | tutor (Free: max 2) |
| PATCH | `/tuitions/:id` | tutor (sends back to `pending`) |
| PATCH | `/tuitions/:id/toggle` | tutor |
| DELETE | `/tuitions/:id` | tutor |
| POST | `/applications` | student |
| GET | `/applications/my` | student |
| DELETE | `/applications/:id` | student (pending only) |
| POST | `/applications/:id/review` | student (accepted only) |
| GET | `/applications/reviews/:tuitionId` | public |
| GET | `/applications/tutor` | tutor |
| PATCH | `/applications/:id/status` | tutor |
| GET | `/users/me` | logged in |
| PATCH | `/users/me` | logged in |
| GET | `/users/me/bookmarks` | student |
| POST | `/users/me/bookmarks/:tuitionId` | student (toggle) |
| GET | `/users` | admin |
| PATCH | `/users/:id/role` | admin |
| GET | `/admin/tuitions` | admin |
| PATCH | `/admin/tuitions/:id/status` | admin |
| GET | `/admin/transactions` | admin |
| GET | `/stats/public` | public |
| GET | `/stats/student` \| `/stats/tutor` \| `/stats/admin` | matching role |
| POST | `/payments/checkout` | student / tutor |
| GET | `/payments/verify?session_id=` | student / tutor |
| GET | `/payments/my` | logged in |
| POST | `/payments/webhook` | Stripe (raw body) |
| POST | `/upload/image` | logged in (multipart `image`) |

## Environment variables

Copy `.env.example` → `.env`:

```env
PORT=5000
CLIENT_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://...
DB_NAME=mentorlagbe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
IMGBB_API_KEY=...
BETTER_AUTH_URL=http://localhost:3000
```

## Run locally

```bash
npm install
npm run dev      # nodemon src/index.js
# or
npm start
```

Smoke test the public API:

```bash
npm run smoke
```

## Deploy (Vercel)

1. Import the repository, framework preset **Other**.
2. Add every variable above in *Project → Settings → Environment Variables*.
   `CLIENT_URL` must be the deployed client origin (comma separated if more than one).
3. Stripe webhook endpoint: `https://<server-domain>/payments/webhook`
   event: `checkout.session.completed` (and optionally `checkout.session.async_payment_succeeded`).

## Seed data

Connected demo data (admin, 6 tutors, 6 students, 12 approved tuitions, applications,
reviews, payments) is generated from the client repo:

```bash
cd ../mentorlagbe-client
npm run seed
```
