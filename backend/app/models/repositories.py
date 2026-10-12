"""MODEL layer: repositories (all DB access lives here, presenters never write SQL)."""
from __future__ import annotations
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.models.entities import (
    Driver, FareQuote, Notification, OtpCode, Rating, Ride, RideOffer, RidePoint, User,
    WalletTxn, WebhookSubscription, utcnow,
)

ACTIVE_RIDE_STATES = ("MATCHING", "ACCEPTED", "ARRIVING", "ARRIVED", "IN_PROGRESS")


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: str) -> User | None:
        return self.db.get(User, user_id)

    def get_for_update(self, user_id: str) -> User | None:
        return self.db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()

    def by_phone(self, phone: str) -> User | None:
        return self.db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()

    def add(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        return user

    def save_otp(self, phone: str, code: str, ttl_s: int):
        self.db.add(OtpCode(phone=phone, code=code, expires_at=utcnow() + timedelta(seconds=ttl_s)))
        self.db.flush()

    def consume_otp(self, phone: str, code: str) -> bool:
        row = self.db.execute(
            select(OtpCode).where(OtpCode.phone == phone, OtpCode.code == code, OtpCode.used.is_(False),
                                  OtpCode.expires_at > utcnow()).order_by(OtpCode.expires_at.desc()).limit(1)
        ).scalar_one_or_none()
        if not row:
            return False
        row.used = True
        return True


class DriverRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: str) -> Driver | None:
        return self.db.get(Driver, user_id)

    def get_for_update(self, user_id: str) -> Driver | None:
        return self.db.execute(select(Driver).where(Driver.user_id == user_id).with_for_update()).scalar_one_or_none()

    def add(self, d: Driver) -> Driver:
        self.db.add(d)
        self.db.flush()
        return d

    def nearest_online(self, lat: float, lng: float, radius_m: int, vehicle_type: str,
                       exclude: list[str], limit: int = 5) -> list[tuple[Driver, float]]:
        """PostGIS radius search backed by a partial GiST index (online drivers only)."""
        sql = text("""
            SELECT user_id,
                   ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                               ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS dist
            FROM drivers
            WHERE status = 'online' AND vehicle_type = :vt
              AND ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                             ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :r)
              AND NOT (user_id = ANY(:excl))
            ORDER BY dist ASC LIMIT :lim
        """)
        rows = self.db.execute(sql, {"lat": lat, "lng": lng, "vt": vehicle_type, "r": radius_m,
                                     "excl": exclude or [""], "lim": limit}).all()
        out = []
        for uid, dist in rows:
            d = self.db.get(Driver, uid)
            if d:
                out.append((d, float(dist)))
        return out

    def count_online_near(self, lat: float, lng: float, radius_m: int) -> int:
        sql = text("""SELECT count(*) FROM drivers WHERE status='online'
                      AND ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                                     ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :r)""")
        return int(self.db.execute(sql, {"lat": lat, "lng": lng, "r": radius_m}).scalar() or 0)

    def counts_by_status(self) -> dict[str, int]:
        rows = self.db.execute(select(Driver.status, func.count()).group_by(Driver.status)).all()
        return {s: c for s, c in rows}


