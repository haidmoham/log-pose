# Evidence and claim benchmark

This experimental harness is separate from the installed `log_pose` runtime package. Run it only through the explicit entry point:

```bash
python experiments/ml/benchmark/run.py --output-dir /tmp/log-pose-benchmark-scorecard
```

The command resolves its repository root from its own file path, so it also works when invoked by absolute path from another current directory. Pass a new output directory to preserve the checked-in scorecard.

`data/scorecard/` contains the historical scorecard from before this relocation. Its case IDs and semantics remain unchanged. The manifest's protocol locator changed to this directory, so its current manifest hash differs from the hash recorded by that historical run. A fresh scorecard is a separate explicit output; this relocation does not regenerate or rewrite historical metrics.

Raw evidence references in the case evaluator data still point to the repository's shared `web/` and `docs/research/source-artifacts/` files. The benchmark copies no production evidence store, database, or runtime code into this package.
