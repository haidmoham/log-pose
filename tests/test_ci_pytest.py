from pathlib import Path

from scripts.check_ci_pytest import audit_report


def test_ci_pytest_audit_requires_real_disposable_database_coverage(tmp_path: Path):
    report = tmp_path / "pytest.xml"
    report.write_text("""<testsuite>
      <testcase classname="tests.test_postgres" name="db_fixture" />
      <testcase classname="tests.test_topology_postgres" name="topology_fixture" />
      <testcase classname="tests.test_medallion" name="layer_views" />
    </testsuite>""")
    assert audit_report(report)["passed"]

    report.write_text("""<testsuite>
      <testcase classname="tests.test_postgres" name="db_fixture"><skipped /></testcase>
      <testcase classname="tests.test_topology_postgres" name="topology_fixture" />
      <testcase classname="tests.test_medallion" name="layer_views" />
    </testsuite>""")
    result = audit_report(report)
    assert not result["passed"]
    assert result["skipped"] == ["db_fixture"]
    assert result["missing_database_modules"] == ["test_postgres"]
