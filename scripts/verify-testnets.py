#!/usr/bin/env python3
"""Verify configured public testnet RPCs without printing endpoint URLs or credentials."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def rpc(url: str, method: str) -> object:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": []}).encode()
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "QalamHipHop-Devnet/1.0"})
    with urllib.request.urlopen(request, timeout=12) as response:
        result = json.loads(response.read().decode())
    if "error" in result:
        raise RuntimeError(str(result["error"]))
    return result.get("result")


def main() -> int:
    env = load_env(Path(__file__).resolve().parents[1] / ".env")
    checks: list[tuple[str, str, str, object | None]] = [
        ("EVM_RPC_URL", "eth_chainId", "0xaa36a7", None),
        ("SOLANA_RPC_URL", "getHealth", "ok", None),
    ]
    failed = False
    for key, method, expected, _ in checks:
        url = env.get(key, "")
        if not url.startswith("http"):
            print(f"{key}: not configured")
            failed = True
            continue
        try:
            actual = rpc(url, method)
            ok = str(actual).lower() == expected
            print(f"{key}: {method}={actual}; expected={expected}; status={'ok' if ok else 'mismatch'}")
            failed = failed or not ok
        except urllib.error.HTTPError as exc:
            print(f"{key}: request_failed=HTTP_{exc.code}")
            failed = True
        except Exception as exc:
            print(f"{key}: request_failed={type(exc).__name__}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