class RideRepository:
    def __init__(self, db: Session):
        self.db = db

    def add(self, ride: Ride) -> Ride:
        self.db.add(ride)
        self.db.flush()
        return ride

    def get(self, ride_id: str) -> Ride | None:
        return self.db.get(Ride, ride_id)

    def get_for_update(self, ride_id: str) -> Ride | None:
        return self.db.execute(select(Ride).where(Ride.id == ride_id).with_for_update()).scalar_one_or_none()

    def active_for_rider(self, rider_id: str) -> Ride | None:
        return self.db.execute(
            select(Ride).where(Ride.rider_id == rider_id, Ride.status.in_(ACTIVE_RIDE_STATES))
            .order_by(Ride.requested_at.desc()).limit(1)).scalar_one_or_none()

    def active_for_driver(self, driver_id: str) -> Ride | None:
        return self.db.execute(
            select(Ride).where(Ride.driver_id == driver_id,
                               Ride.status.in_(("ACCEPTED", "ARRIVING", "ARRIVED", "IN_PROGRESS")))
            .order_by(Ride.requested_at.desc()).limit(1)).scalar_one_or_none()

    def matching(self) -> list[Ride]:
        return list(self.db.execute(select(Ride).where(Ride.status == "MATCHING")).scalars())

    def count_matching_near(self, lat: float, lng: float, radius_m: int) -> int:
        sql = text("""SELECT count(*) FROM rides WHERE status='MATCHING'
                      AND ST_DWithin(ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography,
                                     ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :r)""")
        return int(self.db.execute(sql, {"lat": lat, "lng": lng, "r": radius_m}).scalar() or 0)

    def history(self, user_id: str, role: str, before: datetime | None, limit: int) -> list[Ride]:
        col = Ride.rider_id if role == "rider" else Ride.driver_id
        q = select(Ride).where(col == user_id, Ride.status.in_(("COMPLETED", "CANCELLED", "NO_DRIVERS")))
        if before:
            q = q.where(Ride.requested_at < before)
        return list(self.db.execute(q.order_by(Ride.requested_at.desc()).limit(limit)).scalars())

    def earnings(self, driver_id: str, since: datetime) -> tuple[int, int]:
        row = self.db.execute(
            select(func.coalesce(func.sum(Ride.driver_payout_paise), 0), func.count())
            .where(Ride.driver_id == driver_id, Ride.status == "COMPLETED", Ride.completed_at >= since)).one()
        return int(row[0]), int(row[1])

    # offers
    def add_offer(self, offer: RideOffer) -> RideOffer:
        self.db.add(offer)
        self.db.flush()
        return offer

    def offers_for_ride(self, ride_id: str) -> list[RideOffer]:
        return list(self.db.execute(select(RideOffer).where(RideOffer.ride_id == ride_id)).scalars())

    def pending_offer(self, ride_id: str) -> RideOffer | None:
        return self.db.execute(select(RideOffer).where(
            RideOffer.ride_id == ride_id, RideOffer.status == "pending").limit(1)).scalar_one_or_none()

    def pending_offer_for_driver(self, driver_id: str) -> tuple[RideOffer, Ride] | None:
        row = self.db.execute(
            select(RideOffer, Ride).join(Ride, Ride.id == RideOffer.ride_id)
            .where(RideOffer.driver_id == driver_id, RideOffer.status == "pending",
                   RideOffer.expires_at > utcnow(), Ride.status == "MATCHING").limit(1)).first()
        return (row[0], row[1]) if row else None

    def add_point(self, ride_id: str, lat: float, lng: float):
        self.db.add(RidePoint(ride_id=ride_id, lat=lat, lng=lng))

    def points(self, ride_id: str) -> list[RidePoint]:
        return list(self.db.execute(select(RidePoint).where(RidePoint.ride_id == ride_id)
                                    .order_by(RidePoint.id)).scalars())


class QuoteRepository:
    def __init__(self, db: Session):
        self.db = db

    def add(self, q: FareQuote) -> FareQuote:
        self.db.add(q)
        self.db.flush()
        return q

    def get(self, quote_id: str) -> FareQuote | None:
        return self.db.get(FareQuote, quote_id)


class WalletRepository:
    def __init__(self, db: Session):
        self.db = db

    def txn_by_idem(self, user_id: str, key: str) -> WalletTxn | None:
        return self.db.execute(select(WalletTxn).where(
            WalletTxn.user_id == user_id, WalletTxn.idempotency_key == key)).scalar_one_or_none()

    def add(self, t: WalletTxn) -> WalletTxn:
        self.db.add(t)
        self.db.flush()
        return t

    def list(self, user_id: str, limit: int = 50) -> list[WalletTxn]:
        return list(self.db.execute(select(WalletTxn).where(WalletTxn.user_id == user_id)
                                    .order_by(WalletTxn.created_at.desc()).limit(limit)).scalars())


class RatingRepository:
    def __init__(self, db: Session):
        self.db = db

    def exists(self, ride_id: str, from_user_id: str) -> bool:
        return self.db.execute(select(Rating.id).where(
            Rating.ride_id == ride_id, Rating.from_user_id == from_user_id)).first() is not None

    def add(self, r: Rating) -> Rating:
        self.db.add(r)
        self.db.flush()
        return r

    def for_ride(self, ride_id: str) -> list[Rating]:
        return list(self.db.execute(select(Rating).where(Rating.ride_id == ride_id)).scalars())

    def received(self, user_id: str, limit: int = 20) -> list[Rating]:
        return list(self.db.execute(select(Rating).where(Rating.to_user_id == user_id)
                                    .order_by(Rating.created_at.desc()).limit(limit)).scalars())


class NotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def add(self, n: Notification) -> Notification:
        self.db.add(n)
        self.db.flush()
        return n

    def list(self, user_id: str, limit: int = 50) -> list[Notification]:
        return list(self.db.execute(select(Notification).where(Notification.user_id == user_id)
                                    .order_by(Notification.created_at.desc()).limit(limit)).scalars())

    def mark_all_read(self, user_id: str):
        self.db.execute(update(Notification).where(Notification.user_id == user_id).values(read=True))

    def unread_count(self, user_id: str) -> int:
        return int(self.db.execute(select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.read.is_(False))).scalar() or 0)

    def webhooks(self, user_id: str) -> list[WebhookSubscription]:
        return list(self.db.execute(select(WebhookSubscription).where(
            WebhookSubscription.user_id == user_id, WebhookSubscription.active.is_(True))).scalars())

    def add_webhook(self, w: WebhookSubscription) -> WebhookSubscription:
        self.db.add(w)
        self.db.flush()
        return w

    def delete_webhook(self, user_id: str, webhook_id: str) -> bool:
        w = self.db.get(WebhookSubscription, webhook_id)
        if not w or w.user_id != user_id:
            return False
        self.db.delete(w)
        return True
