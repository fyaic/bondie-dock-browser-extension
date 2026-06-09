#!/usr/bin/env python3
"""Wrapper to run web-fetch pipeline with proper encoding"""
import sys, os, subprocess, json

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
os.environ['PYTHONIOENCODING'] = 'utf-8'

url = sys.argv[1] if len(sys.argv) > 1 else ""

proc = subprocess.run(
    [sys.executable,
     r"C:\Users\ryshi\.openclaw\workspace\skills\web-fetch\run_pipeline.py",
     url],
    capture_output=True, text=True, encoding='utf-8', errors='replace',
    timeout=120
)

# Print stdout
if proc.stdout:
    print(proc.stdout)

# Print stderr if any (excluding warnings)
if proc.stderr:
    for line in proc.stderr.splitlines():
        if 'Warning' not in line and 'warning' not in line:
            print(f"[STDERR] {line}", file=sys.stderr)

sys.exit(proc.returncode)
