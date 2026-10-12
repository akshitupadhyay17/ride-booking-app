"""PRESENTER: auth & user management."""
import re

from sqlalchemy.orm import Session

from app import providers
from app.core.config import get_settings
from app.core.security import create_token, decode_token
from app.models.entities import User, WalletTxn
from app.models.repositories import DriverRepository, UserRepository, WalletRepository
from app.presenters.base import AppError, not_found

PHONE_RE = re.compile(r"^\+?[0-9]{10,13}$")


def normalize_phone(phone: str) -> str:
    p = re.sub(r"[\s\-]", "", phone)
    if not PHONE_RE.match(p):
        raise AppError(422, "invalid_phone", "Enter a valid phone number")
    if not p.startswith("+"):
        p = "+91" + p[-10:]
    return p


def user_view(u: User, driver=None) -> dict:
    return {"id": u.id, "phone": u.phone, "name": u.name, "email": u.email,
            "wallet_paise": u.wallet_paise, "rating_avg": round(u.rating_avg, 2), "rating_count": u.rating_count,
            "is_driver": driver is not None,
            "driver": None if driver is None else {
                "vehicle_type": driver.vehicle_type, "vehicle_number": driver.vehicle_number,
                "vehicle_model": driver.vehicle_model, "status": driver.status}}


class AuthPresenter:
    def __init__(self, db: Session):
        self.db = db
        self.users = UserRepository(db)
        self.drivers = DriverRepository(db)
        self.wallet = WalletRepository(db)
        self.s = get_settings()

    def request_otp(self, phone: str) -> dict:
        phone = normalize_phone(phone)
        code = self.s.dev_otp if self.s.dev_mode else f"{__import__('random').randint(0, 999999):06d}"
        self.users.save_otp(phone, code, self.s.otp_ttl_seconds)
        providers.sms().send(phone, f"Your Ride login code is {code}")
        out = {"ok": True, "ttl_seconds": self.s.otp_ttl_seconds}
        if self.s.dev_mode:
            out["dev_otp"] = code
        return out

    def verify_otp(self, phone: str, code: str) -> dict:
        phone = normalize_phone(phone)
        if not self.users.consume_otp(phone, code):
            raise AppError(401, "invalid_otp", "Invalid or expired code")
        user = self.users.by_phone(phone)
        is_new = user is None
        if is_new:
            user = self.users.add(User(phone=phone, name="", wallet_paise=self.s.signup_bonus_paise))
            if self.s.signup_bonus_paise:
                self.wallet.add(WalletTxn(user_id=user.id, amount_paise=self.s.signup_bonus_paise,
                                          balance_after=self.s.signup_bonus_paise, kind="bonus", ref="signup"))
        return {"access_token": create_token(user.id), "refresh_token": create_token(user.id, "refresh"),
                "is_new": is_new, "user": user_view(user, self.drivers.get(user.id))}

    def refresh(self, refresh_token: str) -> dict:
        uid = decode_token(refresh_token, "refresh")
        if not uid or not self.users.get(uid):
            raise AppError(401, "invalid_token", "Invalid refresh token")
        return {"access_token": create_token(uid), "refresh_token": create_token(uid, "refresh")}

    def me(self, user_id: str) -> dict:
        u = self.users.get(user_id)
        if not u:
            raise not_found("User")
        return user_view(u, self.drivers.get(user_id))

    def update_profile(self, user_id: str, name: str | None, email: str | None) -> dict:
        u = self.users.get(user_id)
        if not u:
            raise not_found("User")
        if name is not None:
            u.name = name.strip()[:80]
        if email is not None:
            u.email = email.strip()[:120] or None
        return user_view(u, self.drivers.get(user_id))
