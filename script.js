import { createHealthCharts } from "./health-charts.js";
import { HealthAlertManager } from "./alert-manager.js";

const $ = id => document.getElementById(id);
const initialSamples = [
  { heart: 76, oxygen: 98, sleep: 7.5, temperature: 36.8, hrv: 58, eda: 2.2 },
  { heart: 82, oxygen: 97, sleep: 6.8, temperature: 36.7, hrv: 62, eda: 2.5 },
  { heart: 79, oxygen: 99, sleep: 7.9, temperature: 36.9, hrv: 60, eda: 2.0 }
];
const graphMetrics = {
  heart_rate_bpm: { field: "heart", baseline: 76, variation: 5.2 },
  spo2_percent: { field: "oxygen", baseline: 98, variation: 0.9 },
  hrv_ms: { field: "hrv", baseline: 58, variation: 6.3 },
  core_temperature_c: { field: "temperature", baseline: 36.8, variation: 0.23 },
  stress_eda_us: { field: "eda", baseline: 2.2, variation: 0.45 }
};
const environmentDescriptions = {
  station: "Space-station operations involve altered gravity and a controlled habitat environment.",
  spacecraft: "Deep-space missions introduce greater distance from Earth alongside radiation and isolation concerns.",
  lunar: "Lunar surface missions involve partial gravity, demanding activities and a closed living environment.",
  mars: "Mars missions combine long communication delays, isolation, radiation and partial gravity."
};
const inputFields = {
  heart: "input-heart", oxygen: "input-oxygen", sleep: "input-sleep",
  temperature: "input-temperature", hrv: "input-hrv", eda: "input-eda",
  bpSys: "input-bp-sys", bpDia: "input-bp-dia", glucose: "input-glucose"
};
let currentIndex = 0;
let currentData = { ...initialSamples[0] };
let entryType = "simulated";
let charts = null;
let alertManager = null;
let demoAlertsLoaded = false;

function makeHistory() {
  const history = {};
  const end = Date.now();
  for (const [metric, settings] of Object.entries(graphMetrics)) {
    history[metric] = Array.from({ length: 24 }, (_, index) => {
      const variation = Math.sin(index / 3.3) * settings.variation * 0.55 + Math.cos(index / 2.2) * settings.variation * 0.22;
      const value = Math.max(0, settings.baseline + variation);
      return {
        timestamp: new Date(end - (23 - index) * 15 * 60 * 1000).toISOString(),
        value: Number(value.toFixed(metric === "spo2_percent" ? 1 : 2))
      };
    });
  }
  history.heart_rate_bpm[23].value = 76;
  history.spo2_percent[23].value = 98;
  history.hrv_ms[23].value = 58;
  history.core_temperature_c[23].value = 36.8;
  history.stress_eda_us[23].value = 2.2;
  return history;
}
const initialHistory = makeHistory();

function initializeCharts() {
  const status = $("charts-status");
  try {
    charts = createHealthCharts($("health-chart-container"), initialHistory);
    status.textContent = typeof window.Chart === "function" && window.Chart.isFallback
      ? "Interactive offline chart preview. Connect to the internet to use Chart.js enhancements."
      : "Showing generated demo history. Charts update with new demo samples and manually entered readings.";
  } catch (error) {
    charts = null;
    status.textContent = "Charts unavailable in this browser. Other dashboard features remain usable.";
    console.error("Chart initialization failed", error);
  }
}

function initializeAlerts() {
  try {
    alertManager = new HealthAlertManager(document.querySelector(".health-alerts"));
  } catch (error) {
    console.error("Alert panel initialization failed", error);
  }
}

function setProgress(selector, value, displayMax) {
  const bar = document.querySelector(selector);
  if (!bar || !Number.isFinite(value)) return;
  bar.style.width = `${Math.max(0, Math.min(100, value / displayMax * 100))}%`;
}

function renderReadings() {
  $("heart-value").textContent = currentData.heart;
  $("oxygen-value").textContent = currentData.oxygen;
  $("sleep-value").textContent = currentData.sleep;
  $("temperature-value").textContent = currentData.temperature;
  setProgress(".heart-progress", currentData.heart, 150);
  setProgress(".oxygen-progress", currentData.oxygen, 100);
  setProgress(".sleep-progress", currentData.sleep, 12);
  setProgress(".temperature-progress", currentData.temperature, 45);
  const manual = entryType === "manual";
  document.querySelectorAll(".status-text").forEach(element => {
    element.textContent = manual ? "Self-entered · Unverified" : "Simulated demo sample";
  });
  $("reading-origin").textContent = manual ? "Self-entered check-in" : "Illustrative demo readings";
  $("sample-indicator").textContent = manual ? "Manual check-in" : `Sample ${currentIndex + 1} of ${initialSamples.length}`;
  $("demo-message").textContent = manual
    ? "Self-entered reading recorded in this browser session. Display bars are not clinical assessment scales."
    : "Illustrative bars show a fraction of a display scale, not normal or critical health values.";
  for (const field of ["heart", "oxygen", "sleep", "temperature"]) {
    $(inputFields[field]).value = currentData[field];
  }
  if (manual) {
    $("recorded-bp").textContent = currentData.bpSys != null && currentData.bpDia != null
      ? `${currentData.bpSys}/${currentData.bpDia} mmHg` : "Not recorded";
    $("recorded-glucose").textContent = currentData.glucose != null
      ? `${currentData.glucose} mg/dL` : "Not recorded";
    $("recorded-mood").textContent = currentData.mood || "Not recorded";
  } else {
    $("recorded-bp").textContent = "Not recorded";
    $("recorded-glucose").textContent = "Not recorded";
    $("recorded-mood").textContent = "Not recorded";
  }
}

