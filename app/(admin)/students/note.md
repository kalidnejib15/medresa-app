I haven't done a full pass on everything — here's a prioritized list for another Claude session to pick up, with a note on why each one matters:

**High priority — money/safety-critical, untouched so far**

1. **`services/api/src/services/financeService.ts`** — `settleOrder()` does multiple sequential `User.findByIdAndUpdate`/`Order.findByIdAndUpdate` calls (merchant balance, rider balance, payment status) with **no MongoDB transaction/session** wrapping them. If one write fails partway through, money can end up credited to one side but not debited from the other. Every other money-moving flow we fixed (`collectCashFromRider`, `verifySettlement`, `requestPayout`) uses `session.startTransaction()` — this one doesn't. Worth checking whether that's intentional or an oversight.

2. **`services/api/src/controllers/incidentController.ts` → `createIncident`** — we only patched `resolveIncident` in this file. The SOS-creation path itself (who can create an incident, what validation exists, whether a rider can spoof `type: 'SOS'` for someone else) hasn't been swept with the same ownership lens.

3. **`apps/mobile-rider/components/dashboard/SOSButton.tsx`** and **`app/profile/safety/emergency.tsx` / `incident.tsx`** — the client side of the incident/SOS flow above. Worth checking whether the SOS payload trusts any client-supplied identity fields the server shouldn't.

4. **`services/api/src/index.ts`** — two things worth a second look: `io` is configured with `cors: { origin: '*', credentials: true }` (that combo is normally rejected by browsers and is a red flag if it ever does get honored somewhere); and there's duplicated route mounting (`/api/v1/...` and `/api/...` both registered, plus a path-rewrite shim for just `user`/`orders`) that's messy enough to hide a gap if the two mounts ever drift out of sync.

**Medium priority — not reviewed at all yet**

5. **`services/api/src/routes/userRoutes.ts`** — no `userController.ts` exists in this zip, so its handlers are presumably inline in the routes file or imported from somewhere not yet seen; this owns `/api/user/me` and `push-token`, both used by the rider app on every launch.
6. **`services/api/src/lib/notifications.ts`** and **`sms.ts`** — push/SMS dispatch, unreviewed.
7. **`apps/mobile-rider/lib/tokenCache.ts`** — how the Clerk token is cached/persisted on-device; worth checking storage mechanism (SecureStore vs plain AsyncStorage) given it's the credential the whole API trusts.
8. **`apps/web-dashboard/src/pages/auth/SignUpPage.tsx`** — the merchant-side equivalent of the `register.tsx` fix; worth confirming it doesn't accidentally send a `RIDER` hint or nothing at all.
9. **`apps/web-dashboard/src/components/layout/AdminLayout.tsx`** — client-side route gating for admin-only pages (real security is server-side, but worth checking it doesn't leak admin UI/data before the API call resolves).
10. **`services/api/src/models/*.ts`** (`User.ts`, `Order.ts`, `RiderProfile.ts`, `Payout.ts`, `Transaction.ts`) — schema-level checks: unique indexes, default values, required fields — none of these have been read yet.

**Lower priority / dev-only, skim only**

11. `services/api/src/scripts/*.ts` and `services/api/scratch/*.ts` (`fixUserRole.ts`, `promote-rider.ts`, `remove_rider.ts`, etc.) — one-off maintenance scripts, not part of the running API, but worth a glance in case one of them is accidentally wired into a route.

That's the honest state of what's left unchecked in this codebase from what was in the zip.










Based specifically on what's actually in this codebase (not generic checklist advice), here's what's missing before I'd call this production-ready:

**1. No automated tests anywhere.** I haven't seen a single `.test.ts`, `.spec.ts`, or test runner config across the entire archive. For a system moving real money (`financeService.ts`, `Payout`, `Transaction`) and running physical safety infrastructure (SOS/incidents), shipping without test coverage on those two areas specifically is the biggest gap. Every bug we found this session was found by manual reading — that doesn't scale, and it means regressions won't be caught automatically either.

**2. `settleOrder()` isn't atomic.** Flagged this earlier — it does several sequential, unguarded writes (merchant balance, rider balance, order payment status) with no MongoDB transaction, while its sibling functions (`collectCashFromRider`, `verifySettlement`, `requestPayout`) all correctly use `session.startTransaction()`. A crash mid-function here means money moves on one side and not the other, with no automatic way to detect it.

**3. Settlement verification is manual and trust-based, not integrated.** `requestSettlement`/`verifySettlement` rely on a rider uploading a screenshot and typing in a reference ID, which a merchant then eyeballs and approves. There's no actual Telebirr/payment-gateway API call verifying the transaction happened. That's fine for a pilot with a handful of riders a merchant knows personally; it doesn't hold up once volume grows or trust between merchant and rider breaks down.

**4. `tmp/wipe_db.cjs` sitting at the repo root.** A database-wipe script bundled in the deployable tree is a real risk if it ever ends up reachable in a production build or CI step — same class of danger as `debugClearAllOrders`, except that endpoint at least has a `NODE_ENV === 'production'` guard baked in. This script has no such guard because it's not gated by anything at all; it's just a file that exists.

**5. Socket.IO CORS is wide open.** `origin: '*'` combined with `credentials: true` in `index.ts` — that combination is actually invalid per the CORS spec and browsers will reject it, but it signals the CORS policy was never tightened to your actual frontend domain(s). Needs to be an explicit allowlist before production.

**6. Rate limiting is inconsistent.** Only three routes get `strictLimiter` (`rider-onboarding`, `upload-proof`, `settle-request`) plus a global limiter and the accept-order limiter. Nothing rate-limits `location-update` on the socket (a rider's app pings every 5 seconds by design, but nothing stops a malformed/malicious client from flooding it), and nothing limits repeated failed webhook signature attempts.

**7. No audit trail for sensitive admin/merchant actions.** There's no `AuditLog`-style model anywhere in `models/`. Role changes, payout approvals/rejections, incident resolutions, settlement verify/reject — none of these leave a "who did this and when" record beyond the mutation itself. If a dispute happens (a rider claims their payout was wrongly rejected), there's nothing to reconstruct the decision trail.

**8. No visible error monitoring/alerting.** Logging is via `pino` to presumably stdout — I don't see a Sentry/Datadog/equivalent integration anywhere, which means the `settlementFailed` flag we saw being set in `updateOrderStatus`'s error handling (a genuinely good defensive pattern) has nowhere to actually page anyone. A flag nobody looks at doesn't get manually reconciled.

If I had to rank these by "would actually cause harm in the first month of real usage": **#2 (non-atomic settlement) and #4 (the wipe script) first**, **#1 (no tests) as the thing that lets everything else regress silently**, and the rest as important-but-second-wave.