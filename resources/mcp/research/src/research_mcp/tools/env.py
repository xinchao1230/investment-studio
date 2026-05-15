import os
import platform

def check_env() -> dict:
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    return {
        "ok": True,
        "tushare": bool(token),
        "python_version": platform.python_version(),
        "hint": "请在 Settings → 投研 API 配置 Tushare token" if not token else None,
    }
