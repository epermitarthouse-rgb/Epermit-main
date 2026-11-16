"""OpenAI-compatible chat client for Qwen2.5-VL deployments.

One request shape covers a local llama.cpp server and hosted Qwen2.5-VL endpoints. Hosted
backends are paid: they refuse to run unless the caller passes approve_paid, and every call is
checked against a USD cap before it starts.
"""
from __future__ import annotations

import base64
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# USD per 1M tokens, checked 2026-11-16 (OpenRouter and DashScope list pages).
BACKENDS = {
    "local-3b": {
        "baseUrl": "http://127.0.0.1:8091/v1", "model": "Qwen2.5-VL-3B-Instruct-Q4_K_M", "keyEnv": None,
        "paid": False, "inputPerM": 0.0, "outputPerM": 0.0,
        "runtime": "llama.cpp b12438 llama-server, CPU (x86_64), GGUF ggml-org/Qwen2.5-VL-3B-Instruct-GGUF Q4_K_M + mmproj f16",
    },
    "local-3b-metal": {
        "baseUrl": "http://127.0.0.1:8092/v1", "model": "Qwen2.5-VL-3B-Instruct-Q4_K_M", "keyEnv": None,
        "paid": False, "inputPerM": 0.0, "outputPerM": 0.0,
        "runtime": "llama.cpp b12438 built from source with GGML_METAL=ON (Intel Iris Plus 655 via Metal), same GGUF files as local-3b",
    },
    "openrouter-72b": {
        "baseUrl": "https://openrouter.ai/api/v1", "model": "qwen/qwen2.5-vl-72b-instruct", "keyEnv": "OPENROUTER_API_KEY",
        "paid": True, "inputPerM": 0.80, "outputPerM": 1.00, "runtime": "OpenRouter hosted Qwen2.5-VL-72B-Instruct (provider Parasail, fp8, no fallback)",
        "extraBody": {"provider": {"order": ["Parasail"], "allow_fallbacks": False}, "usage": {"include": True}},
    },
    "dashscope-72b": {
        "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "qwen2.5-vl-72b-instruct", "keyEnv": "DASHSCOPE_API_KEY",
        "paid": True, "inputPerM": 0.25, "outputPerM": 0.75, "runtime": "Alibaba Model Studio hosted Qwen2.5-VL-72B-Instruct",
    },
}

# python.org builds ship without a CA bundle; fall back to the macOS system bundle.
_CAFILE = os.environ.get("SSL_CERT_FILE") or ("/etc/ssl/cert.pem" if Path("/etc/ssl/cert.pem").exists() else None)
SSL_CONTEXT = ssl.create_default_context(cafile=_CAFILE)

PATCH = 28
PROMPT_OVERHEAD_TOKENS = 420


