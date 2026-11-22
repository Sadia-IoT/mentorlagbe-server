/**
 * Public API smoke test — no auth needed.
 *   node scripts/smoke.mjs
 *   BASE_URL=https://your-server.vercel.app node scripts/smoke.mjs
 */
const base = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");

const checks = [
  { name: "health", path: "/", expect: 200 },
  { name: "browse tuitions", path: "/tuitions?limit=3", expect: 200 },
  { name: "featured tuitions", path: "/tuitions/featured", expect: 200 },
  { name: "filter facets", path: "/tuitions/filters", expect: 200 },
  { name: "public stats", path: "/stats/public", expect: 200 },
  { name: "protected route without token", path: "/applications/my", expect: 401 },
  { name: "unknown route", path: "/definitely-not-a-route", expect: 404 },
];

let failed = 0;

for (const check of checks) {
  try {
    const response = await fetch(`${base}${check.path}`);
    const ok = response.status === check.expect;
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${response.status}  ${check.name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ERR   ${check.name} — ${error.message}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
