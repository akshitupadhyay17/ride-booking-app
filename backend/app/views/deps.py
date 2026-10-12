"""VIEW: request-scoped wiring (DB session + deferred events + auth)."""
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core import db as dbm
from app.core.security import decode_token
from app.presenters.base import AppError, DeferredEvents
from app.views.ws import get_event_view


@dataclass
class Ctx:
    db: Session
    events: DeferredEvents


def get_ctx() -> Iterator[Ctx]:
    """One transaction per request. Commit first, then deliver buffered WebSocket events."""
    if dbm._SessionLocal is None:
        dbm.get_engine()
    db = dbm._SessionLocal()
    events = DeferredEvents(db, get_event_view())
    try:
        yield Ctx(db, events)
        db.commit()
        events.flush()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def current_user_id(authorization: str = Header(default="")) -> str:
    token = authorization.removeprefix("Bearer ").strip()
    uid = decode_token(token) if token else None
    if not uid:
        raise AppError(401, "unauthorized", "Please log in again")
    return uid
