# Experimental atlas attachments

This directory defines an isolated validation contract for model or scenario
outputs attached to atlas records. It is not imported by normal application
startup, does not run a model, and cannot write canonical evidence or reviews.

An attachment names a target kind and ID; model, prompt, and code versions;
issuance and evidence cutoff times; exact input evidence IDs with availability
times; a target and horizon; assumptions; output semantics; and experimental
validation references. Input availability must not follow the evidence cutoff,
and the cutoff must not follow issuance.

`score` and `probability` are distinct output kinds. Probabilities stay in
`[0, 1]`. Categorical probabilities must sum to one. Multilabel probabilities
do not need to sum to one and must not claim categorical normalization. An
attachment remains `not_reviewed` even when an experimental evaluation exists.
Reviewing a source claim or promoting a record requires the canonical evidence
and review workflow outside this directory.

Run only the validator tests:

```sh
PYTHONPATH=src:. python -m pytest experiments/ml/atlas/tests -q
```
