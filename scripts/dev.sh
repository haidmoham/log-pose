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

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "using DATABASE_URL from the environment"
elif command -v brew >/dev/null 2>&1 && [[ -x "$(brew --prefix postgresql@18 2>/dev/null)/bin/postgres" ]]; then
  postgres_bin="$(brew --prefix postgresql@18)/bin"
  database_dir="$PWD/data/postgres"
  mkdir -p data
  if [[ ! -f "$database_dir/PG_VERSION" ]]; then
    "$postgres_bin/initdb" -D "$database_dir" -L "$(brew --prefix postgresql@18)/share/postgresql" --auth-local=trust --auth-host=trust >/dev/null
  fi
  if ! "$postgres_bin/pg_ctl" -D "$database_dir" status >/dev/null 2>&1; then
    if "$postgres_bin/pg_isready" -h 127.0.0.1 -p 55432 -q; then
      echo 'port 55432 already belongs to another Postgres server' >&2
      exit 1
    fi
    "$postgres_bin/pg_ctl" -D "$database_dir" -l "$PWD/data/postgres.log" -o '-h 127.0.0.1 -p 55432' start >/dev/null
  fi
  export DATABASE_URL='postgresql://127.0.0.1:55432/logpose'
  if ! "$postgres_bin/psql" "$DATABASE_URL" -Atqc 'SELECT 1' >/dev/null 2>&1; then
    "$postgres_bin/createdb" -h 127.0.0.1 -p 55432 logpose
  fi
  echo "using project-local Postgres on port 55432"
elif command -v docker >/dev/null 2>&1; then
  docker compose up -d db
  export DATABASE_URL='postgresql://logpose:logpose@127.0.0.1:5432/logpose'
  for attempt in {1..30}; do
    if docker compose exec -T db pg_isready -U logpose -q; then break; fi
    sleep 1
  done
  echo "using Docker Compose Postgres on port 5432"
else
  echo 'Postgres is unavailable. Install Homebrew postgresql@18, start Docker, or set DATABASE_URL.' >&2
  exit 1
fi

.venv/bin/log-pose migrate

count_missing_captures() {
  .venv/bin/python - <<'PY'
import json
from datetime import datetime, timezone
from pathlib import Path

from log_pose.storage import connect

missing = 0
with connect() as connection:
    for source in json.loads(Path('sources.json').read_text()):
        for timestamp in source['captures'].values():
            captured_at = datetime.strptime(timestamp, '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
            row = connection.execute(
                '''SELECT 1 FROM snapshots AS snapshot
                   JOIN sources AS original ON original.id = snapshot.source_id
                   JOIN companies AS company ON company.id = original.company_id
                   WHERE company.slug = %s AND original.original_url = %s
                     AND snapshot.captured_at = %s''',
                (source['slug'], source['url'], captured_at),
            ).fetchone()
            if row is None:
                missing += 1
print(missing)
PY
}

if (( $(count_missing_captures) > 0 )); then
  echo 'loading missing archived captures into local Postgres'
  if ! .venv/bin/log-pose ingest --delay 0; then
    echo 'some archive fetches failed; stored evidence remains available in the preview' >&2
  fi
fi
if (( $(count_missing_captures) > 0 )); then
  echo 'some curated captures are missing; run log-pose ingest to retry later' >&2
fi

exec .venv/bin/log-pose serve --port "${PORT:-8000}"
