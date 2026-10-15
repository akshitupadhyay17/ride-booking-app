"""Bot drivers for demos: they register, go online around Bengaluru, wander, and (optionally) auto-accept rides.

Run:  docker compose --profile sim up sim
Env:  SIM_DRIVERS=6  SIM_AUTO_ACCEPT=true
"""
import asyncio
import json
import math
import os
import random

import httpx
import websockets

API = os.environ.get("API_URL", "http://localhost:8000")
WS = API.replace("http", "ws", 1) + "/ws"
N = int(os.environ.get("SIM_DRIVERS", "6"))
AUTO_ACCEPT = os.environ.get("SIM_AUTO_ACCEPT", "true").lower() == "true"

HUBS = [(12.9352, 77.6245), (12.9784, 77.6408), (12.9756, 77.6068), (12.9116, 77.6389),
        (12.9250, 77.5938), (12.9569, 77.7011), (12.9780, 77.5726), (13.0358, 77.5970)]
MODELS = ["Honda Activa", "TVS Jupiter", "Bajaj Pulsar", "Hero Splendor", "Suzuki Access", "Royal Enfield Classic"]


def bearing(a, b):
    y = math.sin(math.radians(b[1] - a[1])) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - \
        math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(math.radians(b[1] - a[1]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def haversine_m(p1, p2):
    R = 6371000
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


class Bot:
    def __init__(self, idx):
        self.idx = idx
        self.phone = f"+9199000{idx:05d}"
        hub = HUBS[idx % len(HUBS)]
        self.pos = [hub[0] + random.uniform(-0.01, 0.01), hub[1] + random.uniform(-0.01, 0.01)]
        self.heading = random.uniform(0, 360)
        self.http = httpx.AsyncClient(base_url=API + "/v1", timeout=15)
        self.ride = None
        self.path: list = []
        self.path_idx: int = 0
        self.stage: str = "idle"

    async def setup(self):
        await self.http.post("/auth/otp/request", json={"phone": self.phone})
        r = (await self.http.post("/auth/otp/verify", json={"phone": self.phone, "code": os.environ.get("DEV_OTP", "123456")})).json()
        self.http.headers["Authorization"] = "Bearer " + r["access_token"]
        self.token = r["access_token"]
        await self.http.patch("/me", json={"name": random.choice(["Ravi", "Manjunath", "Suresh", "Kiran", "Naveen", "Prakash", "Imran", "Deepak"]) + f" {self.idx}"})
        if not r["user"]["is_driver"]:
            await self.http.post("/drivers/me/register", json={
                "vehicle_type": "bike", "vehicle_number": f"KA0{1 + self.idx % 9}AB{1000 + self.idx}",
                "vehicle_model": random.choice(MODELS), "is_bot": True})
        await self.http.post("/drivers/me/online", json={"lat": self.pos[0], "lng": self.pos[1]})

    async def fetch_route(self, plat, plng, dlat, dlng) -> list:
        try:
            r = await self.http.get(f"/maps/route?plat={plat}&plng={plng}&dlat={dlat}&dlng={dlng}")
            if r.status_code == 200:
                data = r.json()
                if data.get("polyline") and len(data["polyline"]) > 1:
                    return data["polyline"]
        except Exception as e:
            print(f"[bot {self.idx}] route fetch failed: {e}")
        return [[plat, plng], [dlat, dlng]]

    def step_along_path(self, speed_m=70) -> bool:
        if not self.path or self.path_idx >= len(self.path):
            return True
        budget = speed_m
        while budget > 0 and self.path_idx < len(self.path):
            target = self.path[self.path_idx]
            d = haversine_m(self.pos, target)
            if d <= budget:
                budget -= d
                if d > 1:
                    self.heading = bearing(self.pos, target)
                self.pos = list(target)
                self.path_idx += 1
            else:
                frac = budget / d
                self.heading = bearing(self.pos, target)
                self.pos = [
                    self.pos[0] + (target[0] - self.pos[0]) * frac,
                    self.pos[1] + (target[1] - self.pos[1]) * frac,
                ]
                budget = 0
        return self.path_idx >= len(self.path)

    async def run(self):
        await self.setup()
        while True:
            try:
                async with websockets.connect(f"{WS}?token={self.token}") as ws:
                    recv = asyncio.create_task(self.listen(ws))
                    try:
                        while True:
                            await self.tick(ws)
                            await asyncio.sleep(2)
                    finally:
                        recv.cancel()
            except Exception:
                await asyncio.sleep(2)

    async def listen(self, ws):
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("type") == "ride.offer" and AUTO_ACCEPT and not self.ride:
                offer = msg["offer"]
                await asyncio.sleep(random.uniform(1.5, 4))
                r = await self.http.post(f"/rides/{offer['ride_id']}/accept")
                if r.status_code == 200:
                    self.ride = r.json()
                    p_lat = self.ride["pickup"]["lat"]
                    p_lng = self.ride["pickup"]["lng"]
                    self.path = await self.fetch_route(self.pos[0], self.pos[1], p_lat, p_lng)
                    self.path_idx = 0
                    self.stage = "to_pickup"
                    print(f"[bot {self.idx}] accepted {offer['ride_id'][:6]}, following route to pickup ({len(self.path)} pts)")
            elif msg.get("type") == "ride.updated" and msg["ride"].get("status") == "CANCELLED" and self.ride \
                    and msg["ride"]["id"] == self.ride["id"]:
                self.ride = None
                self.stage = "idle"

    async def tick(self, ws):
        if not self.ride:
            # wander smoothly
            step_deg = 0.0003  # ~30 metres
            target = (self.pos[0] + math.cos(math.radians(self.heading)) * step_deg,
                      self.pos[1] + math.sin(math.radians(self.heading)) * step_deg)
            if random.random() < 0.15:
                self.heading = (self.heading + random.uniform(-45, 45)) % 360
            if not (12.8 < target[0] < 13.15 and 77.45 < target[1] < 77.78):
                self.heading = (self.heading + 180) % 360
            self.pos = list(target)
        else:
            rid = self.ride["id"]
            if self.stage == "to_pickup":
                if self.step_along_path(60):
                    await self.http.post(f"/rides/{rid}/arrived")
                    self.stage = "wait_otp"
            elif self.stage == "wait_otp":
                # Bot drivers (dev mode only) can see the start OTP; real drivers must ask the rider.
                state = (await self.http.get(f"/rides/{rid}")).json()
                if state.get("status") == "CANCELLED":
                    self.ride = None
                    self.stage = "idle"
                elif state.get("start_otp"):
                    await asyncio.sleep(3)  # pretend the rider is reading out the OTP
                    r = await self.http.post(f"/rides/{rid}/start", json={"otp": state["start_otp"]})
                    if r.status_code == 200:
                        poly = state.get("polyline") or self.ride.get("polyline")
                        if not poly or len(poly) < 2:
                            poly = await self.fetch_route(self.pos[0], self.pos[1], self.ride["drop"]["lat"], self.ride["drop"]["lng"])
                        self.path = poly
                        self.path_idx = 0
                        self.stage = "to_drop"
                        print(f"[bot {self.idx}] trip started, following route to drop ({len(self.path)} pts)")
            elif self.stage == "to_drop":
                if self.step_along_path(70):
                    await self.http.post(f"/rides/{rid}/complete")
                    self.ride = None
                    self.stage = "idle"
        await ws.send(json.dumps({"type": "location", "lat": self.pos[0], "lng": self.pos[1], "heading": self.heading}))


async def main():
    bots = [Bot(i) for i in range(N)]
    await asyncio.gather(*(b.run() for b in bots))


if __name__ == "__main__":
    import time
    print(f"Waiting for API at {API}/health to be ready...")
    ready = False
    for i in range(30):
        try:
            r = httpx.get(API + "/health", timeout=3)
            if r.status_code == 200:
                ready = True
                print("API is ready. Starting simulation bots...")
                break
        except Exception:
            pass
        time.sleep(2)
    if not ready:
        print("Error: API did not become ready in time. Exiting.")
        exit(1)
    asyncio.run(main())
