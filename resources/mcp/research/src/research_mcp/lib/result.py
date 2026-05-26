def ok(**kwargs) -> dict:
    return {"ok": True, **kwargs}

def fail(error: str, retryable: bool = False) -> dict:
    return {"ok": False, "error": error, "retryable": retryable}
