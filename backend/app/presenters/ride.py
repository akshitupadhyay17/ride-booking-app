"""PRESENTER: ride booking, status machine, history, and driver-side ride actions."""
import random
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.geo import haversine_m
from app.core.vehicles import VEHICLE_CATALOGUE, is_enabled
from app.models.entities import Ride, utcnow
from app.models.repositories import (
    DriverRepository, QuoteRepository, RatingRepository, RideRepository, UserRepository,
)
from app.presenters.base import AppError, EventView, bad_request, forbidden, not_found
from app.presenters.dispatch import DispatchPresenter, offer_view
from app.presenters.notifications import NotificationPresenter
from app.presenters.wallet import WalletPresenter

# status machine
TRANSITIONS = {
    "MATCHING": {"ACCEPTED", "CANCELLED", "NO_DRIVERS"},
    "ACCEPTED": {"ARRIVING", "ARRIVED", "CANCELLED", "MATCHING"},
    "ARRIVING": {"ARRIVED", "CANCELLED", "MATCHING"},
    "ARRIVED": {"IN_PROGRESS", "CANCELLED", "MATCHING"},
    "IN_PROGRESS": {"COMPLETED"},
}
STATUS_TEXT = {
    "ACCEPTED": ("Rider assigned", "Your rider is on the way to pick you up."),
    "ARRIVING": ("Rider arriving", "Your rider is almost at the pickup point."),
    "ARRIVED": ("Rider arrived", "Your rider is waiting at the pickup point."),
    "IN_PROGRESS": ("Trip started", "Enjoy your ride!"),
    "COMPLETED": ("Trip completed", "Thanks for riding with us."),
}


def _iso(d: datetime | None):
    return d.isoformat() if d else None


