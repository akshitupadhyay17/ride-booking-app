"""PRESENTER: notifications (in-app inbox, push, SMS, signed webhooks)."""
import hashlib
import hmac
import json
import logging
import threading
import time

import httpx
from sqlalchemy.orm import Session

from app import providers
from app.core.security import new_id
from app.models.entities import Notification, User, WebhookSubscription
from app.models.repositories import NotificationRepository, UserRepository
from app.presenters.base import AppError, EventView, not_found

log = logging.getLogger("notify")


def _deliver_webhook(url: str, secret: str, payload: dict):
    body = json.dumps(payload, separators=(",", ":"), default=str)
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    for attempt in range(3):
        try:
            r = httpx.post(url, content=body, timeout=6,
                           headers={"Content-Type": "application/json", "X-Signature": f"sha256={sig}",
                                    "X-Event": payload["event"]})
            if r.status_code < 400:
                return
        except Exception as e:
            log.warning("webhook %s failed (%s)", url, e)
        time.sleep(2 ** attempt)


def serialize(n: Notification) -> dict:
    return {"id": n.id, "title": n.title, "body": n.body, "event": n.event, "data": n.data,
            "read": n.read, "created_at": n.created_at.isoformat()}


class NotificationPresenter:
    def __init__(self, db: Session, events: EventView):
        self.db, self.events = db, events
        self.repo = NotificationRepository(db)
        self.users = UserRepository(db)

    # -- used by other presenters --
    def notify(self, user_id: str, title: str, body: str, event: str, data: dict | None = None,
               sms: bool = False) -> None:
        data = data or {}
        n = self.repo.add(Notification(user_id=user_id, title=title, body=body, event=event, data=data))
        self.events.push(user_id, {"type": "notification", **serialize(n)})
        user = self.users.get(user_id)
        if user and user.push_token and not self.events.is_connected(user_id):
            providers.push().send(user.push_token, title, body, {"event": event, **data})
        if sms and user:
            providers.sms().send(user.phone, f"{title}: {body}")
        for w in self.repo.webhooks(user_id):
            if not w.events or event in w.events:
                payload = {"event": event, "user_id": user_id, "data": data, "at": n.created_at.isoformat()}
                threading.Thread(target=_deliver_webhook, args=(w.url, w.secret, payload), daemon=True).start()

    # -- API --
    def inbox(self, user_id: str) -> dict:
        return {"items": [serialize(n) for n in self.repo.list(user_id)], "unread": self.repo.unread_count(user_id)}

    def mark_all_read(self, user_id: str) -> dict:
        self.repo.mark_all_read(user_id)
        return {"ok": True}

    def register_push_token(self, user_id: str, token: str) -> dict:
        u = self.users.get(user_id)
        if not u:
            raise not_found("User")
        u.push_token = token
        return {"ok": True}

    def add_webhook(self, user_id: str, url: str, events: list[str]) -> dict:
        if not url.startswith(("http://", "https://")):
            raise AppError(422, "invalid_url", "Webhook URL must be http(s)")
        w = self.repo.add_webhook(WebhookSubscription(user_id=user_id, url=url, secret=new_id(), events=events))
        return {"id": w.id, "url": w.url, "secret": w.secret, "events": w.events}

    def list_webhooks(self, user_id: str) -> list[dict]:
        return [{"id": w.id, "url": w.url, "events": w.events} for w in self.repo.webhooks(user_id)]

    def delete_webhook(self, user_id: str, webhook_id: str) -> dict:
        if not self.repo.delete_webhook(user_id, webhook_id):
            raise not_found("Webhook")
        return {"ok": True}
