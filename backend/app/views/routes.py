"""VIEW: REST routers. Parse input -> call a presenter -> return its view-model. No business logic here."""
from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.vehicles import list_vehicle_types
from app.presenters.auth import AuthPresenter
from app.presenters.base import AppError
from app.presenters.dispatch import DispatchPresenter
from app.presenters.driver import DriverPresenter
from app.presenters.fare import FarePresenter
from app.presenters.maps import MapsPresenter
from app.presenters.notifications import NotificationPresenter
from app.presenters.rating import RatingPresenter
from app.presenters.ride import RidePresenter
from app.presenters.wallet import WalletPresenter
from app.views.deps import Ctx, current_user_id, get_ctx

router = APIRouter(prefix="/v1")


# ---------- schemas ----------
class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = ""


class OtpRequest(BaseModel):
    phone: str


class OtpVerify(BaseModel):
    phone: str
    code: str


class RefreshReq(BaseModel):
    refresh_token: str


class ProfileUpdate(BaseModel):
    name: str | None = None
    email: str | None = None


class EstimateReq(BaseModel):
    pickup: Point
    drop: Point


class BookReq(BaseModel):
    quote_id: str
    vehicle_type: str
    payment_method: str = "wallet"


class CancelReq(BaseModel):
    reason: str | None = None


class StartReq(BaseModel):
    otp: str


class DriverRegister(BaseModel):
    vehicle_type: str
    vehicle_number: str
    vehicle_model: str = ""
    is_bot: bool = False  # honoured only when DEV_MODE=true (simulator drivers)


class OnlineReq(BaseModel):
    lat: float | None = None
    lng: float | None = None


class TopupReq(BaseModel):
    amount_paise: int


class RatingReq(BaseModel):
    stars: int
    tags: list[str] = []
    comment: str = ""


class PushTokenReq(BaseModel):
    token: str


class WebhookReq(BaseModel):
    url: str
    events: list[str] = []


# ---------- meta ----------
@router.get("/config", tags=["meta"])
def app_config():
    s = get_settings()
    return {"city": "Bengaluru", "center": {"lat": s.city_center_lat, "lng": s.city_center_lng},
            "service_area": list(s.bbox), "currency": "INR", "offer_timeout_s": s.offer_timeout_seconds,
            "vehicle_types": [{"id": v.id, "label": v.label, "icon": v.icon, "capacity": v.capacity,
                               "tagline": v.tagline, "enabled": en} for v, en in list_vehicle_types()]}


# ---------- 1. auth & user ----------
@router.post("/auth/otp/request", tags=["auth"])
def otp_request(b: OtpRequest, c: Ctx = Depends(get_ctx)):
    return AuthPresenter(c.db).request_otp(b.phone)


@router.post("/auth/otp/verify", tags=["auth"])
def otp_verify(b: OtpVerify, c: Ctx = Depends(get_ctx)):
    return AuthPresenter(c.db).verify_otp(b.phone, b.code)


@router.post("/auth/refresh", tags=["auth"])
def refresh(b: RefreshReq, c: Ctx = Depends(get_ctx)):
    return AuthPresenter(c.db).refresh(b.refresh_token)


