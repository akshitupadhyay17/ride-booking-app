"""PRESENTER: dispatch / matching. Sequential offers to the nearest driver with an expanding radius."""
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import Ride, RideOffer, utcnow
from app.models.repositories import DriverRepository, RideRepository, UserRepository
from app.presenters.base import EventView
from app.presenters.notifications import NotificationPresenter


def offer_view(offer: RideOffer, ride: Ride, rider_name: str, rider_rating: float) -> dict:
    s = get_settings()
    remaining = max(0, int((offer.expires_at - utcnow()).total_seconds()))
    return {"offer_id": offer.id, "ride_id": ride.id, "expires_in_s": remaining,
            "timeout_s": s.offer_timeout_seconds, "vehicle_type": ride.vehicle_type,
            "pickup": {"lat": ride.pickup_lat, "lng": ride.pickup_lng, "address": ride.pickup_address},
            "drop": {"lat": ride.drop_lat, "lng": ride.drop_lng, "address": ride.drop_address},
            "pickup_distance_m": offer.distance_m, "trip_distance_m": ride.distance_m,
            "trip_duration_s": ride.duration_s, "fare_paise": ride.fare_paise,
            "earning_paise": ride.fare_paise - ride.fare_paise * s.platform_commission_percent // 100,
            "payment_method": ride.payment_method, "rider_name": rider_name or "Rider",
            "rider_rating": round(rider_rating, 2), "polyline": ride.polyline}


class DispatchPresenter:
    def __init__(self, db: Session, events: EventView):
        self.db, self.events = db, events
        self.rides = RideRepository(db)
        self.drivers = DriverRepository(db)
        self.users = UserRepository(db)
        self.notify = NotificationPresenter(db, events)
        self.s = get_settings()

    def advance(self, ride: Ride) -> None:
        """Move one MATCHING ride forward: expire stale offer, time out, or offer to the next driver."""
        if ride.status != "MATCHING":
            return
        now = utcnow()
        pend = self.rides.pending_offer(ride.id)
        if pend:
            if pend.expires_at > now:
                return
            pend.status = "expired"
            self.events.push(pend.driver_id, {"type": "ride.offer_expired", "ride_id": ride.id})

        if (now - ride.requested_at).total_seconds() > self.s.matching_timeout_seconds:
            ride.status = "NO_DRIVERS"
            ride.payment_status = "pending"
            self.notify.notify(ride.rider_id, "No riders nearby", "We couldn't find a rider partner right now. Please try again.",
                               "ride.no_drivers", {"ride_id": ride.id})
            self.events.push(ride.rider_id, {"type": "ride.updated", "ride": {"id": ride.id, "status": ride.status}})
            return

        offered = [o.driver_id for o in self.rides.offers_for_ride(ride.id)]
        exclude = list(set((ride.rejected_driver_ids or []) + offered))
        for radius in self.s.radii:
            for drv, dist in self.rides_candidates(ride, radius, exclude):
                if self.rides.pending_offer_for_driver(drv.user_id):
                    continue  # that driver is already looking at another request
                offer = self.rides.add_offer(RideOffer(
                    ride_id=ride.id, driver_id=drv.user_id, radius_m=radius, distance_m=int(dist),
                    expires_at=now + timedelta(seconds=self.s.offer_timeout_seconds)))
                rider = self.users.get(ride.rider_id)
                self.events.push(drv.user_id, {"type": "ride.offer", "offer": offer_view(
                    offer, ride, rider.name if rider else "", rider.rating_avg if rider else 5.0)})
                self.notify.notify(drv.user_id, "New ride request",
                                   f"{ride.pickup_address or 'Pickup'} → {ride.drop_address or 'Drop'}",
                                   "ride.offer", {"ride_id": ride.id})
                return

    def rides_candidates(self, ride: Ride, radius: int, exclude: list[str]):
        return self.drivers.nearest_online(ride.pickup_lat, ride.pickup_lng, radius, ride.vehicle_type, exclude, limit=5)

    def tick(self) -> int:
        """Called by the background worker every couple of seconds."""
        n = 0
        for r in self.rides.matching():
            locked = self.rides.get_for_update(r.id)
            if locked:
                self.advance(locked)
                n += 1
        return n
