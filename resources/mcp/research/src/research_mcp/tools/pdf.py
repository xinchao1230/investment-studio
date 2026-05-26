"""PDF download and text extraction tool.

Testing pattern: DI via `_fetch` and `_parser` kwargs.
`_fetch` defaults to `requests.get`; `_parser` defaults to `pdfplumber.open`.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from research_mcp.lib.result import ok, fail


def _default_fetch(url: str, **kwargs):
    """Default HTTP fetcher using requests."""
    import requests
    return requests.get(url, **kwargs)


def _default_parser(path):
    """Default PDF parser using pdfplumber."""
    import pdfplumber
    return pdfplumber.open(path)


def pdf_download_extract(
    url: str,
    out_dir: str,
    *,
    _fetch=None,
    _parser=None,
) -> dict:
    """Download a PDF from url and extract text/tables.

    Args:
        url: HTTP(S) URL of the PDF file.
        out_dir: Absolute output directory. Files written here.
        _fetch: Injected HTTP fetcher (url, **kwargs) -> response for testing.
        _parser: Injected PDF parser (path) -> context manager for testing.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    import requests as _requests_module

    fetch = _fetch or _default_fetch
    parser = _parser or _default_parser

    try:
        os.makedirs(out_dir, exist_ok=True)
        paths: list[str] = []

        # Download
        try:
            resp = fetch(url, timeout=60)
            resp.raise_for_status()
        except _requests_module.exceptions.HTTPError as e:
            # 4xx → not retryable; 5xx → retryable
            status = getattr(getattr(e, "response", None), "status_code", 0)
            retryable = status >= 500
            return fail(error=f"pdf_download_extract failed: {e}", retryable=retryable)
        except (
            _requests_module.exceptions.Timeout,
            _requests_module.exceptions.ConnectionError,
        ) as e:
            return fail(error=f"pdf_download_extract failed: {e}", retryable=True)

        # Save PDF
        pdf_path = Path(out_dir) / "source.pdf"
        pdf_path.write_bytes(resp.content)
        paths.append("source.pdf")

        # Extract text and tables
        all_text: list[str] = []
        all_tables: list[list] = []

        with parser(str(pdf_path)) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    all_text.append(text)
                tables = page.extract_tables()
                if tables:
                    all_tables.extend(tables)

        # Write text
        full_text = "\n\n".join(all_text)
        text_path = Path(out_dir) / "text.txt"
        text_path.write_text(full_text, encoding="utf-8")
        paths.append("text.txt")

        # Write tables (best-effort)
        tables_count = len(all_tables)
        if all_tables:
            tables_path = Path(out_dir) / "tables.json"
            tables_path.write_text(
                json.dumps(all_tables, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            paths.append("tables.json")

        summary = {
            "pages": len(list(pdf.pages)) if hasattr(pdf, "pages") else len(all_text),
            "chars": len(full_text),
            "tables_count": tables_count,
        }

        return ok(paths=paths, summary=summary)
    except Exception as e:
        return fail(error=f"pdf_download_extract failed: {e}", retryable=False)
