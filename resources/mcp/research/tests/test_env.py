from research_mcp.tools.env import check_env

def test_check_env_returns_ok_structure():
    r = check_env()
    assert r["ok"] is True
    assert "tushare" in r
    assert "python_version" in r

def test_check_env_tushare_false_when_no_token(monkeypatch):
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)
    r = check_env()
    assert r["tushare"] is False
    assert "hint" in r
