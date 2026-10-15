from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal = None


def init_engine(url: str | None = None):
    global _engine, _SessionLocal
    _engine = create_engine(url or get_settings().database_url, pool_pre_ping=True, pool_size=10)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, autoflush=True)
    return _engine


def get_engine():
    if _engine is None:
        init_engine()
    return _engine


def create_schema(max_retries: int = 15, delay_s: float = 2.0):
    import time
    import logging
    from app.models import entities  # noqa: F401  (register tables)

    log = logging.getLogger("app.db")
    engine = get_engine()
    for attempt in range(max_retries):
        try:
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            break
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            log.warning("DB not ready yet (attempt %d/%d): %s. Retrying in %ss...", attempt + 1, max_retries, e, delay_s)
            time.sleep(delay_s)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # Partial, geography expression index: only online drivers are indexed.
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_drivers_online_geo ON drivers USING GIST "
            "((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography)) WHERE status = 'online'"
        ))


def get_db() -> Iterator[Session]:
    if _SessionLocal is None:
        get_engine()
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    if _SessionLocal is None:
        get_engine()
    db = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
