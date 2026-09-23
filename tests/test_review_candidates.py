from log_pose.core import normalize
from scripts.review_candidates import candidate_passages


def test_passages_keep_exact_offsets_in_normalized_text():
    raw = b"<html><body><nav>Ignore this</nav><h1>Built for data teams</h1><p>Move reliable data across all of your applications.</p></body></html>"
    normalized = normalize(raw)
    passages = candidate_passages(raw, normalized)
    assert [passage["tag"] for passage in passages] == ["h1", "p"]
    for passage in passages:
        assert normalized[passage["start"]:passage["end"]] == passage["quote"]
