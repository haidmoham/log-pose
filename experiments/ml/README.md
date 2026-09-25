# experimental ML and industry research

This is Log Pose's isolated experimental workspace. The benchmark is an ML evaluation prototype; the MLOps study is provisional industry research. Neither result is promoted automatically into the core application or reviewed ontology.

| space | contents | status |
| --- | --- | --- |
| [benchmark](benchmark/README.md) | replay code, protocol, 20 cases, evaluator fixtures, tests, historical scorecards | mechanics checks; semantic accuracy remains provisional |
| [MLOps study](mlops-2024/README.md) | builder, eight-lead cohort, retained sources, acquisition outcomes, judgments, memo, tests | unresolved eligibility gates; zero unconditional diligence priorities |
| [browser entry](../../web/experimental/index.html) | explicitly labelled landing page and independent study interface | public experimental output |

From the repository root, after installing the ordinary development dependencies:

```bash
python -m pytest -q experiments/ml
npm run test:experimental
python experiments/ml/benchmark/run.py --output-dir /tmp/log-pose-benchmark-new-run
python experiments/ml/mlops-2024/build.py
```

The study build requires `pdftotext` for its retained PDF. It uses local pinned sources and performs no network acquisition. Its two generated study files must remain identical. The benchmark command requires an explicit output directory; preserve historical receipts by selecting a new location.

Serve `web/` through `npm run dev` or `npm run dashboard`, then open `/experimental/index.html`. The MLOps study is at `/experimental/mlops-2024/index.html`. Older `?view=research-set` bookmarks redirect there with their study filters.

Core checks remain `python -m pytest -q` and `npm run test:dashboard`. The core Python package excludes this workspace. The ordinary console loads no experimental scripts, styles, or study data; experiments may consume shared evidence and presentation styles in one direction. Browser files are publicly served, while evaluator fixtures remain outside `web/`.

Retain immutable bytes, hashes, source and arrival times, record IDs, unresolved cases, and failed acquisition outcomes. Experimental raw, bronze, silver, and gold artifacts follow the project medallion contract. Add future experiments in a named subdirectory here with their own scope, evidence limits, explicit commands, and tests. Shared data or ontology changes need reviewed promotion through the normal migration and integration path.
