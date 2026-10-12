"""MODEL layer: persistent entities."""
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.security import new_id


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _id():
    return mapped_column(String(32), primary_key=True, default=new_id)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = _id()
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    wallet_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    rating_avg: Mapped[float] = mapped_column(Float, default=5.0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    push_token: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[str] = _id()
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code: Mapped[str] = mapped_column(String(8))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Driver(Base):
    __tablename__ = "drivers"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(16))
    vehicle_number: Mapped[str] = mapped_column(String(20))
    vehicle_model: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(10), default="offline", index=True)  # offline|online|busy
    lat: Mapped[float] = mapped_column(Float, default=0.0)
    lng: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)


class FareQuote(Base):
    __tablename__ = "fare_quotes"
    id: Mapped[str] = _id()
    rider_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[str] = mapped_column(Text, default="")
    drop_lat: Mapped[float] = mapped_column(Float)
    drop_lng: Mapped[float] = mapped_column(Float)
    drop_address: Mapped[str] = mapped_column(Text, default="")
    distance_m: Mapped[int] = mapped_column(Integer)
    duration_s: Mapped[int] = mapped_column(Integer)
    polyline: Mapped[list] = mapped_column(JSON)
    fares: Mapped[dict] = mapped_column(JSON)  # vehicle_type -> breakdown dict
    surge: Mapped[float] = mapped_column(Float, default=1.0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Ride(Base):
    __tablename__ = "rides"
    id: Mapped[str] = _id()
    rider_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    driver_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    vehicle_type: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), index=True)
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[str] = mapped_column(Text, default="")
    drop_lat: Mapped[float] = mapped_column(Float)
    drop_lng: Mapped[float] = mapped_column(Float)
    drop_address: Mapped[str] = mapped_column(Text, default="")
    distance_m: Mapped[int] = mapped_column(Integer)
    duration_s: Mapped[int] = mapped_column(Integer)
    polyline: Mapped[list] = mapped_column(JSON)
    surge: Mapped[float] = mapped_column(Float, default=1.0)
    fare_breakdown: Mapped[dict] = mapped_column(JSON)
    fare_paise: Mapped[int] = mapped_column(Integer)
    payment_method: Mapped[str] = mapped_column(String(10), default="wallet")
    payment_status: Mapped[str] = mapped_column(String(10), default="pending")  # pending|paid|refunded|failed
    start_otp: Mapped[str] = mapped_column(String(4))
    driver_payout_paise: Mapped[int] = mapped_column(Integer, default=0)
    platform_fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    cancel_fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_by: Mapped[str | None] = mapped_column(String(10), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rejected_driver_ids: Mapped[list] = mapped_column(JSON, default=list)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RideOffer(Base):
    __tablename__ = "ride_offers"
    id: Mapped[str] = _id()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), index=True)
    driver_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending|accepted|rejected|expired
    radius_m: Mapped[int] = mapped_column(Integer)
    distance_m: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RidePoint(Base):
    """Breadcrumb trail of the driver during a trip."""
    __tablename__ = "ride_points"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WalletTxn(Base):
    __tablename__ = "wallet_txns"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger)  # signed
    balance_after: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(String(20))  # topup|ride_charge|ride_payout|commission|refund|bonus|cancel_fee
    ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_txn_idem"),)


class Rating(Base):
    __tablename__ = "ratings"
    id: Mapped[str] = _id()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), index=True)
    from_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    to_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    stars: Mapped[int] = mapped_column(Integer)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("ride_id", "from_user_id", name="uq_rating_once"),)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text, default="")
    event: Mapped[str] = mapped_column(String(40), default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class WebhookSubscription(Base):
    __tablename__ = "webhook_subscriptions"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    url: Mapped[str] = mapped_column(String(300))
    secret: Mapped[str] = mapped_column(String(64))
    events: Mapped[list] = mapped_column(JSON, default=list)  # empty = all
    active: Mapped[bool] = mapped_column(Boolean, default=True)


Index("ix_rides_status_requested", Ride.status, Ride.requested_at)
