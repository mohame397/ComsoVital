# CosmoVital Frontend — Test Notes

Date: October 30, 2026.

Automated headless Chromium checks were performed with the supplied HTML, CSS and scripts loaded into an isolated browser test page. The container prevented browsing localhost and file:// addresses directly, so this is **not a substitute for launching the extracted project with VS Code Live Preview**.

Passed:
- `node --check` on integration and both teammate JS modules.
- No duplicate IDs in `dashboard.html`.
- Required chart canvas selectors (5) and alert list selectors present.
- Updating a demo sample changes heart rate from 76 to 82.
- Reset changes heart rate back to 76.
- Submitting check-in with 88 bpm and 120/80 mmHg changes dashboard and recorded summary.
- Request crew review creates one locally displayed active alert.
- Loading example alerts displays active and resolved cases.
- Simulate resolution updates an existing alert instead of duplicating it.
- No JavaScript exceptions during scripted interaction.
- No horizontal overflow at 390px mobile width or 1440px desktop width in tested pages.
- Local canvas fallback renders all five charts in the simulated offline environment.

Not tested / future work:
- Exact appearance with remote Google Fonts or Chart.js (external connectivity unavailable during testing).
- Actual local-server module importing on the user's machine (use Live Preview).
- NASA datasets, backend API, medical thresholds, real astronaut measurements, operational notifications.
