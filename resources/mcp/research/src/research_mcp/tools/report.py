"""Report assembly and comparison tools.

Covers: assemble_report (Task 14), monitor_compare (Task 15).
All tools follow the standard result contract (ok/fail from lib.result).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from research_mcp.lib.result import ok, fail


# ---------------------------------------------------------------------------
# Tool: assemble_report
# ---------------------------------------------------------------------------

def assemble_report(
    snapshot_json_path: str,
    out_dir: str,
    *,
    ticker: str = "",
    company_name: str = "",
) -> dict:
    """Generate a markdown report from a snapshot.json file.

    Produces sections: Executive Summary, Financial Metrics, Audit Findings,
    Technicals, Capital Flow. Sections whose source is unavailable are skipped.

    Args:
        snapshot_json_path: Path to the snapshot.json produced by data_snapshot.
        out_dir: Absolute output directory.
        ticker: Optional ticker symbol for the report header.
        company_name: Optional company name for the report header.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        p = Path(snapshot_json_path)
        if not p.exists():
            return fail(error="assemble_report failed: snapshot file not found", retryable=False)

        snapshot = json.loads(p.read_text(encoding="utf-8"))
        os.makedirs(out_dir, exist_ok=True)

        sections: list[str] = []
        lines: list[str] = []

        # Header
        title = company_name or ticker or "Investment Research Report"
        lines.append(f"# {title}")
        if ticker:
            lines.append(f"\n**Ticker:** {ticker}")
        lines.append("")

        # Executive Summary
        lines.append("## Executive Summary")
        lines.append("")
        summary_parts = []
        if _is_available(snapshot.get("derived_metrics")):
            summary_parts.append("Financial metrics available.")
        if _is_available(snapshot.get("audit")):
            audit = snapshot["audit"]
            overall = audit.get("overall", "N/A")
            summary_parts.append(f"Audit overall: {overall}.")
        if _is_available(snapshot.get("technicals")):
            summary_parts.append("Technical analysis available.")
        if _is_available(snapshot.get("capital_flow")):
            summary_parts.append("Capital flow data available.")
        lines.append(" ".join(summary_parts) if summary_parts else "No data available.")
        lines.append("")
        sections.append("Executive Summary")

        # Financial Metrics
        if _is_available(snapshot.get("derived_metrics")):
            lines.append("## Financial Metrics")
            lines.append("")
            metrics = snapshot["derived_metrics"]
            if isinstance(metrics, list) and metrics:
                # Table header from first record keys
                keys = [k for k in metrics[0].keys() if k != "period"]
                lines.append("| Period | " + " | ".join(keys) + " |")
                lines.append("|" + "---|" * (len(keys) + 1))
                for row in metrics:
                    vals = [str(row.get("period", ""))] + [_fmt(row.get(k)) for k in keys]
                    lines.append("| " + " | ".join(vals) + " |")
            lines.append("")
            sections.append("Financial Metrics")

        # Audit Findings
        if _is_available(snapshot.get("audit")):
            lines.append("## Audit Findings")
            lines.append("")
            audit = snapshot["audit"]
            lines.append(f"**Overall:** {audit.get('overall', 'N/A')}")
            lines.append("")
            checks = audit.get("checks", [])
            if checks:
                lines.append("| Check | Status | Value | Threshold |")
                lines.append("|---|---|---|---|")
                for c in checks:
                    lines.append(f"| {c.get('name', '')} | {c.get('status', '')} | {_fmt(c.get('value'))} | {c.get('threshold', '')} |")
            lines.append("")
            sections.append("Audit Findings")

        # Technicals
        if _is_available(snapshot.get("technicals")):
            lines.append("## Technicals")
            lines.append("")
            technicals = snapshot["technicals"]
            if isinstance(technicals, list) and technicals:
                latest = technicals[-1]
                lines.append(f"- **Last Close:** {_fmt(latest.get('close'))}")
                lines.append(f"- **RSI(14):** {_fmt(latest.get('rsi_14'))}")
                lines.append(f"- **SMA(20):** {_fmt(latest.get('sma_20'))}")
            lines.append("")
            sections.append("Technicals")

        # Capital Flow
        if _is_available(snapshot.get("capital_flow")):
            lines.append("## Capital Flow")
            lines.append("")
            flow = snapshot["capital_flow"]
            if isinstance(flow, list) and flow:
                lines.append("| Date | Main Net Inflow |")
                lines.append("|---|---|")
                for row in flow[-5:]:  # last 5 entries
                    lines.append(f"| {row.get('date', '')} | {_fmt(row.get('main_net_inflow'))} |")
            lines.append("")
            sections.append("Capital Flow")

        # Write report
        report_text = "\n".join(lines)
        out_path = Path(out_dir) / "report.md"
        out_path.write_text(report_text, encoding="utf-8")

        word_count = len(report_text.split())
        summary = {"sections": sections, "word_count": word_count}

        return ok(paths=["report.md"], summary=summary)
    except Exception as e:
        return fail(error=f"assemble_report failed: {e}", retryable=False)


