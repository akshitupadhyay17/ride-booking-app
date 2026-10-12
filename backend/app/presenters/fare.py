"""PRESENTER: fare estimation (with surge)."""
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.geo import haversine_m
from app.core.vehicles import VEHICLE_CATALOGUE, VehicleType, list_vehicle_types
from app.models.entities import FareQuote, utcnow
from app.models.repositories import DriverRepository, QuoteRepository, RideRepository
from app.presenters.base import AppError
from app.presenters.maps import MapsPresenter


def _round100(x: float) -> int:
    return int(round(x / 100.0)) * 100


def compute_fare(vt: VehicleType, distance_m: int, duration_s: int, surge: float) -> dict:
    s = get_settings()
    base = vt.base_paise
    dist = int(vt.per_km_paise * distance_m / 1000)
    tm = int(vt.per_min_paise * duration_s / 60)
    raw = base + dist + tm
    subtotal = max(vt.min_fare_paise, raw)
    min_adj = subtotal - raw
    surge_amt = _round100(subtotal * (surge - 1.0)) if surge > 1.0 else 0
    fee = s.booking_fee_paise
    taxable = subtotal + surge_amt + fee
    gst = int(round(taxable * s.gst_percent / 100))
    total = taxable + gst
    rounding = (-total) % 100
    total += rounding
    return {"base": base, "distance": dist, "time": tm, "min_fare_adjustment": min_adj, "surge": surge_amt,
            "booking_fee": fee, "gst": gst, "rounding": rounding, "total": total}


def surge_multiplier(drivers: DriverRepository, rides: RideRepository, lat: float, lng: float) -> float:
    if not get_settings().surge_enabled:
        return 1.0
    supply = drivers.count_online_near(lat, lng, 3000)
    demand = rides.count_matching_near(lat, lng, 3000)
    ratio = (demand + 1) / (supply + 1)
    if ratio <= 1.0:
        return 1.0
    if ratio <= 2.0:
        return 1.2
    if ratio <= 3.0:
        return 1.5
    return 1.8


class FarePresenter:
    def __init__(self, db: Session):
        self.db = db
        self.maps = MapsPresenter()
        self.quotes = QuoteRepository(db)
        self.drivers = DriverRepository(db)
        self.rides = RideRepository(db)
        self.s = get_settings()

    def estimate(self, rider_id: str, pickup: dict, drop: dict) -> dict:
        for p in (pickup, drop):
            if not self.maps.in_service_area(p["lat"], p["lng"]):
                raise AppError(422, "outside_service_area", "We currently operate only within Bengaluru")
        if haversine_m(pickup["lat"], pickup["lng"], drop["lat"], drop["lng"]) < 200:
            raise AppError(422, "too_short", "Pickup and drop are too close")
        route = self.maps.route(pickup["lat"], pickup["lng"], drop["lat"], drop["lng"])
        surge = surge_multiplier(self.drivers, self.rides, pickup["lat"], pickup["lng"])

        fares, options = {}, []
        for vt, enabled in list_vehicle_types():
            bd = compute_fare(vt, route["distance_m"], route["duration_s"], surge)
            fares[vt.id] = bd
            near = self.drivers.nearest_online(pickup["lat"], pickup["lng"], 6000, vt.id, [], limit=5) if enabled else []
            eta_min = None
            if near:
                eta_min = max(1, round(near[0][1] * 1.3 / (vt.speed_kmph / 3.6) / 60))
            options.append({"id": vt.id, "label": vt.label, "icon": vt.icon, "capacity": vt.capacity,
                            "tagline": vt.tagline, "enabled": enabled,
                            "coming_soon": not enabled, "fare_paise": bd["total"], "breakdown": bd,
                            "eta_pickup_min": eta_min, "drivers_nearby": len(near)})
        q = self.quotes.add(FareQuote(
            rider_id=rider_id, pickup_lat=pickup["lat"], pickup_lng=pickup["lng"],
            pickup_address=pickup.get("address", ""), drop_lat=drop["lat"], drop_lng=drop["lng"],
            drop_address=drop.get("address", ""), distance_m=route["distance_m"], duration_s=route["duration_s"],
            polyline=route["polyline"], fares=fares, surge=surge,
            expires_at=utcnow() + timedelta(seconds=self.s.quote_ttl_seconds)))
        return {"quote_id": q.id, "distance_m": q.distance_m, "duration_s": q.duration_s,
                "polyline": q.polyline, "surge": surge, "options": options,
                "expires_at": q.expires_at.isoformat(), "route_source": route["source"]}
