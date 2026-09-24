"""WebSocket fan-out. Background threads publish events; every connected dashboard receives them."""

import asyncio
import json

from fastapi import WebSocket


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def publish(self, event: str, data: dict) -> None:
        """Thread-safe: may be called from Kafka/chain worker threads."""
        if self.loop is None or not self.clients:
            return
        message = json.dumps({"event": event, "data": data}, default=str)
        asyncio.run_coroutine_threadsafe(self._broadcast(message), self.loop)

    async def _broadcast(self, message: str) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()
