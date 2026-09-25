#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import log_pose, psycopg' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -e '.[test]'
fi

# The console reads retained static exports. DATABASE_URL enables the legacy
# read-only API; opening the interface does not migrate, import, or acquire data.
exec .venv/bin/python -c 'import os; from log_pose.server import serve; serve(int(os.environ.get("PORT", "8000")))'
