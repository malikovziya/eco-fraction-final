"""Eco-Fraction API: Intelligence, Blockchain-integration and Financial layers."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .api import banking, market as market_api, multisig, producer, public, users
from .db import SessionLocal, init_db
from .hub import hub
from .seed import seed_personas
from .services.ingest import Ingest
from .services.market import market, market_maker
from .services.settlement import settlement
from .services.simctl import simctl
from .state import platform


@asynccontextmanager
async def lifespan(app: FastAPI):
    fresh = init_db()
    platform()  # load AI models before traffic arrives
    with SessionLocal() as s:
        seed_personas(s)
    print(f"[backend] database {'reset for new deployment' if fresh else 'reused'}; personas ready", flush=True)
    hub.bind(asyncio.get_running_loop())
    simctl.start()
    settlement.start()
    Ingest(on_batch=settlement.submit).start()
    market.start()
    market_maker.start()
    yield


app = FastAPI(title="Eco-Fraction API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(public.router)
app.include_router(users.router)
app.include_router(multisig.router)
app.include_router(market_api.router)
app.include_router(banking.router)
app.include_router(producer.router)


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive; clients don't send commands over the socket
    except WebSocketDisconnect:
        hub.clients.discard(ws)
