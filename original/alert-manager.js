const VALID_SEVERITIES = new Set(["normal", "warning", "critical"]);
const VALID_STATUSES = new Set(["active", "resolved"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAlert(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const severity = normalizeText(input.severity).toLowerCase();
  const parameter = normalizeText(input.parameter);
  const message = normalizeText(input.message);
  const rawStatus = input.status === undefined || input.status === null
    ? ""
    : typeof input.status === "string"
      ? input.status.trim().toLowerCase()
      : null;
  const status = rawStatus === "" ? "active" : rawStatus;

  if (!VALID_SEVERITIES.has(severity) ||
      !parameter ||
      !message ||
      !status ||
      !VALID_STATUSES.has(status)) {
    return null;
  }

  const rawTimestamp = input.timestamp;
  const parsedTimestamp = typeof rawTimestamp === "string" ||
    typeof rawTimestamp === "number"
    ? new Date(rawTimestamp)
    : null;
  const timestampIsValid = parsedTimestamp &&
    !Number.isNaN(parsedTimestamp.getTime());
  const timestamp = timestampIsValid
    ? parsedTimestamp.toISOString()
    : "";
  const timestampLabel = timestampIsValid
    ? parsedTimestamp.toLocaleString()
    : "Timestamp unavailable";
  const id = typeof input.id === "string" || typeof input.id === "number"
    ? String(input.id).trim()
    : "";
  const key = id
    ? `id:${id}`
    : `fallback:${JSON.stringify([severity, parameter, message, timestamp])}`;

  return {
    key,
    severity,
    parameter,
    message,
    timestamp,
    timestampLabel,
    status
  };
}

export class HealthAlertManager {
  constructor(root) {
    if (!root || typeof root.querySelector !== "function") {
      throw new TypeError("Provide a root element for the alert manager.");
    }

    this.root = root;
    this.alerts = new Map();
    this.activeList = root.querySelector("[data-alert-active-list]");
    this.resolvedList = root.querySelector("[data-alert-resolved-list]");
    this.activeCount = root.querySelector("[data-alert-count]");
    this.updateStatus = root.querySelector("[data-alert-update-status]");

    if (!this.activeList || !this.resolvedList ||
        !this.activeCount || !this.updateStatus) {
      throw new Error("The alert manager markup is missing required elements.");
    }

    this.handleClick = event => {
      const button = event.target.closest("[data-alert-action='acknowledge']");
      if (!button || !this.root.contains(button)) {
        return;
      }

      const alert = this.alerts.get(button.dataset.alertKey);
      if (!alert || alert.status !== "active" || alert.acknowledged) {
        return;
      }

      alert.acknowledged = true;
      this.render();
    };

    this.root.addEventListener("click", this.handleClick);
    this.render();
  }

  update(response) {
    const records = Array.isArray(response)
      ? response
      : response && typeof response === "object" &&
        Array.isArray(response.alerts)
        ? response.alerts
        : null;

    if (!records) {
      this.updateStatus.textContent =
        "Alert update was not applied: expected an array or an object with an alerts array.";
      return { accepted: 0, rejected: 1 };
    }

    let accepted = 0;
    let rejected = 0;

    records.forEach(record => {
      const normalized = normalizeAlert(record);
      if (!normalized) {
        rejected += 1;
        return;
      }

      const previous = this.alerts.get(normalized.key);
      this.alerts.set(normalized.key, {
        ...normalized,
        acknowledged: previous ? previous.acknowledged : false
      });
      accepted += 1;
    });

    this.render();
    this.updateStatus.textContent = rejected
      ? `Updated ${accepted} alert(s); skipped ${rejected} invalid record(s).`
      : `Updated ${accepted} alert(s). Repeated IDs update existing alerts.`;

    return { accepted, rejected };
  }

  render() {
    const activeAlerts = [];
    const resolvedAlerts = [];

    this.alerts.forEach(alert => {
      (alert.status === "active" ? activeAlerts : resolvedAlerts).push(alert);
    });

    this.activeCount.textContent = String(activeAlerts.length);
    this.activeCount.setAttribute(
      "aria-label",
      `${activeAlerts.length} active alert${activeAlerts.length === 1 ? "" : "s"}`
    );
    this.renderList(this.activeList, activeAlerts, true);
    this.renderList(this.resolvedList, resolvedAlerts, false);
  }

  renderList(list, alerts, allowAcknowledge) {
    const fragment = document.createDocumentFragment();
    if (alerts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "alert-empty";
      empty.textContent = allowAcknowledge
        ? "No active alerts."
        : "No resolved alerts yet.";
      fragment.appendChild(empty);
    } else {
      alerts.forEach(alert => {
        fragment.appendChild(this.createAlertCard(alert, allowAcknowledge));
      });
    }
    list.replaceChildren(fragment);
  }

  createAlertCard(alert, allowAcknowledge) {
    const card = document.createElement("article");
    card.className = `health-alert health-alert--${alert.severity}`;
    card.dataset.alertKey = alert.key;

    const header = document.createElement("div");
    header.className = "health-alert__header";

    const severity = document.createElement("span");
    severity.className = "health-alert__severity";
    severity.textContent = alert.severity;
    header.appendChild(severity);

    const status = document.createElement("span");
    status.className = "health-alert__status";
    status.textContent = alert.status;
    header.appendChild(status);

    const parameter = document.createElement("p");
    parameter.className = "health-alert__parameter";
    parameter.textContent = alert.parameter;

    const message = document.createElement("p");
    message.className = "health-alert__message";
    message.textContent = alert.message;

    const timestamp = document.createElement("time");
    timestamp.className = "health-alert__timestamp";
    if (alert.timestamp) {
      timestamp.dateTime = alert.timestamp;
    }
    timestamp.textContent = alert.timestampLabel;

    card.append(header, parameter, message, timestamp);

    if (alert.acknowledged) {
      const acknowledged = document.createElement("span");
      acknowledged.className = "health-alert__acknowledged";
      acknowledged.textContent = "Acknowledged";
      card.appendChild(acknowledged);
    } else if (allowAcknowledge) {
      const acknowledge = document.createElement("button");
      acknowledge.type = "button";
      acknowledge.className = "health-alert__acknowledge";
      acknowledge.dataset.alertAction = "acknowledge";
      acknowledge.dataset.alertKey = alert.key;
      acknowledge.textContent = "Acknowledge";
      card.appendChild(acknowledge);
    }

    return card;
  }

  destroy() {
    this.root.removeEventListener("click", this.handleClick);
    this.alerts.clear();
    this.render();
  }
}