def image_tokens(width: int, height: int) -> int:
    return (width // PATCH) * (height // PATCH)


def estimate_cost(backend: str, images: list[tuple[int, int]], output_tokens_each: int) -> dict:
    b = BACKENDS[backend]
    inp = sum(image_tokens(w, h) + PROMPT_OVERHEAD_TOKENS for w, h in images)
    out = output_tokens_each * len(images)
    return {"calls": len(images), "inputTokens": inp, "outputTokens": out,
            "usd": round(inp * b["inputPerM"] / 1e6 + out * b["outputPerM"] / 1e6, 4)}


class BudgetExceeded(RuntimeError):
    pass


class Ledger:
    """Append-only spend record for one paid backend, shared by every run and every worker thread.

    A call reserves its worst-case cost before it is sent; the cap counts settled spend, open
    reservations and the provider-reported key usage (whichever is higher), so neither concurrent
    requests nor delayed usage reporting can push spend past the cap. A call whose outcome is
    unknown (timeout, dropped connection) is charged its worst case.
    """

    def __init__(self, path: Path, cap_usd: float):
        self.path, self.cap = Path(path), float(cap_usd)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.reserved = 0.0
        self.provider_usage = 0.0
        self.settled = sum(json.loads(l)["chargedUsd"] for l in self.path.read_text().splitlines() if l.strip()) if self.path.exists() else 0.0

    def committed(self) -> float:
        return max(self.settled, self.provider_usage) + self.reserved

    def reserve(self, usd: float) -> None:
        with self.lock:
            if self.committed() + usd > self.cap:
                raise BudgetExceeded(f"cap ${self.cap:.2f}: settled ${self.settled:.4f}, provider ${self.provider_usage:.4f}, in flight ${self.reserved:.4f}, next ${usd:.4f}")
            self.reserved += usd

    def settle(self, reserved: float, entry: dict) -> None:
        with self.lock:
            self.reserved -= reserved
            self.settled += entry["chargedUsd"]
            with self.path.open("a") as f:
                f.write(json.dumps(entry) + "\n")

    def observe_provider_usage(self, usd: float) -> None:
        with self.lock:
            self.provider_usage = max(self.provider_usage, float(usd))


RETRY_HTTP = {408, 429, 500, 502, 503, 504}
WORST_INPUT_FACTOR = 1.5


@dataclass
class QwenClient:
    backend: str
    approve_paid: bool = False
    max_usd: float = 0.0
    timeout_s: int = 900
    max_tokens: int = 2048
    ledger_path: Path | None = None

    def __post_init__(self):
        self.cfg = BACKENDS[self.backend]
        self.ledger = None
        if self.cfg["paid"]:
            if not self.approve_paid:
                raise PermissionError(f"backend {self.backend} is paid; rerun with --approve-paid and --max-usd after approval")
            if not self.ledger_path:
                raise PermissionError(f"backend {self.backend} is paid; a spend ledger path is required")
            self.ledger = Ledger(self.ledger_path, self.max_usd)
        self.key = os.environ.get(self.cfg["keyEnv"]) if self.cfg["keyEnv"] else None
        if self.cfg["keyEnv"] and not self.key:
            raise RuntimeError(f"{self.cfg['keyEnv']} is not set")

    @property
    def spent_usd(self) -> float:
        return self.ledger.settled if self.ledger else 0.0

    def worst_case_usd(self, width: int, height: int) -> float:
        inp = (image_tokens(width, height) + PROMPT_OVERHEAD_TOKENS) * WORST_INPUT_FACTOR
        return inp * self.cfg["inputPerM"] / 1e6 + self.max_tokens * self.cfg["outputPerM"] / 1e6

    def key_usage(self) -> dict | None:
        """Provider-side usage of the key (OpenRouter only); feeds the ledger's cap check."""
        if not self.backend.startswith("openrouter"):
            return None
        req = urllib.request.Request(f"{self.cfg['baseUrl']}/key", headers={"Authorization": f"Bearer {self.key}"})
        with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as r:
            d = json.loads(r.read())["data"]
        if self.ledger:
            self.ledger.observe_provider_usage(d.get("usage") or 0)
        return {k: d.get(k) for k in ("limit", "limit_remaining", "usage")}

    def chat_image(self, image_path: Path, width: int, height: int, prompt: str, tag: str = "") -> dict:
        worst = self.worst_case_usd(width, height)
        if self.ledger:
            self.ledger.reserve(worst)
        data = base64.b64encode(Path(image_path).read_bytes()).decode()
        body = {
            "model": self.cfg["model"],
            "temperature": 0,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{data}"}},
                {"type": "text", "text": prompt},
            ]}],
            **self.cfg.get("extraBody", {}),
        }
        if self.backend.startswith("dashscope"):
            body["vl_high_resolution_images"] = False
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(f"{self.cfg['baseUrl']}/chat/completions", data=json.dumps(body).encode(), headers=headers)
        ctx = SSL_CONTEXT if self.cfg["baseUrl"].startswith("https") else None
        started = time.time()
        payload, error, charged_unknown = None, None, False
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s, context=ctx) as resp:
                    payload = json.loads(resp.read())
                if payload.get("error"):
                    error, payload = f"provider error: {str(payload['error'])[:300]}", None
                break
            except urllib.error.HTTPError as e:
                error = f"HTTP {e.code}: {e.read()[:300]!r}"
                if e.code not in RETRY_HTTP:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                error, charged_unknown = f"{type(e).__name__}: {e}", True
                break
            time.sleep(5 * (attempt + 1))
        latency = time.time() - started
        usage = (payload or {}).get("usage") or {}
        pin, pout = int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
        list_cost = pin * self.cfg["inputPerM"] / 1e6 + pout * self.cfg["outputPerM"] / 1e6
        reported = usage.get("cost")
        charged = worst if charged_unknown else max(list_cost, float(reported or 0)) if payload else 0.0
        if self.ledger:
            self.ledger.settle(worst, {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "ok": payload is not None, "error": error,
                                       "promptTokens": pin, "completionTokens": pout, "reportedUsd": reported, "listUsd": round(list_cost, 6),
                                       "chargedUsd": round(charged, 6), "unconfirmed": charged_unknown, "latencyS": round(latency, 2),
                                       "generationId": (payload or {}).get("id"), "provider": (payload or {}).get("provider")})
        if payload is None:
            raise RuntimeError(error)
        choice = (payload.get("choices") or [{}])[0]
        return {
            "backend": self.backend, "model": payload.get("model") or self.cfg["model"], "provider": payload.get("provider"),
            "generationId": payload.get("id"),
            "text": (choice.get("message") or {}).get("content") or "",
            "finishReason": choice.get("finish_reason"),
            "promptTokens": pin, "completionTokens": pout, "costUsd": round(charged, 6), "reportedCostUsd": reported,
            "latencyS": round(latency, 2), "timings": payload.get("timings"),
        }
