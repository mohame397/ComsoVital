# Connected configuration update

This package now includes the user-provided public Supabase configuration. See [خطوات تفعيل النسخة المرتبطة](docs/CONNECTED_SETUP_AR.md). Previous unconfigured-state test reports describe the original v3 release; the connected smoke check is qa/connected-results.json. Vercel has not been redeployed. No actual user signup, email delivery or authenticated database save has been performed.

# CosmoVital 3.0 — account-ready upgrade

[دليل تشغيل الحسابات والنشر](docs/V3_SETUP_AR.md) · [Implementation report](docs/V3_IMPLEMENTATION_REPORT.md) · [Executed verification](docs/VALIDATION_V3.md)

This release preserves the existing static application. Cloud configuration is intentionally blank: local mode works, while real account registration and remote saving require the Supabase setup described above. No real hosted auth or Vercel deployment is claimed. Node.js 22+ is required for `npm ci`, `npm run build` and tests; prebuilt dist runs on a static server.

# CosmoVital 2.0.0 — Crew Health Workspace

An Arabic/English static web application built from the supplied CosmoVital project. Record actual observations, review source-linked guidance, and organize follow-up locally.

[دليل الإصدار ٢ بالعربية](docs/V2_GUIDE_AR.md) · [Version 2 user guide](docs/V2_GUIDE_EN.md) · [Scientific screening notes](docs/SCREENING.md) · [Arabic project pitch](docs/PITCH_AR.md)

## Run locally

No build or dependency installation is required to run the application. Install Python 3, extract the **complete project** ZIP, open a terminal in the folder containing this README, and run:

```sh
python -m http.server 8080 --directory dist
```

Open <http://localhost:8080>. Keep the server running while using the site. Opening `index.html` directly as a file does not reliably support ES-module imports. Offline support requires a successful initial load/cache and Service Worker support on localhost or HTTPS.

For the **standalone web** ZIP, extract all files, open a terminal in its folder containing `index.html`, and run:

```sh
python -m http.server 8080
```

Open <http://localhost:8080>. Keep all subdirectories beside `index.html`; the HTML file alone is not the application.

## New in version 2

- **Local cases:** explicitly select linked observations, add follow-up notes and observations, and retain event chronology. `open`, `follow-up`, `awaiting-review`, and `archived` describe workflow; none establishes medical resolution. Saving symptom answers in a case requires explicit opt-in.
- **Measurement-quality metadata:** record known device, method, repeat, signal, glucose-timing, and temperature-site details. Missing information stays missing; no invented confidence score or device verification is claimed.
- **Two-period comparison:** select nonoverlapping periods to compare actual counts, means, ranges, and the mean difference. Results are descriptive, not a clinical baseline or proof of improvement.
- **Consultation packets:** create JSON snapshots of linked observations, retained symptoms, questions, and case events. Local stages are `draft`, `prepared`, `exported`, and `external-sharing-recorded`. The last is a user declaration, not verified delivery. Packet size uses the generated file's actual byte count.
- **Isolated training:** three labeled workflow scenarios with fixed hypothetical communication delays of 0, 12, or 20 minutes, determined by the selected scenario. There is no separate delay control, clinical reading, patient, or live Earth connection. Training choices never create operational observations or cases.

Existing manual/imported observations remain in their current browser. This release does not infer missing metadata for older records.

## Core capabilities

- Manual observation logging with strict validation and local browser persistence.
- CSV/JSON import with atomic validation, provenance labels, and duplicate removal.
- Trends, educational body systems, daily routines, and source-linked review prompts.
- Interim guidance, current warning-symptom questions, and clinician-handover exports.
- CSV/JSON observation exports, full workspace backup/restore for observations plus cases and consultation packets, and browser Print / Save as PDF reports.
- A separate explorer for an actual published physiological recording.
- Self-hosted images and fonts; responsive English/Arabic interface and keyboard support.

**Use for personal observation recording, organization, demonstration, and training. This is not a clinically validated medical device, diagnosis service, or operational astronaut medical system.** No wearable stream, clinical backend, medical AI, or validated flight treatment protocol is represented. Preparing or exporting a packet does **not** contact a clinician, send a message, establish an affiliation, or confirm receipt or review. Any external sharing is performed by the user outside the application.

## Local storage, privacy, and backups

