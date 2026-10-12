import time
import uuid

import jwt

from app.core.config import get_settings


def new_id() -> str:
    return uuid.uuid4().hex


def create_token(user_id: str, kind: str = "access") -> str:
    s = get_settings()
    ttl = s.jwt_access_minutes * 60 * (30 if kind == "refresh" else 1)
    return jwt.encode({"sub": user_id, "typ": kind, "exp": int(time.time()) + ttl}, s.jwt_secret, algorithm="HS256")


def decode_token(token: str, kind: str = "access") -> str | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data["sub"] if data.get("typ") == kind else None
