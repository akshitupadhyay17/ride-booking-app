"""VIEW (realtime): WebSocket hub implementing EventView, plus the /ws endpoint."""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.db import session_scope
from app.core.security import decode_token
from app.presenters.driver import DriverPresenter

log = logging.getLogger("ws")
router = APIRouter()


class WebSocketHub:
    def __init__(self):
        self.conns: dict[str, set[WebSocket]] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self.outbox: list[tuple[str, dict]] = []  # used by tests when no loop is running

    def bind_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    def is_connected(self, user_id: str) -> bool:
        return bool(self.conns.get(user_id))

    def push(self, user_id: str, event: dict) -> None:
        """Thread-safe: presenters run in worker threads, sockets live on the event loop."""
        self.outbox.append((user_id, event))
        del self.outbox[:-200]
        if self.loop and self.loop.is_running() and self.conns.get(user_id):
            asyncio.run_coroutine_threadsafe(self._send(user_id, event), self.loop)

    async def _send(self, user_id: str, event: dict):
        for ws in list(self.conns.get(user_id, ())):
            try:
                await ws.send_json(event)
            except Exception:
                self.conns.get(user_id, set()).discard(ws)


hub = WebSocketHub()


def get_event_view() -> WebSocketHub:
    return hub


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    user_id = decode_token(token)
    if not user_id:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.conns.setdefault(user_id, set()).add(ws)
    await ws.send_json({"type": "connected", "user_id": user_id})
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
            elif kind == "location":
                # Driver telemetry: handled by DriverPresenter (blocking DB work in a thread)
                await asyncio.to_thread(_handle_location, user_id, msg)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("ws error: %s", e)
    finally:
        hub.conns.get(user_id, set()).discard(ws)


def _handle_location(user_id: str, msg: dict):
    try:
        with session_scope() as db:
            DriverPresenter(db, hub).update_location(
                user_id, float(msg["lat"]), float(msg["lng"]), float(msg.get("heading", 0)))
    except Exception as e:
        log.warning("location update failed: %s", e)