The site can be public while individual observations, cases, and consultation packets remain in each user's browser. There is no cloud synchronization. Sharing a site URL does not share personal observations, and opening it on another device does not retrieve them. Local storage is not independently encrypted by this application.

Clearing site data, changing browser/device, moving to a new hostname, or using a private session may lose local data. Before migration, choose **Full workspace backup** in the export dialog, or **Backup workspace / Download backup** in Cases or Consultations. This JSON includes observations, cases, and consultation packets. Check it and keep it outside the site's browser storage.

On the destination, open Cases or Consultations, choose **Restore backup**, select the workspace JSON, and review the explicit confirmation before replacing the current workspace. Restore replaces the current observations/case/packet workspace rather than merging it; back up the destination first if it contains data you need. Ordinary observation-only CSV/JSON import does not restore cases or consultation packets.

No user's personal observations, case notes, symptoms, or consultation packets are shipped in the project download. Training state and test-browser state are not production patient records and are not bundled as personal observations.

## Data and scientific attribution

Operational observation records start empty. Enter measured observations truthfully; label demonstration input as such.

The included BIDMC recording is actual deidentified **ground hospital research data, not astronauts or a healthy reference population**. It is intentionally supplied as a separate research asset, never merged into personal observations. The original CSV is unmodified; its JSON transformation and source hash are reproducible, and missing values remain null. See `dist/data/ATTRIBUTION.txt` and `dist/data/research.json`.

- [BIDMC v1.0.0](https://physionet.org/content/bidmc/1.0.0/) — Open Data Commons Attribution v1.0.
- [NASA's five hazards of human spaceflight](https://www.nasa.gov/hrp/hazards/) — educational context, not a live astronaut medical feed.
- Earth photography credit and metadata: `dist/assets/earth-credit.json`.
- Manrope and Noto Sans Arabic: self-hosted under the SIL Open Font License; notices in `dist/assets/*-OFL.txt`.

## Checks and reproducibility

Use Node.js 20 or newer for the tests; no dependency installation is needed:

```sh
npm test
```

Rebuild the research JSON from the included original CSV without network access:

```sh
python scripts/prepare-research.py
```

Software tests do not establish clinical validation. Competition eligibility and rules for prior work must be checked separately against the current participation terms.

## Build downloadable packages

From the complete project root, generate **Complete first, then Web**:

```sh
python scripts/package-source.py
python scripts/package-web.py
```

The Web packager requires the Complete archive and checks that it contains no nested ZIPs before including it.

These create copies in both `dist/` and `/workspace/shared/`:

| Archive | Contents | Local/hosting root |
|---|---|---|
| `CosmoVital-Complete.zip` | Source, documentation, tests, scripts, archived supplied frontend, and static application under `CosmoVital/` | `CosmoVital/dist/` |
| `CosmoVital-Web.zip` | Deployable application with `index.html` directly at the archive root, plus `CosmoVital-Complete.zip` for the source-download link | Extracted directory containing `index.html` |

The Complete archive excludes every ZIP. The Web archive contains exactly one ZIP at its root: `CosmoVital-Complete.zip`. It excludes itself and every other ZIP, and verifies that Complete has no nested ZIPs. This prevents recursive packaging while keeping the source-download link working after independent hosting.

## Static hosting

Upload the entire standalone package contents to a static host such as Netlify or Vercel. Alternatively, use the complete project with **no build command** and `dist` as the publish/output directory. For hosts that expect `index.html` at the upload root, use the standalone package or upload only the contents of `dist/`.

Preserve relative paths for modules, `assets/`, and `data/`. Serve JavaScript, JSON, CSS, and the Service Worker with appropriate MIME types. Use HTTPS in production; an ordinary static HTTP server is sufficient for localhost development. No server-side database, environment secrets, or API keys are required. An independent deployment gets a different browser-storage origin; export backups before moving.

The source package includes only `.openai/hosting.example.json` as an identity-free example. Do not reuse an existing Sites project ID for a new project.

## Project structure

- `dist/`: complete static application, modules, research data, and assets.
- `tests/`: regression checks for validation, import, provenance, screening, guidance, and mission workflows.
- `scripts/`: reproducible research transformation and package generation.
- `docs/`: bilingual v2 handoff, Arabic project notes, and scientific rule documentation.
- `original/`: supplied integrated frontend preserved for reference; its generated demo readings are archival and are not operational observation records.

No secrets, private operational records, or test-browser storage are included in either package.
