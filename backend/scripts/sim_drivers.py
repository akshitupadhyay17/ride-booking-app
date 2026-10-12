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

    def step_towards(self, target, speed_m=25):
        dlat, dlng = target[0] - self.pos[0], target[1] - self.pos[1]
        d = math.hypot(dlat * 111000, dlng * 108000)
        if d < speed_m:
            self.pos = list(target)
            return True
        self.heading = bearing(self.pos, target)
        self.pos[0] += dlat * speed_m / d
        self.pos[1] += dlng * speed_m / d
        return False

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
                    self.path = [(self.ride["pickup"]["lat"], self.ride["pickup"]["lng"])]
                    self.stage = "to_pickup"
                    print(f"[bot {self.idx}] accepted {offer['ride_id'][:6]}")
            elif msg.get("type") == "ride.updated" and msg["ride"].get("status") == "CANCELLED" and self.ride \
                    and msg["ride"]["id"] == self.ride["id"]:
                self.ride = None

    async def tick(self, ws):
        if not self.ride:
            # wander
            target = (self.pos[0] + math.cos(math.radians(self.heading)) * 0.002,
                      self.pos[1] + math.sin(math.radians(self.heading)) * 0.002)
            if random.random() < 0.15:
                self.heading = random.uniform(0, 360)
            if not (12.8 < target[0] < 13.15 and 77.45 < target[1] < 77.78):
                self.heading = (self.heading + 180) % 360
            self.pos = list(target)
        else:
            rid = self.ride["id"]
            if self.stage == "to_pickup":
                if self.step_towards((self.ride["pickup"]["lat"], self.ride["pickup"]["lng"]), 120):
                    await self.http.post(f"/rides/{rid}/arrived")
                    self.stage = "wait_otp"
            elif self.stage == "wait_otp":
                # Bot drivers (dev mode only) can see the start OTP; real drivers must ask the rider.
                state = (await self.http.get(f"/rides/{rid}")).json()
                if state.get("status") == "CANCELLED":
                    self.ride = None
                elif state.get("start_otp"):
                    await asyncio.sleep(3)  # pretend the rider is reading out the OTP
                    r = await self.http.post(f"/rides/{rid}/start", json={"otp": state["start_otp"]})
                    if r.status_code == 200:
                        self.stage = "to_drop"
            elif self.stage == "to_drop":
                if self.step_towards((self.ride["drop"]["lat"], self.ride["drop"]["lng"]), 120):
                    await self.http.post(f"/rides/{rid}/complete")
                    self.ride = None
        await ws.send(json.dumps({"type": "location", "lat": self.pos[0], "lng": self.pos[1], "heading": self.heading}))


async def main():
    bots = [Bot(i) for i in range(N)]
    await asyncio.gather(*(b.run() for b in bots))


if __name__ == "__main__":
    import time
    for _ in range(30):
        try:
            httpx.get(API + "/health", timeout=3)
            break
        except Exception:
            time.sleep(2)
    asyncio.run(main())
