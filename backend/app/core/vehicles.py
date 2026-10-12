from dataclasses import dataclass

from app.core.config import get_settings


@dataclass(frozen=True)
class VehicleType:
    id: str
    label: str
    icon: str          # icon key understood by the mobile app
    capacity: int
    base_paise: int
    per_km_paise: int
    per_min_paise: int
    min_fare_paise: int
    speed_kmph: float  # used for fallback ETA and nearby-driver ETA
    tagline: str


# Every vehicle type is defined so the app can always show them.
# Which ones can actually be booked is controlled by ENABLED_VEHICLE_TYPES.
VEHICLE_CATALOGUE: dict[str, VehicleType] = {
    "bike": VehicleType("bike", "Bike", "bike", 1, 2000, 700, 100, 3000, 28, "Fastest through traffic"),
    "auto": VehicleType("auto", "Auto", "auto", 3, 3000, 1200, 150, 4500, 22, "Affordable rides"),
    "mini": VehicleType("mini", "Mini", "car", 4, 5000, 1200, 150, 7000, 24, "Compact AC cabs"),
    "sedan": VehicleType("sedan", "Sedan", "car", 4, 7000, 1500, 200, 9500, 24, "Comfortable sedans"),
    "suv": VehicleType("suv", "SUV", "suv", 6, 9000, 1900, 250, 12000, 24, "Spacious rides for groups"),
}


def is_enabled(vehicle_type: str) -> bool:
    return vehicle_type in get_settings().enabled_types and vehicle_type in VEHICLE_CATALOGUE


def list_vehicle_types() -> list[tuple[VehicleType, bool]]:
    """All types, with whether each is currently bookable."""
    return [(v, is_enabled(v.id)) for v in VEHICLE_CATALOGUE.values()]
