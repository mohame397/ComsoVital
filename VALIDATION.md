# Validation — 31 October 2026

## Automated data checks

`npm test` passes all ten assertion groups in `tests/core.test.mjs`: numeric/unit bounds, timestamps, paired pressure, JSON/CSV validation, CSV quoting and formula protection, imported provenance, deduplication, blood-pressure OR logic, pulse/oxygen/temperature screening, and CSV export round-trip source handling.

`node --check` passes for application, core data engine and service worker.

`python scripts/prepare-research.py` reproduces research JSON from the unmodified original CSV: 481 rows, 0–480 seconds; 13 missing oxygen observations retained as null. SHA256 and computed descriptive statistics are recorded in the research JSON.

## Browser checks

29 checks passed in real Chromium via Playwright, with no application runtime errors:

- Empty initial personal record, actual manual entry, and persistence after reload.
- Rejection of an unpaired pressure reading.
- Notes rendered as text, including HTML-like test input; no script execution.
- CSV provenance export and duplicate-free re-import.
- Immediate urgent-reading review and retention of earlier per-metric alerts after partial check-ins.
- Keyboard interaction for body markers and persistent daily routine checkboxes.
- Research explorer:481 heart-rate observations,468 valid oxygen observations; no artificial missing-value filling.
- Offline reload of research, application and saved records after service-worker setup.
- All six sections at390px width in English and Arabic with no page-level horizontal overflow; Arabic RTL confirmed.

Screenshots were visually inspected at1440px desktop and390px mobile. Browser test fixtures are isolated temporary test-context observations and are not shipped as personal records.

`qa/smoke-test.mjs` requires an external Playwright installation and a running server at localhost:8080; it is not a runtime dependency. Install Playwright locally or set PLAYWRIGHT_MODULE to its entry-point path. Chromium must be available at /usr/bin/chromium for the supplied runner.

## Scope of verification

This verifies a personal observation app, not clinical safety, diagnostic performance, real wearable connectivity, user identity, astronaut-specific limits, or operational medical certification. Publishing success is verified separately by the Sites deployment result.


## Version 1.1 — 1 November 2026

15 additional guidance regression cases cover symptom overrides, unknown answers, oxygen/BP/temperature boundaries, historical measurements, emergency priority, conditional rechecks, medication exclusions and distinct breathing/unresponsive pathways. These are software tests, not clinical validation.

21 additional Chromium browser checks passed for version1.1: emergency-first display, no false clearance for unknown symptoms, selected dated observation, low-oxygen immediate escalation, no pressure-delay advice during emergencies, handover download, duplicate urgent observations preserving valid links, conditional BP repeat, symptom override, distinct recovery guidance, Arabic RTL/mobile ordering and no page overflow, offline module and symptom checks, no persisted symptom answers, and no runtime errors. See qa/guidance-results.json.
