"""Eco-Fraction API: entry point for the Intelligence, Blockchain and Financial layers."""

import socket

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Eco-Fraction API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _tcp_up(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _chain_block() -> int | None:
    try:
        r = httpx.post(
            "http://localhost:8545",
            json={"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1},
            timeout=1,
        )
        return int(r.json()["result"], 16)
    except Exception:
        return None


@app.get("/api/health")
def health() -> dict:
    block = _chain_block()
    return {
        "api": True,
        "mqtt": _tcp_up("localhost", 1883),
        "kafka": _tcp_up("localhost", 19092),
        "chain": block is not None,
        "chainBlock": block,
    }
