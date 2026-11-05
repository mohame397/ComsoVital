# Supabase account and private health storage

This directory contains an initial, additive database migration for CosmoVital. It does not create a hosted Supabase project, configure email delivery, or connect the current public website automatically. No real Supabase project credentials were available during implementation.

## Setup in a new project

1. Create a Supabase project in your own account and choose an appropriate database region.
2. Open **SQL Editor** and apply `migrations/202611030001_private_health_workspace.sql`. The migration creates the private tables, owner policies, validation helpers and authenticated RPCs. Review it before application. It is intended for a new project; do not apply it blindly over unrelated existing tables with the same names.
3. In **Authentication → Providers → Email**, enable email/password registration and email confirmation. Configure an adequate password policy (the application requires 12–128 characters for new passwords). Configure production SMTP and the provider's email rate limits before public use; the provider's default email service is limited.
4. In **Authentication → URL Configuration**, set the application's canonical HTTPS address, for example `https://cosmo-vital.vercel.app/`. Add only your actual application URL and approved development URLs to the redirect allowlist. Verification returns to the application; recovery returns with `?auth=recovery#reset-password`.
5. Copy the **Project URL** and **publishable key**, or the legacy **anon** key. These are public client settings, protected by authentication and RLS. Never put a secret or `service_role` key in the static application or its environment configuration.
6. Configure `COSMOVITAL_SUPABASE_URL`, `COSMOVITAL_SUPABASE_PUBLISHABLE_KEY` and `COSMOVITAL_SITE_URL` in the deployment environment, then run `node scripts/build.mjs` (Node.js 22+) and redeploy. The generated `dist/config.js` contains `supabaseUrl`, `supabasePublishableKey` and `siteUrl` only.
7. Register and verify two real test accounts. Log in separately and confirm that profiles, observations, alerts, cases and consultation packets are isolated. Verify password recovery, logout and explicit account deletion on disposable accounts before production use.

Do not mark hosted account flows as tested merely because the SQL and adapter tests pass. Actual GoTrue/email delivery, URL configuration, project policies, deployment configuration and two-device behavior require the configured project.

## Tables and ownership

- `profiles`: account profile keyed by the authentication UUID. Display names are labels, not identifiers. Only permitted profile columns may be updated.
- `health_observations`: preserves the existing observation group key so case links survive migration. Holds the actual measurement time, server creation time, source, context, metadata, notes and symptoms.
- `health_readings`: one numeric metric per row, each with its own UUID, owner UUID, group key, measurement timestamp, server creation timestamp and server-derived unit.
- `daily_checkins`: derives sleep, mood, energy and symptom context from submitted observations; no missing measurement is invented. Dates use the account's valid timezone preference, falling back to UTC.
- `health_alerts`: persisted reference prompts and informational messages, with acknowledgement distinct from resolution. Alert snapshots can retain a deleted observation's historical identifier; deleting a measurement does not declare a concern resolved.
- `medical_review_requests`: saved consultation snapshots and honest preparation/export states. It has no doctor-delivery integration.
- `workspace_state`: private case/consultation state and a revision number for conflict detection.

Every private table has owner-only read RLS. Ordinary clients cannot write health tables directly; authenticated mutation RPCs validate the complete snapshot and derive the owner from `auth.uid()`. Clients cannot choose a different owner or forge server creation times. Sensitive rows are never exposed through an anonymous read policy.

## RPC contract

`load_health_workspace()` returns `{records, missionState, profile, alerts, revision}` for the authenticated caller. Canonical observations retain the legacy `timestamp` alias alongside `measured_at`, `created_at`, `user_id` and a `readings` array identifying each metric row.

`save_health_workspace(p_records, p_mission_state, p_alerts, p_expected_revision)` validates and atomically replaces the caller's current workspace. A stale revision raises SQLSTATE `40001`; the client must reload and review the latest data before retrying. It must not silently overwrite another device's newer snapshot.

`delete_my_account()` deletes only `auth.uid()` and cascades the caller's private records. The application requires explicit confirmation before calling it. No service-role key is required in the browser. There is no automatic production migration or account deletion in the packaging process.

Server bounds check supported units and input plausibility, not clinical normal ranges. The SQL does not assign medical severity or diagnose a condition. The existing, source-attributed educational rules remain subject to clinical review before operational medical use.

## Sessions and limited connectivity

The official Supabase JavaScript client manages passwords and session refresh. The application stores no password and includes no privileged server key. The SDK may persist authentication material in browser storage; use trusted devices, protect the browser against unauthorized access, and sign out on shared devices.

Configured account health data is kept in application memory rather than a persistent browser PHI cache. A server save is confirmed only after the RPC succeeds. Offline cloud writes are rejected without claiming synchronization. Existing anonymous browser records are not assigned to a newly logged-in account automatically; migration requires explicit import intent.

On logout, local SDK authentication storage and private application memory are cleared. If network revocation fails, the interface must not claim the server confirmed revocation. A previously authorized session on another device is a separate session.

## Tests

Database tests under `tests/` target two distinct authenticated user identities inside a rollback transaction. A local PostgreSQL harness may provide a minimal `auth.users`/`auth.uid()` stub to test SQL policies and RPCs; that is not a substitute for testing a real Supabase authentication deployment.

The adapter tests in `../tests/cloud.test.mjs` inject a provider double. They test session/ownership boundaries, stale-response rejection, explicit server-confirmed saves, conflict propagation and logout cleanup. They do not claim to send emails, authenticate a real Supabase user or exercise a hosted database.
