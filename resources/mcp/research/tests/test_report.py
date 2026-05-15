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