class RidePresenter:
    def __init__(self, db: Session, events: EventView):
        self.db, self.events = db, events
        self.s = get_settings()
        self.rides = RideRepository(db)
        self.users = UserRepository(db)
        self.drivers = DriverRepository(db)
        self.quotes = QuoteRepository(db)
        self.ratings = RatingRepository(db)
        self.wallet = WalletPresenter(db)
        self.notify = NotificationPresenter(db, events)
        self.dispatch = DispatchPresenter(db, events)

    # ---------- view-model ----------
    def view(self, ride: Ride, viewer_id: str, detail: bool = True) -> dict:
        rider = self.users.get(ride.rider_id)
        drv_user = self.users.get(ride.driver_id) if ride.driver_id else None
        drv = self.drivers.get(ride.driver_id) if ride.driver_id else None
        is_rider = viewer_id == ride.rider_id
        v = {
            "id": ride.id, "status": ride.status, "vehicle_type": ride.vehicle_type,
            "pickup": {"lat": ride.pickup_lat, "lng": ride.pickup_lng, "address": ride.pickup_address},
            "drop": {"lat": ride.drop_lat, "lng": ride.drop_lng, "address": ride.drop_address},
            "distance_m": ride.distance_m, "duration_s": ride.duration_s, "surge": ride.surge,
            "fare_paise": ride.fare_paise, "fare_breakdown": ride.fare_breakdown,
            "payment_method": ride.payment_method, "payment_status": ride.payment_status,
            "cancel_fee_paise": ride.cancel_fee_paise, "cancelled_by": ride.cancelled_by,
            "cancel_reason": ride.cancel_reason,
            "driver_payout_paise": ride.driver_payout_paise if not is_rider else None,
            "requested_at": _iso(ride.requested_at), "accepted_at": _iso(ride.accepted_at),
            "started_at": _iso(ride.started_at), "completed_at": _iso(ride.completed_at),
            "role": "rider" if is_rider else "driver",
            "rated": self.ratings.exists(ride.id, viewer_id),
            "rider": {"id": rider.id, "name": rider.name or "Rider", "rating": round(rider.rating_avg, 2)} if rider else None,
            "driver": None,
        }
        if drv_user and drv:
            v["driver"] = {"id": drv_user.id, "name": drv_user.name or "Rider partner",
                           "rating": round(drv_user.rating_avg, 2), "rating_count": drv_user.rating_count,
                           "vehicle_type": drv.vehicle_type, "vehicle_number": drv.vehicle_number,
                           "vehicle_model": drv.vehicle_model, "lat": drv.lat, "lng": drv.lng, "heading": drv.heading,
                           "phone": drv_user.phone if ride.status in ("ACCEPTED", "ARRIVING", "ARRIVED", "IN_PROGRESS") else None}
        bot_viewer = (not is_rider) and drv is not None and drv.is_bot and self.s.dev_mode
        if (is_rider or bot_viewer) and ride.status in ("ACCEPTED", "ARRIVING", "ARRIVED"):
            v["start_otp"] = ride.start_otp
        if detail:
            v["polyline"] = ride.polyline
        return v

    def _emit(self, ride: Ride, title: str | None = None, body: str | None = None, event: str | None = None):
        """Send the fresh ride state to both parties, plus optional notification."""
        for uid in filter(None, (ride.rider_id, ride.driver_id)):
            self.events.push(uid, {"type": "ride.updated", "ride": self.view(ride, uid)})
        if title and event:
            self.notify.notify(ride.rider_id, title, body or "", event, {"ride_id": ride.id, "status": ride.status},
                               sms=ride.status in ("ACCEPTED", "ARRIVED"))

    def _transition(self, ride: Ride, to: str):
        if to not in TRANSITIONS.get(ride.status, set()):
            raise AppError(409, "invalid_transition", f"Cannot go from {ride.status} to {to}")
        ride.status = to

    # ---------- rider API ----------
    def book(self, rider_id: str, quote_id: str, vehicle_type: str, payment_method: str) -> dict:
        if payment_method not in ("wallet", "cash"):
            raise AppError(422, "invalid_payment", "Payment method must be wallet or cash")
        if vehicle_type not in VEHICLE_CATALOGUE:
            raise AppError(422, "invalid_vehicle", "Unknown vehicle type")
        if not is_enabled(vehicle_type):
            raise AppError(422, "vehicle_unavailable", f"{VEHICLE_CATALOGUE[vehicle_type].label} rides are coming soon")
        q = self.quotes.get(quote_id)
        if not q or q.rider_id != rider_id:
            raise not_found("Fare quote")
        if q.expires_at < utcnow():
            raise AppError(410, "quote_expired", "Fare expired, please check the fare again")
        if self.rides.active_for_rider(rider_id):
            raise AppError(409, "ride_in_progress", "You already have an active ride")
        bd = q.fares.get(vehicle_type)
        if not bd:
            raise AppError(422, "invalid_vehicle", "Vehicle type not in this quote")
        user = self.users.get(rider_id)
        if payment_method == "wallet" and user.wallet_paise < bd["total"]:
            raise AppError(402, "insufficient_balance", "Insufficient wallet balance. Add money or pay by cash.")
        ride = self.rides.add(Ride(
            rider_id=rider_id, vehicle_type=vehicle_type, status="MATCHING",
            pickup_lat=q.pickup_lat, pickup_lng=q.pickup_lng, pickup_address=q.pickup_address,
            drop_lat=q.drop_lat, drop_lng=q.drop_lng, drop_address=q.drop_address,
            distance_m=q.distance_m, duration_s=q.duration_s, polyline=q.polyline, surge=q.surge,
            fare_breakdown=bd, fare_paise=bd["total"], payment_method=payment_method,
            start_otp=f"{random.randint(0, 9999):04d}", rejected_driver_ids=[]))
        self.dispatch.advance(ride)
        return self.view(ride, rider_id)

    def get(self, user_id: str, ride_id: str) -> dict:
        ride = self._owned(user_id, ride_id)
        return self.view(ride, user_id)

    def _owned(self, user_id: str, ride_id: str, lock: bool = False) -> Ride:
        ride = self.rides.get_for_update(ride_id) if lock else self.rides.get(ride_id)
        if not ride:
            raise not_found("Ride")
        if user_id not in (ride.rider_id, ride.driver_id):
            raise forbidden("This ride doesn't belong to you")
        return ride

    def active(self, user_id: str, role: str) -> dict | None:
        ride = self.rides.active_for_rider(user_id) if role == "rider" else self.rides.active_for_driver(user_id)
        return self.view(ride, user_id) if ride else None

    def history(self, user_id: str, role: str, cursor: str | None, limit: int) -> dict:
        before = datetime.fromisoformat(cursor) if cursor else None
        rows = self.rides.history(user_id, role, before, limit + 1)
        more = len(rows) > limit
        rows = rows[:limit]
        return {"items": [self.view(r, user_id, detail=False) for r in rows],
                "next_cursor": _iso(rows[-1].requested_at) if more and rows else None}

    def cancel(self, user_id: str, ride_id: str, reason: str | None) -> dict:
        ride = self._owned(user_id, ride_id, lock=True)
        now = utcnow()
        if ride.status in ("COMPLETED", "CANCELLED", "NO_DRIVERS"):
            raise AppError(409, "invalid_transition", "Ride is already finished")
        if ride.status == "IN_PROGRESS":
            raise AppError(409, "invalid_transition", "A trip in progress can't be cancelled")

        if user_id == ride.driver_id:
            # Driver backs out: free the driver, send the ride back into matching.
            drv = self.drivers.get_for_update(user_id)
            if drv:
                drv.status = "online"
            ride.rejected_driver_ids = list(ride.rejected_driver_ids or []) + [user_id]
            ride.driver_id, ride.accepted_at = None, None
            ride.status = "MATCHING"
            ride.requested_at = now
            self.events.push(user_id, {"type": "ride.updated", "ride": {"id": ride.id, "status": "CANCELLED", "role": "driver"}})
            self._emit(ride, "Finding another rider", "Your rider cancelled. We're finding you a new one.", "ride.reassigning")
            self.dispatch.advance(ride)
            return self.view(ride, user_id)

        # Rider cancels
        fee = 0
        if ride.driver_id and ride.accepted_at and (
                ride.status == "ARRIVED" or (now - ride.accepted_at).total_seconds() > self.s.free_cancel_seconds):
            fee = self.s.cancel_fee_paise
        driver_id = ride.driver_id
        ride.status, ride.cancelled_by, ride.cancel_reason = "CANCELLED", "rider", reason
        ride.cancel_fee_paise = fee
        if fee:
            self.wallet.post(ride.rider_id, -fee, "cancel_fee", ref=ride.id, allow_negative=True)
            self.wallet.post(driver_id, fee * (100 - self.s.platform_commission_percent) // 100, "ride_payout",
                             ref=ride.id)
            ride.payment_status = "paid"
        if driver_id:
            drv = self.drivers.get_for_update(driver_id)
            if drv:
                drv.status = "online"
            self.notify.notify(driver_id, "Ride cancelled", "The rider cancelled this trip.", "ride.cancelled",
                               {"ride_id": ride.id})
        pend = self.rides.pending_offer(ride.id)
        if pend:
            pend.status = "expired"
            self.events.push(pend.driver_id, {"type": "ride.offer_expired", "ride_id": ride.id})
        for uid in filter(None, (ride.rider_id, driver_id)):
            self.events.push(uid, {"type": "ride.updated", "ride": self.view(ride, uid)})
        return self.view(ride, user_id)

    # ---------- driver API ----------
    def _driver_ride(self, driver_id: str, ride_id: str) -> Ride:
        ride = self.rides.get_for_update(ride_id)
        if not ride:
            raise not_found("Ride")
        if ride.driver_id != driver_id:
            raise forbidden("This ride is not assigned to you")
        return ride

    def accept(self, driver_id: str, ride_id: str) -> dict:
        ride = self.rides.get_for_update(ride_id)
        if not ride:
            raise not_found("Ride")
        offer = next((o for o in self.rides.offers_for_ride(ride_id)
                      if o.driver_id == driver_id and o.status == "pending"), None)
        if ride.status != "MATCHING" or not offer or offer.expires_at < utcnow():
            raise AppError(409, "offer_unavailable", "This request is no longer available")
        drv = self.drivers.get_for_update(driver_id)
        if not drv or drv.status != "online":
            raise AppError(409, "not_online", "You must be online to accept rides")
        offer.status = "accepted"
        ride.driver_id, ride.accepted_at, ride.status = driver_id, utcnow(), "ACCEPTED"
        drv.status = "busy"
        title, body = STATUS_TEXT["ACCEPTED"]
        self._emit(ride, title, body, "ride.accepted")
        return self.view(ride, driver_id)

    def reject(self, driver_id: str, ride_id: str) -> dict:
        ride = self.rides.get_for_update(ride_id)
        if not ride:
            raise not_found("Ride")
        for o in self.rides.offers_for_ride(ride_id):
            if o.driver_id == driver_id and o.status == "pending":
                o.status = "rejected"
        ride.rejected_driver_ids = list(ride.rejected_driver_ids or []) + [driver_id]
        self.dispatch.advance(ride)
        return {"ok": True}

    def arrived(self, driver_id: str, ride_id: str) -> dict:
        ride = self._driver_ride(driver_id, ride_id)
        self._transition(ride, "ARRIVED")
        title, body = STATUS_TEXT["ARRIVED"]
        self._emit(ride, title, f"{body} Share OTP {ride.start_otp} to start the trip.", "ride.arrived")
        return self.view(ride, driver_id)

    def start(self, driver_id: str, ride_id: str, otp: str) -> dict:
        ride = self._driver_ride(driver_id, ride_id)
        if ride.status != "ARRIVED":
            raise AppError(409, "invalid_transition", "Mark arrival at pickup before starting the trip")
        if otp != ride.start_otp:
            raise AppError(422, "wrong_otp", "Incorrect OTP. Ask the rider for the 4-digit code.")
        self._transition(ride, "IN_PROGRESS")
        ride.started_at = utcnow()
        title, body = STATUS_TEXT["IN_PROGRESS"]
        self._emit(ride, title, body, "ride.started")
        return self.view(ride, driver_id)

    def complete(self, driver_id: str, ride_id: str) -> dict:
        ride = self._driver_ride(driver_id, ride_id)
        self._transition(ride, "COMPLETED")
        ride.completed_at = utcnow()
        fare = ride.fare_paise
        commission = fare * self.s.platform_commission_percent // 100
        payout = fare - commission
        ride.platform_fee_paise, ride.driver_payout_paise = commission, payout
        if ride.payment_method == "wallet":
            self.wallet.post(ride.rider_id, -fare, "ride_charge", ref=ride.id, allow_negative=True)
            self.wallet.post(driver_id, payout, "ride_payout", ref=ride.id)
        else:  # cash collected by the driver; the platform commission is debited from the driver's wallet
            self.wallet.post(driver_id, -commission, "commission", ref=ride.id, allow_negative=True)
        ride.payment_status = "paid"
        drv = self.drivers.get_for_update(driver_id)
        if drv:
            drv.status = "online"
        title, body = STATUS_TEXT["COMPLETED"]
        self._emit(ride, title, f"{body} Total ₹{fare / 100:.0f}.", "ride.completed")
        self.notify.notify(driver_id, "Trip completed", f"You earned ₹{payout / 100:.0f}.", "ride.completed",
                           {"ride_id": ride.id})
        return self.view(ride, driver_id)

    def trip_points(self, user_id: str, ride_id: str) -> dict:
        ride = self._owned(user_id, ride_id)
        return {"points": [[p.lat, p.lng] for p in self.rides.points(ride.id)]}
