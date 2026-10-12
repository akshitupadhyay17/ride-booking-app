import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.db import create_schema, get_engine
from app.presenters.base import AppError, DeferredEvents
from app.presenters.dispatch import DispatchPresenter
from app.views import routes, ws

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")


def _dispatch_tick():
    from app.core import db as dbm
    db = dbm._SessionLocal()
    events = DeferredEvents(db, ws.hub)
    try:
        DispatchPresenter(db, events).tick()
        db.commit()
        events.flush()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def dispatch_worker():
    """Background loop: expires stale offers, moves to the next driver, times out unmatched rides."""
    while True:
        try:
            await asyncio.to_thread(_dispatch_tick)
        except Exception as e:
            log.warning("dispatch tick failed: %s", e)
        await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_engine()
    create_schema()
    ws.hub.bind_loop(asyncio.get_running_loop())
    task = asyncio.create_task(dispatch_worker())
    yield
    task.cancel()


app = FastAPI(title="Ride Booking API (Bengaluru)", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(AppError)
async def app_error_handler(_: Request, e: AppError):
    return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


app.include_router(routes.router)
app.include_router(ws.router)
