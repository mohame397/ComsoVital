# Executed validation — CosmoVital 3

- 180 individual automated checks across 15 test files passed. Counts and files: qa/v3-unit-results.json. Authentication adapter and store boundaries use injected/mock providers; they are not live Supabase account tests.
- 149 integrated Chromium browser checks passed: qa/v3-results.json. These exercise actual local UI, historical timestamps, shared updates, chart ranges, metric-specific displays, editing/deletion, TSV preview/consent/deduplication, persistent alerts, cases/packets/training, unconfigured account states, English/Arabic widths390/768/1440, offline cached modules, and runtime/network errors. No external service was called.
- Applied the full migration to an isolated PostgreSQL17 Docker database with a small Supabase-compatible auth.users/auth.uid test harness. Executed supabase/tests/isolation.sql successfully and rolled back fixtures. Verified two owner identities cannot see each other's rows, ordinary direct health writes fail, RPC ownership is derived from auth.uid, server creation time differs from measured time, selected Cairo check-in date is honored, stale revision is rejected, and malformed metadata is rejected.
- Build executed using the pinned official Supabase SDK and esbuild. Public config remains intentionally empty. Static assets and ZIP integrity were checked at packaging.

## Not executed

No hosted Supabase project existed. Real signup/verification emails, provider password recovery, SMTP deliverability, hosted two-account sessions, live cross-device persistence and production account deletion were not tested. Vercel account access was unavailable, so https://cosmo-vital.vercel.app/ was inspected read-only and was not redeployed. Software tests do not provide medical validation or compliance certification.

## Re-run

`npm ci`, `npm test`, `npm run build`. Serve dist on localhost and run qa/v3-browser.mjs with PLAYWRIGHT_MODULE pointing to installed Playwright (Chromium at /usr/bin/chromium; CHROMIUM_PATH is supported). SQL test must run in a disposable database with auth.uid(), after the migration; never insert QA identities into a production health project.