@router.get("/me", tags=["auth"])
def me(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return AuthPresenter(c.db).me(uid)


@router.patch("/me", tags=["auth"])
def update_me(b: ProfileUpdate, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return AuthPresenter(c.db).update_profile(uid, b.name, b.email)


# ---------- 2. maps ----------
@router.get("/maps/autocomplete", tags=["maps"])
def autocomplete(q: str, lat: float | None = None, lng: float | None = None, uid: str = Depends(current_user_id)):
    return {"items": MapsPresenter().autocomplete(q, lat, lng)}


@router.get("/maps/geocode", tags=["maps"])
def geocode(q: str, uid: str = Depends(current_user_id)):
    return MapsPresenter().geocode(q)


@router.get("/maps/reverse", tags=["maps"])
def reverse(lat: float, lng: float, uid: str = Depends(current_user_id)):
    return MapsPresenter().reverse(lat, lng)


@router.get("/maps/route", tags=["maps"])
def route(plat: float, plng: float, dlat: float, dlng: float, uid: str = Depends(current_user_id)):
    return MapsPresenter().route(plat, plng, dlat, dlng)


# ---------- 3. fares ----------
@router.post("/fares/estimate", tags=["fares"])
def estimate(b: EstimateReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return FarePresenter(c.db).estimate(uid, b.pickup.model_dump(), b.drop.model_dump())


# ---------- 4/5/6. rides ----------
@router.post("/rides", tags=["rides"], status_code=201)
def book(b: BookReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).book(uid, b.quote_id, b.vehicle_type, b.payment_method)


@router.get("/rides/active", tags=["rides"])
def active(role: str = "rider", uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return {"ride": RidePresenter(c.db, c.events).active(uid, role)}


@router.get("/rides/history", tags=["rides"])
def history(role: str = "rider", cursor: str | None = None, limit: int = Query(20, ge=1, le=50),
            uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).history(uid, role, cursor, limit)


@router.get("/rides/{ride_id}", tags=["rides"])
def get_ride(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).get(uid, ride_id)


@router.get("/rides/{ride_id}/trail", tags=["rides"])
def trail(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).trip_points(uid, ride_id)


@router.post("/rides/{ride_id}/cancel", tags=["rides"])
def cancel(ride_id: str, b: CancelReq = CancelReq(), uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).cancel(uid, ride_id, b.reason)


# driver-side ride actions
@router.post("/rides/{ride_id}/accept", tags=["dispatch"])
def accept(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).accept(uid, ride_id)


@router.post("/rides/{ride_id}/reject", tags=["dispatch"])
def reject(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).reject(uid, ride_id)


@router.post("/rides/{ride_id}/arrived", tags=["rides"])
def arrived(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).arrived(uid, ride_id)


@router.post("/rides/{ride_id}/start", tags=["rides"])
def start(ride_id: str, b: StartReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).start(uid, ride_id, b.otp)


@router.post("/rides/{ride_id}/complete", tags=["rides"])
def complete(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RidePresenter(c.db, c.events).complete(uid, ride_id)


# ---------- 7. driver availability ----------
@router.post("/drivers/me/register", tags=["drivers"])
def driver_register(b: DriverRegister, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).register(uid, b.vehicle_type, b.vehicle_number, b.vehicle_model, b.is_bot)


@router.post("/drivers/me/online", tags=["drivers"])
def go_online(b: OnlineReq = OnlineReq(), uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).go_online(uid, b.lat, b.lng)


@router.post("/drivers/me/offline", tags=["drivers"])
def go_offline(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).go_offline(uid)


@router.get("/drivers/me/state", tags=["drivers"])
def driver_state(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).state(uid)


@router.post("/drivers/me/location", tags=["telemetry"])
def driver_location(b: Point, heading: float = 0.0, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    """HTTP fallback for telemetry (the primary channel is the /ws WebSocket)."""
    return DriverPresenter(c.db, c.events).update_location(uid, b.lat, b.lng, heading)


@router.get("/drivers/me/earnings", tags=["drivers"])
def earnings(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).earnings(uid)


@router.get("/drivers/nearby", tags=["drivers"])
def nearby(lat: float, lng: float, radius_m: int = Query(3000, le=10000),
           uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return DriverPresenter(c.db, c.events).nearby(lat, lng, radius_m)


# ---------- 10. wallet ----------
@router.get("/wallet", tags=["wallet"])
def wallet(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return WalletPresenter(c.db).balance(uid)


@router.post("/wallet/topup", tags=["wallet"])
def topup(b: TopupReq, idempotency_key: str | None = Header(default=None),
          uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return WalletPresenter(c.db).topup(uid, b.amount_paise, idempotency_key)


@router.get("/wallet/transactions", tags=["wallet"])
def transactions(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return WalletPresenter(c.db).transactions(uid)


# ---------- 11. notifications ----------
@router.get("/notifications", tags=["notifications"])
def inbox(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return NotificationPresenter(c.db, c.events).inbox(uid)


@router.post("/notifications/read", tags=["notifications"])
def read_all(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return NotificationPresenter(c.db, c.events).mark_all_read(uid)


@router.post("/notifications/push-token", tags=["notifications"])
def push_token(b: PushTokenReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return NotificationPresenter(c.db, c.events).register_push_token(uid, b.token)


@router.get("/webhooks", tags=["notifications"])
def list_webhooks(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return {"items": NotificationPresenter(c.db, c.events).list_webhooks(uid)}


@router.post("/webhooks", tags=["notifications"], status_code=201)
def add_webhook(b: WebhookReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return NotificationPresenter(c.db, c.events).add_webhook(uid, b.url, b.events)


@router.delete("/webhooks/{webhook_id}", tags=["notifications"])
def delete_webhook(webhook_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return NotificationPresenter(c.db, c.events).delete_webhook(uid, webhook_id)


# ---------- 12. ratings ----------
@router.post("/rides/{ride_id}/rating", tags=["ratings"])
def rate(ride_id: str, b: RatingReq, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RatingPresenter(c.db, c.events).rate(uid, ride_id, b.stars, b.tags, b.comment)


@router.get("/rides/{ride_id}/rating", tags=["ratings"])
def ride_ratings(ride_id: str, uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RatingPresenter(c.db, c.events).for_ride(uid, ride_id)


@router.get("/ratings/received", tags=["ratings"])
def ratings_received(uid: str = Depends(current_user_id), c: Ctx = Depends(get_ctx)):
    return RatingPresenter(c.db, c.events).received(uid)
