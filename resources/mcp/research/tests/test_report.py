"""Tests for report tools — assemble_report and monitor_compare."""
import json

import pytest

from research_mcp.tools.report import assemble_report, monitor_compare


# ===========================================================================
# assemble_report
# ===========================================================================


def _write_snapshot(path, *, include_all=True):
    """Write a synthetic snapshot.json."""
    snapshot = {}
    if include_all:
        snapshot["derived_metrics"] = [
            {"period": "20221231", "gross_margin": 0.35, "net_margin": 0.10, "roe": 0.15,
             "roa": 0.05, "current_ratio": 1.8, "debt_to_equity": 0.6, "free_cashflow": 2e8,
             "revenue": 1e9, "net_income": 1e8},
        ]
        snapshot["audit"] = {
            "checks": [
                {"name": "net_income_positive", "status": "PASS", "value": 1e8, "threshold": "> 0", "note": ""},
                {"name": "ocf_positive", "status": "PASS", "value": 3e8, "threshold": "> 0", "note": ""},
            ],
            "overall": "PASS",
        }
        snapshot["technicals"] = [
            {"trade_date": "20230601", "close": 105.0, "rsi_14": 55.0, "sma_20": 102.0},
        ]
        snapshot["capital_flow"] = [
            {"date": "2023-06-01", "main_net_inflow": 5e7},
        ]
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def test_assemble_report_generates_markdown(tmp_path):
    snapshot_path = tmp_path / "snapshot.json"
    _write_snapshot(snapshot_path)
    out_dir = str(tmp_path / "out")

    result = assemble_report(str(snapshot_path), out_dir, ticker="AAPL", company_name="Apple Inc.")
    assert result["ok"] is True
    assert "report.md" in result["paths"]

    report_path = tmp_path / "out" / "report.md"
    assert report_path.exists()
    content = report_path.read_text(encoding="utf-8")

    # Check section headers
    assert "# Executive Summary" in content or "## Executive Summary" in content
    assert "Financial Metrics" in content
    assert "Audit Findings" in content
    assert "Technicals" in content
    assert "Capital Flow" in content

    assert result["summary"]["word_count"] > 0
    assert isinstance(result["summary"]["sections"], list)
    assert len(result["summary"]["sections"]) >= 4


def test_assemble_report_skips_unavailable_sections(tmp_path):
    snapshot_path = tmp_path / "snapshot.json"
    snapshot = {
        "derived_metrics": [{"period": "20221231", "gross_margin": 0.35}],
        "audit": {"_unavailable": True},
        "technicals": {"_unavailable": True},
    }
    snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
    out_dir = str(tmp_path / "out")

    result = assemble_report(str(snapshot_path), out_dir)
    assert result["ok"] is True

    content = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    assert "Financial Metrics" in content
    # Unavailable sections should be skipped
    assert "Audit Findings" not in content
    assert "Technicals" not in content


def test_assemble_report_handles_missing_snapshot(tmp_path):
    result = assemble_report(str(tmp_path / "no_such_file.json"), str(tmp_path / "out"))
    assert result["ok"] is False
    assert result["retryable"] is False


# ===========================================================================
# monitor_compare
# ===========================================================================


def _write_two_snapshots(tmp_path):
    """Write current and previous snapshots with known deltas."""
    previous = {
        "derived_metrics": [
            {"period": "20211231", "gross_margin": 0.30, "net_margin": 0.08, "roe": 0.12,
             "revenue": 1e9, "net_income": 8e7},
        ],
        "technicals": [
            {"trade_date": "20220101", "close": 100.0, "rsi_14": 50.0},
        ],
    }
    current = {
        "derived_metrics": [
            {"period": "20221231", "gross_margin": 0.35, "net_margin": 0.10, "roe": 0.15,
             "revenue": 1.2e9, "net_income": 1.2e8},
        ],
        "technicals": [
            {"trade_date": "20230101", "close": 115.0, "rsi_14": 62.0},
        ],
    }
    prev_path = tmp_path / "previous.json"
    curr_path = tmp_path / "current.json"
    prev_path.write_text(json.dumps(previous, ensure_ascii=False), encoding="utf-8")
    curr_path.write_text(json.dumps(current, ensure_ascii=False), encoding="utf-8")
    return str(curr_path), str(prev_path)


def test_monitor_compare_writes_diff(tmp_path):
    curr, prev = _write_two_snapshots(tmp_path)
    out_dir = str(tmp_path / "out")

    result = monitor_compare(curr, prev, out_dir)
    assert result["ok"] is True
    assert "diff.json" in result["paths"]

    diff_path = tmp_path / "out" / "diff.json"
    assert diff_path.exists()
    diff = json.loads(diff_path.read_text(encoding="utf-8"))
    assert "added" in diff
    assert "removed" in diff
    assert "changed" in diff
    assert isinstance(diff["changed"], list)

    # revenue went from 1e9 to 1.2e9 — 20% change, should be an alert
    summary = result["summary"]
    assert summary["changed"] > 0
    assert summary["alerts"] > 0  # at least one >10% delta


def test_monitor_compare_detects_added_removed(tmp_path):
    previous = {"derived_metrics": [{"period": "20211231", "revenue": 1e9}]}
    current = {
        "derived_metrics": [{"period": "20221231", "revenue": 1.1e9, "new_metric": 42}],
        "technicals": [{"close": 100.0}],
    }
    prev_path = tmp_path / "prev.json"
    curr_path = tmp_path / "curr.json"
    prev_path.write_text(json.dumps(previous), encoding="utf-8")
    curr_path.write_text(json.dumps(current), encoding="utf-8")

    out_dir = str(tmp_path / "out")
    result = monitor_compare(str(curr_path), str(prev_path), out_dir)
    assert result["ok"] is True

    diff = json.loads((tmp_path / "out" / "diff.json").read_text(encoding="utf-8"))
    # "technicals" section added in current
    assert len(diff["added"]) > 0
    assert result["summary"]["added"] > 0


def test_monitor_compare_fails_on_missing_input(tmp_path):
    result = monitor_compare(
        str(tmp_path / "nonexistent.json"),
        str(tmp_path / "also_missing.json"),
        str(tmp_path / "out"),
    )
    assert result["ok"] is False
    assert result["retryable"] is False
