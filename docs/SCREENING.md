# Screening rules and limitations

These rules produce review prompts. They are **not validated astronaut limits**, diagnostic criteria, or treatment instructions. An absent prompt does not establish health. Symptoms and approved mission protocols take priority. Latest available values can be old: timestamps are always retained. HRV, EDA and glucose are not automatically interpreted.

| Measurement | Application prompt | Source and qualifications |
|---|---|---|
| Resting pulse | Below 60 or above 100 bpm: review | [AHA](https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates). Broad adult resting reference; fitness and medication matter. Not applied to post-exercise/other context. |
| SpO₂ | Below 95%: review; at/below 92%: contact medical lead; at/below 88%: immediate assistance | [MedlinePlus](https://medlineplus.gov/lab-tests/pulse-oximetry/). Device limitations, skin pigmentation, symptoms and mission environment matter. |
| Sleep | Below 7 hours: review routine | [CDC](https://www.cdc.gov/sleep/about/index.html). Adult reference, not a clinical sleep assessment. |
| Temperature | At/above 38°C: review | [NHS](https://www.nhs.uk/symptoms/fever-in-adults/). Measurement site and symptoms matter. |
| Temperature | Below 35°C: urgent prompt | [NHS](https://www.nhs.uk/conditions/hypothermia/). Seek crew medical assistance; not an independent diagnosis. |
| Temperature | At/above 40.6°C: prompt medical contact | [MedlinePlus](https://medlineplus.gov/ency/article/003090.htm). Adult high-fever contact reference; method, symptoms and persistence matter. Lower temperatures can also need urgent care depending on symptoms. |
| Blood pressure | At/above 130 systolic OR 80 diastolic: review; at/above 180 OR 120: prompt medical contact | [AHA](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings). The latter is a conservative **application trigger** at-or-above the values; the cited AHA emergency reference says **higher than** 180/120. One measurement does not diagnose hypertension. |
| Mood | Personal score 1–2 of 5: offer a supportive check-in | Organizational application choice, **not a validated mental-health threshold**. [NASA hazard context](https://www.nasa.gov/hrp/hazards/). |

Numeric input bounds in `METRICS` are plausibility checks to catch common unit/input errors, not safe/normal ranges. The tool cannot verify sensor accuracy, person identity, symptoms, fasting status, mission conditions, or clinical fitness.

Acknowledging a prompt marks it as seen. It does not resolve a health concern. A new partial record does not hide a prior measurement of another type. Urgent prompts in a newly saved backdated record are shown for that specific record even if a newer observation exists.

Research recordings are never screened as if they were current personal observations and are never merged into personal records automatically.
