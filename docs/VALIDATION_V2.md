# CosmoVital 2.0 validation — 2026-11-03

All checks below ran against the final buildless static application in an isolated local Chromium profile. Fixtures were labeled QA and are not shipped as operational records. There were no application runtime errors or external requests from the tested workflows.

| Check | Passed |
|---|---:|
| Core validation/import/provenance | 14 |
| Source-linked interim guidance | 15 |
| Quality context and period comparison | 11 |
| Case/consultation state and corrupt-storage recovery | 11 |
| Isolated training workflow | 9 |
| Stale cross-tab modal target regressions | 5 |
| Existing application browser workflows | 29 |
| Interim guidance browser workflows | 21 |
| Version 2 case, packet, backup, comparison, training, EN/AR mobile | 56 |
| Version 2 service worker, offline continuity and Arabic mobile | 20 |

**65 logic tests and 126 browser checks passed.** Node's file-level test aggregation reports six test files; direct execution reports the individual logic test counts above.

## Verified behavior

Actual saved observations retain metadata and legacy compatibility. Cases have dated events and explicit linked records. Linked-record deletion is blocked at both confirmation stages. Case and packet forms bind to the original identifier, preventing another tab's workspace restore from redirecting an open form into a different case.

Consultation snapshots preserve their payload while later case notes change. Preparation, download and user-declared external sharing never establish transmission or delivery. UTF-8 packet sizes are computed from actual serialized bytes.

Full workspace backups round-trip observations, cases and consultation snapshots. Invalid JSON, duplicate case/observation identifiers and broken links reject before writes. Explicit validated restoration can replace corrupt current mission storage. Empty workspace restoration is supported. Storage-write failure attempts rollback; browser storage is not a cross-key crash-safe database.

Period comparisons use selected nonoverlapping dates and actual observations, expose raw points, preserve missingness and show contextual limitations. The three training scenarios finish, provide corrective feedback, do not write health/workspace storage, and disappear on reload.

Cached version 2 modules, cases, packets and Arabic views survived offline reload after a successful initial cache. Mobile layouts and relevant forms fit a 390px viewport in English and Arabic.

## Re-run

Run `npm test`. For browser checks, serve `dist/` on localhost:8080, provide an installed Playwright module using `PLAYWRIGHT_MODULE`, and run `qa/smoke-test.mjs`, `qa/guidance-browser.mjs`, `qa/v2-workspace.mjs` and `qa/v2-offline.mjs`. The scripts use `/usr/bin/chromium` (the v2 scripts also support `CHROMIUM_PATH`). Results are in the matching `qa/*results.json` files.

## Review images

- [Desktop case workflow](screenshots/v2-case-desktop.png)
- [Arabic mobile case workflow](screenshots/v2-case-ar-mobile.png)

## Limits

These tests establish tested software behavior, not clinical validation, sensor accuracy, browser universality, disaster-proof storage, NASA endorsement or competition eligibility. Manual observations and imported files remain unverified. Public site access does not provide shared patient records, cloud synchronization or clinician messaging. The actual BIDMC dataset is a separate terrestrial research recording, not astronaut data. Training contains no clinical readings.