def _is_available(data) -> bool:
    """Check if a snapshot section is available (not None, not _unavailable marker)."""
    if data is None:
        return False
    if isinstance(data, dict) and data.get("_unavailable"):
        return False
    return True


def _fmt(val) -> str:
    """Format a value for markdown display."""
    if val is None:
        return "N/A"
    if isinstance(val, float):
        if abs(val) >= 1e6:
            return f"{val:,.0f}"
        return f"{val:.4f}"
    return str(val)


# ---------------------------------------------------------------------------
# Tool: monitor_compare (placeholder — implemented in Task 15)
# ---------------------------------------------------------------------------

def monitor_compare(
    current_snapshot: str,
    previous_snapshot: str,
    out_dir: str,
) -> dict:
    """Compare two snapshot.json files and compute per-metric deltas.

    Args:
        current_snapshot: Path to current snapshot.json.
        previous_snapshot: Path to previous snapshot.json.
        out_dir: Absolute output directory.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        curr_path = Path(current_snapshot)
        prev_path = Path(previous_snapshot)

        if not curr_path.exists():
            return fail(error="monitor_compare failed: current snapshot not found", retryable=False)
        if not prev_path.exists():
            return fail(error="monitor_compare failed: previous snapshot not found", retryable=False)

        current = json.loads(curr_path.read_text(encoding="utf-8"))
        previous = json.loads(prev_path.read_text(encoding="utf-8"))

        os.makedirs(out_dir, exist_ok=True)

        curr_keys = set(current.keys())
        prev_keys = set(previous.keys())

        added_keys = list(curr_keys - prev_keys)
        removed_keys = list(prev_keys - curr_keys)
        common_keys = curr_keys & prev_keys

        changed: list[dict] = []

        for key in sorted(common_keys):
            curr_data = current[key]
            prev_data = previous[key]

            # Flatten numeric values from both sections
            curr_nums = _extract_numerics(curr_data, prefix=key)
            prev_nums = _extract_numerics(prev_data, prefix=key)

            all_metric_keys = set(curr_nums.keys()) | set(prev_nums.keys())
            for mk in sorted(all_metric_keys):
                cv = curr_nums.get(mk)
                pv = prev_nums.get(mk)
                if cv is None and pv is None:
                    continue
                if cv is not None and pv is not None:
                    if cv != pv:
                        pct = abs(cv - pv) / abs(pv) if pv != 0 else None
                        changed.append({
                            "key": mk,
                            "old": pv,
                            "new": cv,
                            "pct": round(pct, 4) if pct is not None else None,
                        })
                elif cv is not None and pv is None:
                    # New metric within an existing section
                    changed.append({"key": mk, "old": None, "new": cv, "pct": None})
                else:
                    # Metric removed within an existing section
                    changed.append({"key": mk, "old": pv, "new": None, "pct": None})

        alerts = sum(1 for c in changed if c.get("pct") is not None and c["pct"] > 0.10)

        diff = {
            "added": added_keys,
            "removed": removed_keys,
            "changed": changed,
        }

        out_path = Path(out_dir) / "diff.json"
        out_path.write_text(json.dumps(diff, ensure_ascii=False, indent=2), encoding="utf-8")

        summary = {
            "added": len(added_keys),
            "removed": len(removed_keys),
            "changed": len(changed),
            "alerts": alerts,
        }

        return ok(paths=["diff.json"], summary=summary)
    except Exception as e:
        return fail(error=f"monitor_compare failed: {e}", retryable=False)


def _extract_numerics(data, prefix: str = "") -> dict[str, float]:
    """Extract numeric values from a snapshot section into a flat dict."""
    result = {}
    if isinstance(data, list):
        # List of records — take the last one (most recent)
        if data:
            record = data[-1]
            for k, v in record.items():
                if isinstance(v, (int, float)):
                    result[f"{prefix}.{k}"] = float(v)
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, (int, float)):
                result[f"{prefix}.{k}"] = float(v)
    return result
