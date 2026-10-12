"""PRESENTER: driver availability, location telemetry, earnings."""
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.geo import haversine_m
from app.core.vehicles import VEHICLE_CATALOGUE, is_enabled
from app.models.entities import Driver, utcnow
from app.models.repositories import DriverRepository, RideRepository, UserRepository
from app.presenters.base import AppError, EventView, not_found
from app.presenters.dispatch import offer_view
from app.presenters.maps import MapsPresenter
from app.presenters.notifications import NotificationPresenter


def driver_view(d: Driver) -> dict:
    return {"vehicle_type": d.vehicle_type, "vehicle_number": d.vehicle_number,
            "vehicle_model": d.vehicle_model, "status": d.status, "lat": d.lat, "lng": d.lng}


class DriverPresenter:
    def __init__(self, db: Session, events: EventView):
        self.db, self.events = db, events
        self.s = get_settings()
        self.drivers = DriverRepository(db)
        self.rides = RideRepository(db)
        self.users = UserRepository(db)
        self.notify = NotificationPresenter(db, events)

    def register(self, user_id: str, vehicle_type: str, vehicle_number: str, vehicle_model: str,
                 is_bot: bool = False) -> dict:
        if vehicle_type not in VEHICLE_CATALOGUE:
            raise AppError(422, "invalid_vehicle", "Unknown vehicle type")
        if not is_enabled(vehicle_type):
            raise AppError(422, "vehicle_unavailable",
                           f"{VEHICLE_CATALOGUE[vehicle_type].label} partners are coming soon")
        number = vehicle_number.upper().replace(" ", "")
        if len(number) < 6:
            raise AppError(422, "invalid_vehicle_number", "Enter a valid registration number (e.g. KA01AB1234)")
        is_bot = bool(is_bot and self.s.dev_mode)
        d = self.drivers.get(user_id)
        if d:
            d.vehicle_type, d.vehicle_number, d.vehicle_model = vehicle_type, number, vehicle_model
        else:
            d = self.drivers.add(Driver(user_id=user_id, vehicle_type=vehicle_type, vehicle_number=number,
                                        vehicle_model=vehicle_model, status="offline", is_bot=is_bot,
                                        lat=self.s.city_center_lat, lng=self.s.city_center_lng))
        return driver_view(d)

    def _driver(self, user_id: str, lock: bool = False) -> Driver:
        d = self.drivers.get_for_update(user_id) if lock else self.drivers.get(user_id)
        if not d:
            raise AppError(403, "not_a_driver", "Register as a rider partner first")
        return d

    def go_online(self, user_id: str, lat: float | None, lng: float | None) -> dict:
        d = self._driver(user_id, lock=True)
        if not is_enabled(d.vehicle_type):
            raise AppError(422, "vehicle_unavailable", "Your vehicle type is not enabled yet")
        if lat is not None and lng is not None:
            if not MapsPresenter().in_service_area(lat, lng):
                raise AppError(422, "outside_service_area", "You are outside the Bengaluru service area")
            d.lat, d.lng, d.location_updated_at = lat, lng, utcnow()
        if d.status != "busy":
            d.status = "online"
        return driver_view(d)

    def go_offline(self, user_id: str) -> dict:
        d = self._driver(user_id, lock=True)
        if d.status == "busy":
            raise AppError(409, "on_trip", "Finish your current trip before going offline")
        d.status = "offline"
        return driver_view(d)

    def state(self, user_id: str) -> dict:
        d = self._driver(user_id)
        pending = self.rides.pending_offer_for_driver(user_id)
        offer = None
        if pending:
            o, r = pending
            rider = self.users.get(r.rider_id)
            offer = offer_view(o, r, rider.name if rider else "", rider.rating_avg if rider else 5.0)
        return {"driver": driver_view(d), "pending_offer": offer}

    def update_location(self, user_id: str, lat: float, lng: float, heading: float = 0.0) -> dict:
        d = self.drivers.get(user_id)
        if not d or d.status == "offline":
            return {"ok": False}
        d.lat, d.lng, d.heading, d.location_updated_at = lat, lng, heading, utcnow()
        ride = self.rides.active_for_driver(user_id)
        if ride:
            if ride.status == "ACCEPTED" and haversine_m(lat, lng, ride.pickup_lat, ride.pickup_lng) < self.s.arriving_distance_meters:
                ride.status = "ARRIVING"
                for uid in (ride.rider_id, ride.driver_id):
                    self.events.push(uid, {"type": "ride.status", "ride_id": ride.id, "status": "ARRIVING"})
                self.notify.notify(ride.rider_id, "Rider arriving", "Your rider is almost at the pickup point.",
                                   "ride.arriving", {"ride_id": ride.id})
            vt = VEHICLE_CATALOGUE[d.vehicle_type]
            target = (ride.drop_lat, ride.drop_lng) if ride.status == "IN_PROGRESS" else (ride.pickup_lat, ride.pickup_lng)
            eta_s = int(haversine_m(lat, lng, *target) * 1.3 / (vt.speed_kmph / 3.6))
            self.events.push(ride.rider_id, {"type": "driver.location", "ride_id": ride.id, "lat": lat, "lng": lng,
                                             "heading": heading, "eta_s": eta_s, "status": ride.status})
            if ride.status == "IN_PROGRESS":
                self.rides.add_point(ride.id, lat, lng)
        return {"ok": True}

    def nearby(self, lat: float, lng: float, radius_m: int = 3000) -> dict:
        """Cars shown on the rider's home map (bookable types only)."""
        out = []
        for vt_id in VEHICLE_CATALOGUE:
            if not is_enabled(vt_id):
                continue
            for d, dist in self.drivers.nearest_online(lat, lng, radius_m, vt_id, [], limit=15):
                out.append({"id": d.user_id[:6], "vehicle_type": vt_id, "lat": d.lat, "lng": d.lng,
                            "heading": d.heading})
        return {"drivers": out}

    def earnings(self, user_id: str) -> dict:
        self._driver(user_id)
        now = utcnow()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        t_amt, t_cnt = self.rides.earnings(user_id, today)
        w_amt, w_cnt = self.rides.earnings(user_id, now - timedelta(days=7))
        return {"today": {"earnings_paise": t_amt, "trips": t_cnt}, "week": {"earnings_paise": w_amt, "trips": w_cnt},
                "wallet_paise": self.users.get(user_id).wallet_paise}
