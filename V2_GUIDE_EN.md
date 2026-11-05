# CosmoVital 2.0.0 — User and Handoff Guide

CosmoVital is an Arabic/English workspace for recording health observations, understanding trends, and organizing follow-up. Version 2.0.0 adds five capabilities: local case management, measurement-quality metadata, two-period comparison, exportable consultation packets, and training isolated from operational records.

Use it for observation logging, organization, demonstration, and training. It has not been clinically validated and does not represent an approved medical device or an operational astronaut medical system. Review guidance is not a diagnosis or prescription; medical decisions belong to the clinician and the applicable mission protocol.

## Quick start

1. Open the site and choose your language and workspace settings.
2. Log an actual measurement with its time, units, and context. Leave unmeasured fields blank.
3. Add device and method information when known; do not invent quality observations.
4. Review trends and guidance. Open a follow-up case when you need to document and track a concern.
5. Export a **Full workspace backup** containing observations, cases, and consultation packets before changing device or hosting origin.

Existing manual and imported observations remain in the same browser. Older observations without quality metadata remain without it; the application does not invent device or quality information retroactively.

## 1. Cases and event chronology

A case brings together the observations and notes the user selects. Open a case and **explicitly select the intended observation**; do not assume the latest observation is automatically the relevant one. State the reason for follow-up, then attach later observations and add notes as needed.

The event chronology helps review what was recorded and changed. It is an application-local history, not a centralized or tamper-proof medical audit log.

| Organizational status | Meaning |
|---|---|
| `open` | A follow-up topic has been opened. |
| `follow-up` | The user is collecting further observations or notes. |
| `awaiting-review` | The user is waiting for review outside the application. |
| `archived` | The case has been removed from the active list for organization. |

**Archiving a case or acknowledging an alert does not establish recovery or resolution of a health concern.** Awaiting review does not mean anything has reached a clinician.

Answering symptom questions in the help flow does not by itself make them a permanent record. To retain them in a case, explicitly opt in to saving/attaching symptoms and review what will be stored. Cases can contain sensitive symptoms and free-text notes; handle their exports accordingly.

## 2. Measurement-quality metadata

You can document information such as the device or measurement method, technique, whether a repeat was taken, and signal-quality observations. Record glucose timing relative to food and temperature measurement site when applicable.

These are user-entered facts. They do not prove device calibration or measurement validity, and they do not turn a manual observation into a sensor stream. The application does not generate a fabricated confidence percentage. Leave unknown information unspecified.

For useful review, record the device name when known, the method, and relevant circumstances. Record an actual repeat as a later observation with its real timestamp when appropriate. Do not silently compare oral and underarm temperatures, or fasting and post-meal glucose, as if their conditions were identical.

## 3. Comparing two periods

Choose a metric and two explicit **nonoverlapping** date periods. Compare actual observations in the same units, and review differences in context or measurement method between the periods.

The comparison shows the actual available count, mean, minimum, maximum, and difference between period means. It does not fill empty days with predicted values or generate observations to complete a chart. If either period lacks sufficient observations, collect more observations rather than assuming a result.

The difference is a descriptive calculation for the selected samples. It does not establish clinical improvement or deterioration and does not create a personal medical baseline. Different sample counts, timing, activity, and devices may explain part of the difference.

## 4. Consultation packets

A consultation packet is a JSON file containing a **snapshot at preparation time** of linked case observations, the questions and symptoms chosen for retention, and follow-up events. Review the contents before exporting. If information changes after preparation, create an updated packet; a downloaded file cannot update itself.

| Local stage | What it establishes |
|---|---|
| `draft` | Content is being assembled. |
| `prepared` | A version has been prepared for review or export. |
| `exported` | An export action was recorded in the application. |
| `external-sharing-recorded` | The user stated that they shared it outside the application. |

**None of these stages proves transmission, delivery, reading, or clinician review.** Share the file yourself through a suitable external channel if desired, then accurately record what you did. The application does not contact a ground center or clinician and does not send health records automatically.