function updateHistory(data) {
  if (!charts) return;
  const reading = { timestamp: new Date().toISOString() };
  for (const [metric, settings] of Object.entries(graphMetrics)) {
    if (Number.isFinite(data[settings.field])) reading[metric] = data[settings.field];
  }
  charts.update(reading);
}

function setLastAction(text) {
  $("last-action").textContent = `${text}: ${new Date().toLocaleTimeString()}`;
}

function resetDemo() {
  entryType = "simulated";
  currentIndex = 0;
  currentData = { ...initialSamples[0] };
  for (const id of ["input-hrv", "input-eda", "input-bp-sys", "input-bp-dia", "input-glucose"]) $(id).value = "";
  $("input-mood").value = "";
  renderReadings();
  if (charts) {
    for (const [metric, points] of Object.entries(initialHistory)) charts.setMetricData(metric, points);
  }
  $("checkin-feedback").textContent = "Demo history reset. Try entering your own sample check-in.";
  setLastAction("Demo reset");
}

function numericInput(id, required = false) {
  const input = $(id);
  const text = input.value.trim();
  if (text === "") {
    if (required) throw new Error(`Please enter ${input.name}.`);
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Invalid input for ${input.name}.`);
  if (!input.checkValidity()) throw new Error(`Please check the entered ${input.name} value or unit.`);
  return value;
}

function handleCheckin(event) {
  event.preventDefault();
  const feedback = $("checkin-feedback");
  feedback.classList.remove("error");
  try {
    if (!event.currentTarget.reportValidity()) return;
    const data = {
      heart: numericInput("input-heart", true),
      oxygen: numericInput("input-oxygen", true),
      sleep: numericInput("input-sleep", true),
      temperature: numericInput("input-temperature", true),
      hrv: numericInput("input-hrv"),
      eda: numericInput("input-eda"),
      bpSys: numericInput("input-bp-sys"),
      bpDia: numericInput("input-bp-dia"),
      glucose: numericInput("input-glucose"),
      mood: $("input-mood").value
    };
    if ((data.bpSys == null) !== (data.bpDia == null)) throw new Error("Enter both blood pressure values, or leave both blank.");
    if (data.bpSys !== null && data.bpSys <= data.bpDia) throw new Error("Systolic blood pressure should be greater than diastolic pressure; check the input order.");
    entryType = "manual";
    currentData = data;
    renderReadings();
    updateHistory(data);
    feedback.textContent = `Check-in recorded locally${data.mood ? ` · mood: ${data.mood}` : ""}. No clinical evaluation was performed.`;
    setLastAction("Check-in added");
  } catch (error) {
    feedback.classList.add("error");
    feedback.textContent = error.message;
  }
}

function generateDemoAlerts() {
  const timestamp = new Date().toISOString();
  return [
    { id: "simulation-protocol", severity: "warning", parameter: "Training scenario", message: "Simulated crew review reminder for an exercise. No threshold-based detection or medical interpretation occurred.", timestamp, status: "active" },
    { id: "simulation-check", severity: "normal", parameter: "Demo system message", message: "Frontend preview is working. NASA measurements and the backend are not connected.", timestamp, status: "active" },
    { id: "simulation-old", severity: "warning", parameter: "Previous example", message: "Historical simulated item to demonstrate resolved-alert layout.", timestamp, status: "resolved" }
  ];
}

function loadDemoAlerts() {
  if (!alertManager) return;
  alertManager.update({ alerts: generateDemoAlerts() });
  demoAlertsLoaded = true;
}

function resolveDemoAlert() {
  if (!alertManager || !demoAlertsLoaded) return;
  alertManager.update({ alerts: [{ id: "simulation-protocol", severity: "warning", parameter: "Training scenario", message: "Simulated crew review reminder for an exercise. Status changed for UI testing only.", timestamp: new Date().toISOString(), status: "resolved" }] });
}

function requestCrewReview() {
  if (!alertManager) return;
  const alertId = `local-review-${Date.now()}`;
  alertManager.update({ alerts: [{ id: alertId, severity: "warning", parameter: "Crew review requested (demo)", message: "The user requested a review in this local prototype. No actual flight surgeon or medical team has been notified.", timestamp: new Date().toISOString(), status: "active" }] });
  $("alerts").scrollIntoView({ behavior: "smooth", block: "start" });
}

function start() {
  initializeCharts();
  initializeAlerts();
  renderReadings();
  $("update-btn").addEventListener("click", () => {
    currentIndex = currentIndex >= initialSamples.length - 1 ? 1 : currentIndex + 1;
    entryType = "simulated";
    currentData = { ...initialSamples[currentIndex] };
    for (const id of ["input-hrv", "input-eda", "input-bp-sys", "input-bp-dia", "input-glucose"]) $(id).value = "";
    $("input-mood").value = "";
    renderReadings();
    updateHistory(currentData);
    setLastAction("Demo updated");
  });
  $("reset-btn").addEventListener("click", resetDemo);
  $("checkin-form").addEventListener("submit", handleCheckin);
  $("request-review").addEventListener("click", requestCrewReview);
  $("load-alert-demo").addEventListener("click", loadDemoAlerts);
  $("resolve-alert-demo").addEventListener("click", resolveDemoAlert);
  $("mission-environment").addEventListener("change", event => {
    $("environment-description").textContent = environmentDescriptions[event.target.value] || environmentDescriptions.station;
  });
}

start();
