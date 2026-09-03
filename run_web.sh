#!/usr/bin/env bash
# Launch the LinkedIn Outreach Agent web dashboard.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  ./.venv/bin/pip install -q -r requirements.txt
fi
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  echo "Created config.yaml from the example — edit it, then re-run."
fi
echo "Starting dashboard on http://localhost:8000  (Ctrl-C to stop)"
exec ./.venv/bin/python -m webapp.server
