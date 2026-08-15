#!/usr/bin/env python3
"""Inspect configured Solana signer safely; never print secret material."""
from __future__ import annotations

import base64
import json
import os
import urllib.request
from pathlib import Path

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(data: bytes) -> str:
    number = int.from_bytes(data, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = ALPHABET[remainder] + encoded
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + (encoded or "1")


def read_env() -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in Path(__file__).resolve().parents[1].joinpath(".env").read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            result[key] = value.strip().strip('"').strip("'")
    return result


def signer_bytes(raw: str) -> bytes:
    source = Path(raw).expanduser()
    if source.exists():
        raw = source.read_text().strip()
    if raw.startswith("["):
        values = json.loads(raw)
        return bytes(values)
    try:
        return base64.b64decode(raw, validate=True)
    except Exception:
        raise ValueError("SOLANA_KEYPAIR must be a JSON keypair array, a readable keypair file, or base64")


def rpc(url: str, method: str, params: list[object]) -> object:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": "QalamHipHop-Devnet/1.0"})
    with urllib.request.urlopen(req, timeout=15) as response:
        data = json.loads(response.read().decode())
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]


def main() -> int:
    env = read_env()
    raw = env.get("SOLANA_KEYPAIR", "")
    rpc_url = env.get("SOLANA_RPC_URL", "")
    if not raw or not rpc_url.startswith("http"):
        raise SystemExit("SOLANA_KEYPAIR or SOLANA_RPC_URL is not configured")
    secret = signer_bytes(raw)
    if len(secret) not in (32, 64):
        raise SystemExit(f"unsupported signer material length: {len(secret)} bytes")
    if len(secret) != 64:
        raise SystemExit("SOLANA_KEYPAIR must include the 64-byte Solana keypair so its public address can be verified")
    address = b58encode(secret[32:])
    balance = rpc(rpc_url, "getBalance", [address, {"commitment": "confirmed"}])
    lamports = int(balance.get("value", 0))
    print(f"signer_address={address}")
    print(f"balance_lamports={lamports}")
    print(f"balance_sol={lamports / 1_000_000_000:.9f}")
    return 0 if lamports > 5_000_000 else 2


if __name__ == "__main__":
    raise SystemExit(main())
