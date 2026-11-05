# Future Data Integration Contract — CosmoVital

This is a **proposed** interface contract, NOT an assertion about the columns in any future NASA dataset or API. Do not treat it as a published NASA schema.

## Proposed timestamped observation shape

```json
{
  "timestamp": "2026-11-14T10:00:00Z",
  "source_type": "simulated | self_reported | research_dataset",
  "source_name": "example source description",
  "heart_rate_bpm": 76,
  "spo2_percent": 98,
  "hrv_ms": 58,
  "core_temperature_c": 36.8,
  "stress_eda_us": 2.2,
  "sleep_hours": 7.5,
  "blood_pressure_systolic_mmhg": null,
  "blood_pressure_diastolic_mmhg": null,
  "blood_glucose_mg_dl": null,
  "mood": null
}
```

`timestamp` above is an example schema value, NOT a NASA record. All numerics are illustrative.

## Chart fields already supported in teammate module

| Data key | Display | Units |
|---|---|---|
| `heart_rate_bpm` | Heart Rate | bpm |
| `spo2_percent` | Blood Oxygen | % |
| `hrv_ms` | HRV | ms |
| `core_temperature_c` | Core Temperature | °C |
| `stress_eda_us` | EDA | µS |

The provided `health-charts.js` accepts `createHealthCharts(container, initialData)` and `charts.update(reading)` where reading has `timestamp` and any supported metric fields. Each chart keeps up to 60 points.

## Alert object expected by teammate's module

```json
{
  "id": "example-001",
  "severity": "warning",
  "parameter": "Crew review requested",
  "message": "Example UI message only.",
  "timestamp": "2026-11-14T10:00:00Z",
  "status": "active"
}
```

Allowed severities from the original alert module: `normal`, `warning`, `critical`. Allowed statuses: `active`, `resolved`. Repeated IDs update the same alert. `Acknowledge` is an interface action and **does not** mean the underlying alert is resolved.

## Research dataset ingestion questions

1. What actual data are public/downloadable vs restricted?
2. Is each measurement associated with a real astronaut, a simulated subject, an animal model, or an in-vitro experiment?
3. What do the units, timestamps, and collection methods mean?
4. Is permission/consent needed before display?
5. Can studies be compared across individuals or missions?
6. Do validated, mission-specific medical rules exist? If not, do not derive medical thresholds from chart `suggestedMin/suggestedMax` or mock alerts.
7. How does the future Backend differentiate research reference data, simulated training cases and actual current measurements?

No backend code or outbound API requests are included in this version.
