"""Read-only OpenRouter check: key limits/usage, model availability, per-provider pricing. Never prints the key.

  python openrouter_check.py [--model qwen/qwen2.5-vl-72b-instruct]
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qsa.qwen_client import SSL_CONTEXT  # noqa: E402

API = "https://openrouter.ai/api/v1"


def get(path: str, key: str | None = None) -> dict:
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {key}"} if key else {})
    with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as r:
        return json.loads(r.read())


def key_status(key: str) -> dict:
    d = get("/key", key)["data"]
    return {k: d.get(k) for k in ("limit", "limit_remaining", "usage", "usage_daily", "is_free_tier", "limit_reset")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen/qwen2.5-vl-72b-instruct")
    a = ap.parse_args()
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("OPENROUTER_API_KEY is not set")
    out = {"keyPresent": True, "keyLength": len(key), "key": key_status(key)}
    models = get("/models")["data"]
    m = next((x for x in models if x["id"] == a.model), None)
    out["model"] = None if m is None else {k: m.get(k) for k in ("id", "name", "context_length", "pricing", "architecture", "top_provider")}
    out["similarIds"] = sorted(x["id"] for x in models if "qwen2.5-vl" in x["id"] or "qwen-2.5-vl" in x["id"])
    if m:
        eps = get(f"/models/{a.model}/endpoints")["data"]["endpoints"]
        out["endpoints"] = [{k: e.get(k) for k in ("provider_name", "tag", "status", "pricing", "context_length", "max_completion_tokens", "quantization", "supported_parameters")} for e in eps]
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
