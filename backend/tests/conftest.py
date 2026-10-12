import os

# Point the app at the isolated test DB and make map calls deterministic/offline *before* importing the app.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg2://ride:ride@localhost:5432/ride_test")
os.environ["OSRM_URL"] = "http://127.0.0.1:9"
os.environ["NOMINATIM_URL"] = "http://127.0.0.1:9"
os.environ["ENABLED_VEHICLE_TYPES"] = "bike"
os.environ["OFFER_TIMEOUT_SECONDS"] = "15"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import db as dbm
from app.main import app

KORAMANGALA = {"lat": 12.9352, "lng": 77.6245, "address": "Koramangala 5th Block"}
INDIRANAGAR = {"lat": 12.9784, "lng": 77.6408, "address": "Indiranagar 100 Feet Road"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_db(client):
    with dbm.get_engine().begin() as conn:
        conn.execute(text("TRUNCATE users, otp_codes, drivers, fare_quotes, rides, ride_offers, ride_points, "
                          "wallet_txns, ratings, notifications, webhook_subscriptions CASCADE"))
    yield


class Actor:
    def __init__(self, client, phone):
        self.c, self.phone = client, phone
        self.c.post("/v1/auth/otp/request", json={"phone": phone})
        r = self.c.post("/v1/auth/otp/verify", json={"phone": phone, "code": "123456"}).json()
        self.token, self.user = r["access_token"], r["user"]
        self.id = self.user["id"]

    @property
    def h(self):
        return {"Authorization": f"Bearer {self.token}"}

    def get(self, url, **kw):
        return self.c.get("/v1" + url, headers=self.h, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post("/v1" + url, headers={**self.h, **kw.pop("headers", {})}, json=json or {}, **kw)


@pytest.fixture
def rider(client):
    return Actor(client, "9000000001")


@pytest.fixture
def driver(client):
    a = Actor(client, "9000000002")
    assert a.post("/drivers/me/register", {"vehicle_type": "bike", "vehicle_number": "KA01AB1234",
                                          "vehicle_model": "Honda Activa"}).status_code == 200
    assert a.post("/drivers/me/online", {"lat": 12.9360, "lng": 77.6250}).status_code == 200
    return a
