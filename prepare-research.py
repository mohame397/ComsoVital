"""Rebuild research.json measurements/stats from the bundled unchanged BIDMC CSV.
Usage: python scripts/prepare-research.py
No network request is made. Original data remain licensed under ODC-By 1.0.
"""
from pathlib import Path
import csv
import hashlib
import json
import math
from statistics import mean

base = Path(__file__).resolve().parents[1] / 'dist' / 'data'
raw = base / 'bidmc_01_Numerics.csv'
metadata = json.loads((base / 'research.json').read_text())
columns = {'seconds': 'Time [s]', 'heart': 'HR', 'pulse': 'PULSE',
           'respiration': 'RESP', 'oxygen': 'SpO2'}

def numeric(value):
    number = float(value)
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number

with raw.open(newline='') as stream:
    rows = [{key: numeric(row[source]) for key, source in columns.items()}
            for row in csv.DictReader(stream, skipinitialspace=True)]

stats = {}
for key in ('heart', 'oxygen', 'respiration', 'pulse'):
    valid = [row[key] for row in rows if row[key] is not None]
    stats[key] = {'min': min(valid), 'max': max(valid),
                  'mean': round(mean(valid), 2), 'count': len(valid),
                  'missing': len(rows) - len(valid)}
stats.update(samples=len(rows), durationSeconds=rows[-1]['seconds'] - rows[0]['seconds'],
             sampleRateHz=1)
metadata.update(points=rows, statistics=stats,
                sha256=hashlib.sha256(raw.read_bytes()).hexdigest())
(base / 'research.json').write_text(json.dumps(metadata, ensure_ascii=False,
                                             allow_nan=False, indent=2) + '\n')
print(f'Prepared {len(rows)} measured rows; missing measurements remain null.')
