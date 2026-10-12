"""Base types shared by all presenters."""
from typing import Protocol


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def not_found(what: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{what} not found")


def bad_request(code: str, message: str) -> AppError:
    return AppError(400, code, message)


def forbidden(message: str = "Not allowed") -> AppError:
    return AppError(403, "forbidden", message)


class EventView(Protocol):
    """The 'View' contract presenters use to push real-time updates to clients."""

    def push(self, user_id: str, event: dict) -> None: ...
    def is_connected(self, user_id: str) -> bool: ...


class DeferredEvents:
    """Buffers events on the DB session; they are delivered only after a successful commit,
    so clients never see an event describing state that was rolled back / not yet visible."""

    def __init__(self, db, inner: EventView):
        self.db, self.inner = db, inner

    def push(self, user_id: str, event: dict) -> None:
        self.db.info.setdefault("outbox", []).append((user_id, event))

    def is_connected(self, user_id: str) -> bool:
        return self.inner.is_connected(user_id)

    def flush(self) -> None:
        for uid, ev in self.db.info.pop("outbox", []):
            self.inner.push(uid, ev)
