# Zip Rides — Bengaluru Two-Wheeler Booking Prototype

A production-grade prototype for a two-wheeler ride booking app in **Bengaluru**, built following the **Model-View-Presenter (MVP)** pattern across both the backend and mobile app.

---

## Architecture Overview (MVP Pattern)

### 1. Backend (`backend/`)
- **Model Layer (`app/models/`)**: 
  - `entities.py`: SQLAlchemy 2 database models (Users, Drivers, Rides, Offers, WalletTxns, Ratings, Notifications, Webhooks).
  - `repositories.py`: Data-access layer using PostgreSQL/PostGIS. Contains geospatial queries (`ST_DWithin`, spatial GiST indexes), row-level locks, ledger transactions.
- **Presenter Layer (`app/presenters/`)**: 
  - Pure business logic, state machines, and calculations completely independent of HTTP/web frameworks:
    - `auth.py`: OTP authentication, JWT issuing, user profile.
    - `maps.py`: OSRM routing, Nominatim geocoding, Bangalore local fallback.
    - `fare.py`: Dynamic pricing engine, surge multiplier calculation, GST & commission breakdowns.
    - `dispatch.py`: Spatial matching with expanding search radius (2km → 4km → 6km) and 15s driver timeouts.
    - `ride.py`: Trip state machine (`MATCHING → ACCEPTED → ARRIVING → ARRIVED → IN_PROGRESS → COMPLETED`), 4-digit start OTP, cancellation rules.
    - `driver.py`: Availability management, real-time GPS telemetry, trip breadcrumbs, daily/weekly earnings.
    - `wallet.py`: Double-entry style balance ledger, idempotent top-ups, automated driver payouts.
    - `rating.py`: Mutual two-way reviews with rolling average calculations.
    - `notifications.py`: In-app inbox, Expo push delivery, signed HMAC webhooks.
- **View Layer (`app/views/`)**:
  - `routes.py`: Passive FastAPI HTTP routes that parse requests and delegate to presenters.
  - `ws.py`: WebSocket hub streaming real-time driver coordinates and ride status changes.

### 2. Mobile App (`mobile/`)
Built with **React Native + Expo (TypeScript)** with seamless **Rider** and **Driver** modes in a single app.
- **Model (`src/model/`)**: `api.ts` (REST client + session), `realtime.ts` (reconnecting WebSocket), `location.ts` (GPS math), `types.ts`.
- **Presenter (`src/presenters/`)**: `AppPresenter`, `RiderHomePresenter`, `DriverHomePresenter`, `WalletPresenter`, `HistoryPresenter`, `NotificationsPresenter`.
- **View (`src/views/`)**: `RiderHomeView`, `DriverHomeView`, `ActivityWalletViews`, `ProfileView`, `LoginView`, `components.tsx`, `theme.ts`.

---

## Vehicle Catalog & Future Expansion

The vehicle catalogue is dynamically driven via `.env`:
```env
# Currently enabled for booking:
ENABLED_VEHICLE_TYPES=bike

# When you are ready to enable cabs and autos, update to:
# ENABLED_VEHICLE_TYPES=bike,auto,mini,sedan,suv
```
All vehicles (`Bike`, `Auto`, `Mini`, `Sedan`, `SUV`) are displayed in the app UI so users see the complete fleet. Categories not enabled in `.env` show a **"Coming Soon"** tag and are locked from booking until enabled.

---

## Quickstart

### 1. Start Backend & Database in Docker
```bash
# Start PostGIS and the FastAPI API
docker compose up -d --build

# (Optional) Start the simulated driver bots roaming Bangalore:
docker compose --profile sim up -d sim
```

Check API health:
```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Run test suite:
```bash
docker compose exec -T api python -m pytest -v
```

### 2. Run the Mobile App (Expo)
```bash
cd mobile
npm start
```
- **On Physical iPhone**: Open Camera and scan the QR code displayed in the terminal using the **Expo Go** app. (Ensure your iPhone is on the same Wi-Fi as your Mac).
- **On iOS Simulator**: Press `i` in the Expo terminal.
- **On Android**: Press `a`.

### 3. Login & Demo Accounts
- Enter any 10-digit phone number (e.g., `98765 43210`).
- When prompted for OTP, use **`123456`** (dev mode allows one-tap autofill).
- Each new account receives a ₹500 welcome wallet balance.
- Toggle between **Rider** and **Driver** mode anytime in the **Profile** tab.
- Driver mode includes a **Simulate GPS** toggle so you can test full trips without moving physically!
