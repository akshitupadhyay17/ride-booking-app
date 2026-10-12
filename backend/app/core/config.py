from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = "postgresql+psycopg2://ride:ride@localhost:5432/ride"
    test_database_url: str = "postgresql+psycopg2://ride:ride@localhost:5432/ride_test"

    jwt_secret: str = "dev-secret"
    jwt_access_minutes: int = 60 * 24
    dev_mode: bool = True
    dev_otp: str = "123456"
    otp_ttl_seconds: int = 300

    enabled_vehicle_types: str = "bike"

    offer_timeout_seconds: int = 15
    search_radii_meters: str = "2000,4000,6000"
    matching_timeout_seconds: int = 75
    arriving_distance_meters: int = 400
    quote_ttl_seconds: int = 300

    surge_enabled: bool = True
    platform_commission_percent: int = 20
    signup_bonus_paise: int = 50000
    booking_fee_paise: int = 500
    gst_percent: int = 5
    free_cancel_seconds: int = 120
    cancel_fee_paise: int = 2000

    # Bangalore service area (min_lat, min_lng, max_lat, max_lng)
    service_area: str = "12.70,77.30,13.30,77.90"
    city_center_lat: float = 12.9716
    city_center_lng: float = 77.5946

    osrm_url: str = "https://router.project-osrm.org"
    nominatim_url: str = "https://nominatim.openstreetmap.org"

    sms_provider: str = "mock"
    payment_provider: str = "mock"
    push_provider: str = "expo"

    @property
    def radii(self) -> list[int]:
        return [int(x) for x in self.search_radii_meters.split(",") if x.strip()]

    @property
    def enabled_types(self) -> set[str]:
        return {x.strip().lower() for x in self.enabled_vehicle_types.split(",") if x.strip()}

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        a, b, c, d = (float(x) for x in self.service_area.split(","))
        return a, b, c, d


@lru_cache
def get_settings() -> Settings:
    return Settings()
