"""PRESENTER: maps, routing & geocoding (OSRM / Nominatim with offline fallbacks)."""
import logging
import time
from functools import lru_cache

import httpx

from app.core.config import get_settings
from app.core.geo import haversine_m, in_bbox
from app.presenters.base import AppError

log = logging.getLogger("maps")
UA = {"User-Agent": "RideBookingPrototype/1.0 (prototype)"}

# Offline fallback: popular Bangalore places
PLACES = [
    ("Majestic (KSR Bengaluru Railway Station)", 12.9780, 77.5726),
    ("MG Road Metro Station", 12.9756, 77.6068),
    ("Indiranagar 100 Feet Road", 12.9784, 77.6408),
    ("Koramangala 5th Block", 12.9352, 77.6245),
    ("HSR Layout Sector 1", 12.9116, 77.6389),
    ("Whitefield (ITPL)", 12.9858, 77.7370),
    ("Electronic City Phase 1", 12.8452, 77.6602),
    ("Jayanagar 4th Block", 12.9250, 77.5938),
    ("JP Nagar 6th Phase", 12.8906, 77.5850),
    ("Hebbal Flyover", 13.0358, 77.5970),
    ("Marathahalli Bridge", 12.9569, 77.7011),
    ("BTM Layout 2nd Stage", 12.9166, 77.6101),
    ("Yelahanka New Town", 13.1007, 77.5963),
    ("Banashankari Temple", 12.9254, 77.5468),
    ("Malleshwaram 8th Cross", 13.0035, 77.5700),
    ("Cubbon Park", 12.9763, 77.5929),
    ("Lalbagh Botanical Garden", 12.9507, 77.5848),
    ("Bangalore Palace", 12.9988, 77.5921),
    ("Kempegowda International Airport", 13.1986, 77.7066),
    ("Manyata Tech Park", 13.0475, 77.6209),
    ("Bellandur (Ecospace)", 12.9260, 77.6762),
    ("Sarjapur Road (Wipro Junction)", 12.9121, 77.6446),
    ("Phoenix Marketcity Mahadevapura", 12.9965, 77.6960),
    ("UB City", 12.9719, 77.5963),
    ("Rajajinagar Metro", 12.9915, 77.5520),
]


@lru_cache(maxsize=256)
def _nominatim_cached(base_url: str, bbox: tuple, q: str) -> tuple:
    a, b, c, d = bbox
    try:
        r = httpx.get(f"{base_url}/search", timeout=4, headers=UA, params={
            "q": q, "format": "jsonv2", "limit": 6, "countrycodes": "in", "bounded": 1,
            "viewbox": f"{b},{c},{d},{a}"})
        r.raise_for_status()
        return tuple((x["display_name"].split(",")[0], x["display_name"], float(x["lat"]), float(x["lon"]))
                     for x in r.json())
    except Exception as e:
        log.info("nominatim search unavailable: %s", e)
        return ()


def decode_polyline(s: str) -> list[list[float]]:
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(s):
        for axis in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += d
            else:
                lng += d
        pts.append([lat / 1e5, lng / 1e5])
    return pts


def _straight(plat, plng, dlat, dlng) -> dict:
    dist = haversine_m(plat, plng, dlat, dlng) * 1.35  # road factor
    steps = 24
    poly = [[plat + (dlat - plat) * t / steps, plng + (dlng - plng) * t / steps] for t in range(steps + 1)]
    return {"distance_m": int(dist), "duration_s": int(dist / (22 / 3.6)), "polyline": poly, "source": "fallback"}


class MapsPresenter:
    def __init__(self):
        self.s = get_settings()

    def in_service_area(self, lat: float, lng: float) -> bool:
        return in_bbox(lat, lng, self.s.bbox)

    def autocomplete(self, q: str, lat: float | None = None, lng: float | None = None) -> list[dict]:
        q = q.strip()
        if len(q) < 2:
            return []
        ql = q.lower()
        out = [{"name": n, "address": f"{n}, Bengaluru", "lat": a, "lng": b, "source": "local"}
               for n, a, b in PLACES if ql in n.lower()]
        out += self._nominatim_search(q)
        seen, uniq = set(), []
        for r in out:
            k = (round(r["lat"], 3), round(r["lng"], 3))
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        if lat is not None and lng is not None:
            uniq.sort(key=lambda r: haversine_m(lat, lng, r["lat"], r["lng"]))
        return uniq[:8]

    def geocode(self, q: str) -> dict:
        res = self.autocomplete(q)
        if not res:
            raise AppError(404, "not_found", "No matching place in Bengaluru")
        return res[0]

    def _nominatim_search(self, q: str) -> list[dict]:
        rows = _nominatim_cached(self.s.nominatim_url, self.s.bbox, q.lower())
        return [{"name": n, "address": a, "lat": la, "lng": lo, "source": "osm"} for n, a, la, lo in rows]

    def reverse(self, lat: float, lng: float) -> dict:
        try:
            r = httpx.get(f"{self.s.nominatim_url}/reverse", timeout=4, headers=UA,
                          params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 18})
            r.raise_for_status()
            addr = r.json().get("display_name")
            if addr:
                return {"name": addr.split(",")[0], "address": addr, "lat": lat, "lng": lng}
        except Exception as e:
            log.info("reverse geocode unavailable: %s", e)
        near = min(PLACES, key=lambda p: haversine_m(lat, lng, p[1], p[2]))
        if haversine_m(lat, lng, near[1], near[2]) < 2500:
            return {"name": f"Near {near[0]}", "address": f"Near {near[0]}, Bengaluru", "lat": lat, "lng": lng}
        return {"name": "Pinned location", "address": f"{lat:.5f}, {lng:.5f}, Bengaluru", "lat": lat, "lng": lng}

    def route(self, plat: float, plng: float, dlat: float, dlng: float) -> dict:
        key = (round(plat, 4), round(plng, 4), round(dlat, 4), round(dlng, 4))
        hit = _ROUTE_CACHE.get(key)
        if hit and time.time() - hit[0] < 600:
            return hit[1]
        try:
            r = httpx.get(f"{self.s.osrm_url}/route/v1/driving/{plng},{plat};{dlng},{dlat}", timeout=5,
                          headers=UA, params={"overview": "full", "geometries": "polyline"})
            r.raise_for_status()
            rt = r.json()["routes"][0]
            poly = decode_polyline(rt["geometry"])
            step = max(1, len(poly) // 250)
            poly = poly[::step] + ([poly[-1]] if (len(poly) - 1) % step else [])
            # OSRM's car profile is a bit fast for a two-wheeler in Bengaluru traffic: pad ETA.
            res = {"distance_m": int(rt["distance"]), "duration_s": int(rt["duration"] * 1.25),
                   "polyline": poly, "source": "osrm"}
        except Exception as e:
            log.info("osrm unavailable, using fallback: %s", e)
            res = _straight(plat, plng, dlat, dlng)
        _ROUTE_CACHE[key] = (time.time(), res)
        return res


_ROUTE_CACHE: dict = {}
