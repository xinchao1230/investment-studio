"""Tests for pdf tools — structure only, no live network calls."""
import json

import pytest

from research_mcp.tools.pdf import pdf_download_extract


# ===========================================================================
# pdf_download_extract
# ===========================================================================


class FakeResponse:
    """Mimics requests.Response with PDF-like bytes."""
    status_code = 200

    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self):
        pass


class FakeParser:
    """Mimics pdfplumber.open context manager."""

    def __init__(self, pages_text: list[str], tables: list[list] | None = None):
        self._pages_text = pages_text
        self._tables = tables or []

    def __call__(self, path):
        self._path = path
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    @property
    def pages(self):
        return [_FakePage(t, tbl) for t, tbl in
                zip(self._pages_text, self._tables + [[]] * (len(self._pages_text) - len(self._tables)))]


class _FakePage:
    def __init__(self, text: str, tables: list):
        self._text = text
        self._tables = tables

    def extract_text(self):
        return self._text

    def extract_tables(self):
        return self._tables


def _fake_fetch_ok(content: bytes = b"%PDF-fake"):
    """Return a _fetch callable that returns a successful response."""
    def _fetch(url, **kwargs):
        return FakeResponse(content)
    return _fetch


def _fake_fetch_timeout():
    """Return a _fetch callable that raises a timeout."""
    import requests
    def _fetch(url, **kwargs):
        raise requests.exceptions.Timeout("connection timed out")
    return _fetch


def _fake_fetch_404():
    """Return a _fetch callable that returns 404."""
    import requests
    def _fetch(url, **kwargs):
        resp = FakeResponse(b"")
        resp.status_code = 404
        def raise_for_status():
            raise requests.exceptions.HTTPError("404 Not Found", response=resp)
        resp.raise_for_status = raise_for_status
        return resp
    return _fetch


def test_pdf_download_extract_writes_text(tmp_path):
    parser = FakeParser(pages_text=["Page one content.", "Page two content."])
    out = pdf_download_extract(
        url="http://example.com/report.pdf",
        out_dir=str(tmp_path),
        _fetch=_fake_fetch_ok(),
        _parser=parser,
    )
    assert out["ok"] is True
    assert "source.pdf" in out["paths"]
    assert "text.txt" in out["paths"]
    assert (tmp_path / "source.pdf").exists()
    assert (tmp_path / "text.txt").exists()
    text = (tmp_path / "text.txt").read_text(encoding="utf-8")
    assert "Page one content." in text
    assert out["summary"]["pages"] == 2
    assert out["summary"]["chars"] > 0


def test_pdf_download_extract_writes_tables(tmp_path):
    # pdfplumber extract_tables() returns list[table] where table = list[list[str]]
    tables_data = [[[["Header", "Value"], ["Row1", "10"]]]]
    parser = FakeParser(pages_text=["text"], tables=tables_data)
    out = pdf_download_extract(
        url="http://example.com/report.pdf",
        out_dir=str(tmp_path),
        _fetch=_fake_fetch_ok(),
        _parser=parser,
    )
    assert out["ok"] is True
    assert "tables.json" in out["paths"]
    assert (tmp_path / "tables.json").exists()
    data = json.loads((tmp_path / "tables.json").read_text(encoding="utf-8"))
    assert len(data) == 1
    assert out["summary"]["tables_count"] == 1


def test_pdf_download_extract_handles_network_error(tmp_path):
    out = pdf_download_extract(
        url="http://example.com/report.pdf",
        out_dir=str(tmp_path),
        _fetch=_fake_fetch_timeout(),
        _parser=FakeParser([]),
    )
    assert out["ok"] is False
    assert "timed out" in out["error"]
    assert out["retryable"] is True


def test_pdf_download_extract_handles_404(tmp_path):
    out = pdf_download_extract(
        url="http://example.com/report.pdf",
        out_dir=str(tmp_path),
        _fetch=_fake_fetch_404(),
        _parser=FakeParser([]),
    )
    assert out["ok"] is False
    assert out["retryable"] is False
