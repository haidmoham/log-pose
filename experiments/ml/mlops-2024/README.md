# experimental MLOps industry study

This fixed eight-lead study uses a 2024-12-31 information cutoff. It compares company statements and documented evidence while retaining unresolved identity and eligibility gates. See the [memo](MEMO.md) and [study](study.json) for the conditional hypotheses and their limits.

`source-artifacts/` retains the study-specific original bytes. `source-manifest.json` records their identifiers and hashes; `acquisition-report.json` preserves successes and failures. The builder also reads existing shared homepage and inventory evidence from the main retained-data export.

```bash
python experiments/ml/mlops-2024/build.py
python -m pytest -q experiments/ml/mlops-2024/tests
npm run test:experimental
```

Run commands from the repository root. The builder also resolves paths correctly when invoked by absolute path from another directory. It writes `study.json` here and the identical `web/experimental/mlops-2024/study.json` for the standalone interface. No database writes or new retrieval occur. Relocation changed artifact paths only; source bytes, hashes, IDs, passages, cohort, and judgments remain unchanged.
