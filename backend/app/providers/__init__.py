"""Pluggable third-party providers. Mock implementations are used by default."""
import logging
import threading
from typing import Protocol

import httpx

from app.core.config import get_settings
from app.core.security import new_id

log = logging.getLogger("providers")


class SmsProvider(Protocol):
    def send(self, phone: str, message: str) -> None: ...


class MockSms:
    def send(self, phone: str, message: str) -> None:
        log.warning("[MOCK SMS] to %s: %s", phone, message)


class PushProvider(Protocol):
    def send(self, token: str, title: str, body: str, data: dict) -> None: ...


class ExpoPush:
    def send(self, token: str, title: str, body: str, data: dict) -> None:
        if not token or not token.startswith("ExponentPushToken"):
            return

        def _go():
            try:
                httpx.post("https://exp.host/--/api/v2/push/send", timeout=8,
                           json={"to": token, "title": title, "body": body, "data": data, "sound": "default"})
            except Exception as e:  # never break a ride because of push
                log.warning("push failed: %s", e)
        threading.Thread(target=_go, daemon=True).start()


class PaymentGateway(Protocol):
    def charge(self, user_id: str, amount_paise: int, method: str) -> tuple[bool, str]: ...


class MockGateway:
    """Always succeeds, except for amounts ending in 13 paise (handy for failure demos)."""

    def charge(self, user_id: str, amount_paise: int, method: str) -> tuple[bool, str]:
        if amount_paise % 100 == 13:
            return False, ""
        return True, "mock_" + new_id()[:12]


_sms: SmsProvider = MockSms()
_push: PushProvider = ExpoPush()
_gateway: PaymentGateway = MockGateway()


def sms() -> SmsProvider:
    return _sms


def push() -> PushProvider:
    return _push


def gateway() -> PaymentGateway:
    return _gateway