Packet size is the actual byte count of the generated file. It is not a connectivity test or transmission-time estimate. No simulation is presented as a real Earth communication link.

## 5. Isolated training

Choose one of the three workflow-training scenarios. Its hypothetical communication-delay parameter is fixed at 0, 12, or 20 minutes according to the selected scenario; there is no separate adjustable delay input. Scenario screens and related timing are explicitly labeled **training**.

The delay is a hypothetical scenario parameter, not a measurement of a real network or an actual mission delay. The simulator contains **no clinical readings, patient, or patient-outcome model**. It practices workflow choices without creating operational observations or cases. Return to the operational workspace to record measurements you actually took.

## Data sources and interpretation

- **Personal observations:** manual or imported measurements with source and timestamp. Entry does not verify the device or the measured person's identity.
- **Space research:** NASA resources and published findings provide scientific and educational context, not a live medical feed.
- **Ground research recording:** the included public BIDMC file contains actual deidentified ground clinical data. It is not astronaut data or a healthy reference population. It remains in the research explorer and is not merged into personal observations.
- **Training:** clearly labeled, isolated workflow exercises with no clinical readings or patient; never represented as genuine observational data.

This release does not add cloud synchronization of measurements or an automatic watch/medical-device connection. Research attribution is retained in `dist/data/ATTRIBUTION.txt` and the application's source links.

## Privacy, backups, and migration

The site may be public, but observations, cases, and consultation packets are stored in **the individual browser**. Opening the same URL in another browser or on another device does not retrieve those records. Sharing the URL alone does not share your observations.

Clearing site data, moving to a different hosting origin, or using a private session can lose local records. Local storage does not encrypt them independently of the browser and device. Use an appropriate device and keep exported backups somewhere you trust.

Before browser changes or hosting migration:

1. Choose **Full workspace backup** in the export dialog, or **Backup workspace / Download backup** from Cases or Consultations. This JSON includes observations, cases, and consultation packets.
2. Check the backup and store it outside the site's browser storage. Record its filename and date. Separate consultation exports remain useful for sharing, but are not a substitute for a workspace backup.
3. On the destination, open Cases or Consultations and select **Restore backup**. Choose the workspace JSON and review the explicit replacement confirmation.
4. Restore replaces the current observations/case/packet workspace; it does not merge workspaces. Back up any existing destination data before confirming. Verify the restored observations, cases, and packets afterward.

An observation-only CSV/JSON backup and ordinary observation import do **not** restore cases or consultation packets. Use full workspace backup/restore when preserving linked follow-up history.

Personal health information is not uploaded to hosting automatically and is not added to the project source download.

## Running, hosting, and deliverables

The application needs no build or dependency installation to run. From the full project folder:

```sh
python -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. To run automated checks from the project root with Node.js 20 or newer:

```sh
npm test
```

The complete package includes source, documentation, tests, and the archived supplied frontend. The standalone site package places `index.html` at its root alongside the files required for hosting. Publish **all its contents**, preserving paths, rather than uploading `index.html` alone.

The static files can be hosted on services such as Vercel or Netlify, or any static HTTP server. For the complete package, select `dist/` as the publish directory. For the standalone package, use the directory containing `index.html` as the root. Use HTTPS for production. Do not reuse the existing Sites project identifier as the identity of a new independent project.

Application files work offline **after a successful initial load and cache** in a browser supporting Service Workers on localhost or HTTPS. Storage removal or an incomplete initial load may leave files unavailable offline. External references and sharing files outside the application require their own connectivity channel.

## Demonstration and verification

Start a demonstration with an actual measurement, or clearly disclose that an entry is only for demonstration. Open a case linked to it, add follow-up, compare two available periods, and export a consultation packet. Then open training to demonstrate its separation from operational observations.

Eligibility for a particular competition and its rules for prior work remain unresolved by this handoff. Check the current participation rules and accurately identify existing and newly added components. Passing software checks is not clinical approval.
