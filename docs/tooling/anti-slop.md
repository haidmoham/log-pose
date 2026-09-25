# JavaScript anti-slop checks

`npm run lint` runs Oxlint and the local anti-slop rules over `api/`, `scripts/`, `tests/`, and `web/`. It excludes `experiments/` and `web/experimental/` from the default path.

Run `npm run lint:experimental` to check the experimental MLOps JavaScript tests explicitly. The bundled plugin source under `tools/oxlint/anti-slop/` is also excluded from application diagnostics.

The repository does not declare Effect as a direct dependency, so only the generic anti-slop rules are enabled.
