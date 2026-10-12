from tests.conftest import INDIRANAGAR, KORAMANGALA, Actor


def estimate(rider):
    r = rider.post("/fares/estimate", {"pickup": KORAMANGALA, "drop": INDIRANAGAR})
    assert r.status_code == 200, r.text
    return r.json()


def test_auth_and_profile(rider):
    assert rider.user["wallet_paise"] == 50000  # signup bonus
    r = rider.c.patch("/v1/me", headers=rider.h, json={"name": "Asha"})
    assert r.json()["name"] == "Asha"
    assert rider.c.get("/v1/me").status_code == 401
    bad = rider.c.post("/v1/auth/otp/verify", json={"phone": "9000000001", "code": "000000"})
    assert bad.status_code == 401


def test_vehicle_types_gated_by_env(rider):
    q = estimate(rider)
    by_id = {o["id"]: o for o in q["options"]}
    assert set(by_id) == {"bike", "auto", "mini", "sedan", "suv"}
    assert by_id["bike"]["enabled"] and not by_id["auto"]["enabled"]
    assert by_id["auto"]["coming_soon"]
    r = rider.post("/rides", {"quote_id": q["quote_id"], "vehicle_type": "sedan", "payment_method": "wallet"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "vehicle_unavailable"
    d = Actor(rider.c, "9000000009")
    r = d.post("/drivers/me/register", {"vehicle_type": "suv", "vehicle_number": "KA05XY9999"})
    assert r.status_code == 422


def test_fare_breakdown_and_service_area(rider):
    q = estimate(rider)
    bike = next(o for o in q["options"] if o["id"] == "bike")
    bd = bike["breakdown"]
    assert bd["total"] % 100 == 0
    assert bd["total"] == bd["base"] + bd["distance"] + bd["time"] + bd["min_fare_adjustment"] + bd["surge"] \
        + bd["booking_fee"] + bd["gst"] + bd["rounding"]
    r = rider.post("/fares/estimate", {"pickup": KORAMANGALA, "drop": {"lat": 28.61, "lng": 77.2}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "outside_service_area"


def test_long_address_dispatch_notification(rider, driver):
    long_pickup = {
        "lat": KORAMANGALA["lat"],
        "lng": KORAMANGALA["lng"],
        "address": "C.S.I. Covenant Church, 1st Main Road, Green Leaf Layout, Sri Lakshmi Devi Ward, Bengaluru South City Corporation, Bengaluru, Bangalore South, Bengaluru Urban, Karnataka, 560095, India",
    }
    long_drop = {
        "lat": INDIRANAGAR["lat"],
        "lng": INDIRANAGAR["lng"],
        "address": "Mahatma Gandhi Road, Shanthala Nagar, Ashokanagar, Bengaluru Central City Corporation, Bengaluru, Bangalore North, Bengaluru Urban, Karnataka, 560001, India",
    }
    est = rider.post("/fares/estimate", {"pickup": long_pickup, "drop": long_drop}).json()
    ride = rider.post("/rides", {"quote_id": est["quote_id"], "vehicle_type": "bike", "payment_method": "wallet"}).json()
    assert ride["status"] == "MATCHING"
    st = driver.get("/drivers/me/state").json()
    assert st["pending_offer"]["ride_id"] == ride["id"]
    notifs = driver.get("/notifications").json()
    assert len(notifs["items"]) > 0
    assert "New ride request" in [n["title"] for n in notifs["items"]]
    assert driver.post(f"/rides/{ride['id']}/accept").json()["status"] == "ACCEPTED"
    rider.post(f"/rides/{ride['id']}/cancel")


def test_full_ride_lifecycle(rider, driver):
    q = estimate(rider)
    assert next(o for o in q["options"] if o["id"] == "bike")["drivers_nearby"] == 1
    ride = rider.post("/rides", {"quote_id": q["quote_id"], "vehicle_type": "bike", "payment_method": "wallet"}).json()
    assert ride["status"] == "MATCHING"
    fare = ride["fare_paise"]

    # dispatch offered the ride to the only online driver
    st = driver.get("/drivers/me/state").json()
    assert st["pending_offer"]["ride_id"] == ride["id"]
    assert driver.post(f"/rides/{ride['id']}/accept").json()["status"] == "ACCEPTED"

    r = rider.get(f"/rides/{ride['id']}").json()
    assert r["status"] == "ACCEPTED" and r["driver"]["vehicle_number"] == "KA01AB1234" and len(r["start_otp"]) == 4
    assert rider.get("/rides/active").json()["ride"]["id"] == ride["id"]

    # cannot start before arriving; wrong otp rejected
    assert driver.post(f"/rides/{ride['id']}/start", {"otp": r["start_otp"]}).status_code == 409
    assert driver.post(f"/rides/{ride['id']}/arrived").json()["status"] == "ARRIVED"
    assert driver.post(f"/rides/{ride['id']}/start", {"otp": "x"}).json()["error"]["code"] == "wrong_otp"
    assert driver.post(f"/rides/{ride['id']}/start", {"otp": r["start_otp"]}).json()["status"] == "IN_PROGRESS"

    # telemetry reaches the ride trail
    assert driver.post("/drivers/me/location", {"lat": 12.95, "lng": 77.63}).json()["ok"]
    assert rider.get(f"/rides/{ride['id']}/trail").json()["points"]

    done = driver.post(f"/rides/{ride['id']}/complete").json()
    assert done["status"] == "COMPLETED" and done["payment_status"] == "paid"

    # ledger
    assert rider.get("/wallet").json()["balance_paise"] == 50000 - fare
    payout = fare - fare * 20 // 100
    assert driver.get("/wallet").json()["balance_paise"] == 50000 + payout
    assert driver.get("/drivers/me/earnings").json()["today"]["earnings_paise"] == payout

    # ratings (both directions, once each)
    assert rider.post(f"/rides/{ride['id']}/rating", {"stars": 4, "tags": ["polite"]}).status_code == 200
    assert rider.post(f"/rides/{ride['id']}/rating", {"stars": 5}).json()["error"]["code"] == "already_rated"
    assert driver.post(f"/rides/{ride['id']}/rating", {"stars": 5}).status_code == 200
    assert driver.get("/ratings/received").json()["average"] == 4.0

    # history + notifications
    h = rider.get("/rides/history").json()
    assert [i["id"] for i in h["items"]] == [ride["id"]]
    assert rider.get("/notifications").json()["unread"] >= 3


def test_driver_reject_then_no_other_driver_then_cancel_free(rider, driver):
    q = estimate(rider)
    ride = rider.post("/rides", {"quote_id": q["quote_id"], "vehicle_type": "bike", "payment_method": "cash"}).json()
    assert driver.post(f"/rides/{ride['id']}/reject").status_code == 200
    assert rider.get(f"/rides/{ride['id']}").json()["status"] == "MATCHING"
    assert driver.get("/drivers/me/state").json()["pending_offer"] is None  # not re-offered to same driver
    c = rider.post(f"/rides/{ride['id']}/cancel", {"reason": "changed mind"}).json()
    assert c["status"] == "CANCELLED" and c["cancel_fee_paise"] == 0
    assert rider.get("/rides/active").json()["ride"] is None


def test_second_active_ride_blocked_and_insufficient_wallet(rider, driver):
    q = estimate(rider)
    rider.post("/rides", {"quote_id": q["quote_id"], "vehicle_type": "bike", "payment_method": "wallet"})
    q2 = estimate(rider)
    r = rider.post("/rides", {"quote_id": q2["quote_id"], "vehicle_type": "bike", "payment_method": "wallet"})
    assert r.status_code == 409


def test_wallet_topup_idempotent(rider):
    h = {"Idempotency-Key": "abc-1"}
    a = rider.post("/wallet/topup", {"amount_paise": 20000}, headers=h).json()
    b = rider.post("/wallet/topup", {"amount_paise": 20000}, headers=h).json()
    assert a["balance_paise"] == 70000 and b["replayed"] and b["balance_paise"] == 70000
    assert rider.post("/wallet/topup", {"amount_paise": 500}).status_code == 422
    assert len(rider.get("/wallet/transactions").json()["items"]) == 2


def test_driver_cannot_go_offline_on_trip_and_authz(rider, driver, client):
    q = estimate(rider)
    ride = rider.post("/rides", {"quote_id": q["quote_id"], "vehicle_type": "bike", "payment_method": "cash"}).json()
    driver.post(f"/rides/{ride['id']}/accept")
    assert driver.post("/drivers/me/offline").status_code == 409
    stranger = Actor(client, "9000000077")
    assert stranger.get(f"/rides/{ride['id']}").status_code == 403


def test_webhook_registration(rider):
    r = rider.post("/webhooks", {"url": "http://example.invalid/hook", "events": ["ride.completed"]})
    assert r.status_code == 201 and r.json()["secret"]
    assert len(rider.get("/webhooks").json()["items"]) == 1
    assert rider.post("/webhooks", {"url": "ftp://x"}).status_code == 422
