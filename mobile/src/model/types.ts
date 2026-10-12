export type VehicleTypeId = 'bike' | 'auto' | 'mini' | 'sedan' | 'suv';

export interface LatLng { lat: number; lng: number }
export interface Place extends LatLng { name: string; address: string }

export interface DriverInfo {
  vehicle_type: string; vehicle_number: string; vehicle_model: string; status: 'offline' | 'online' | 'busy';
}
export interface User {
  id: string; phone: string; name: string; email: string | null; wallet_paise: number;
  rating_avg: number; rating_count: number; is_driver: boolean; driver: DriverInfo | null;
}
export interface AuthResult { access_token: string; refresh_token: string; is_new: boolean; user: User }

export interface FareBreakdown {
  base: number; distance: number; time: number; min_fare_adjustment: number; surge: number;
  booking_fee: number; gst: number; rounding: number; total: number;
}
export interface VehicleOption {
  id: VehicleTypeId; label: string; icon: string; capacity: number; tagline: string; enabled: boolean;
  coming_soon: boolean; fare_paise: number; breakdown: FareBreakdown; eta_pickup_min: number | null;
  drivers_nearby: number;
}
export interface Quote {
  quote_id: string; distance_m: number; duration_s: number; polyline: [number, number][]; surge: number;
  options: VehicleOption[]; expires_at: string;
}

export type RideStatus =
  | 'MATCHING' | 'ACCEPTED' | 'ARRIVING' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_DRIVERS';

export interface RideDriver {
  id: string; name: string; rating: number; rating_count: number; vehicle_type: string; vehicle_number: string;
  vehicle_model: string; lat: number; lng: number; heading: number; phone: string | null;
}
export interface Ride {
  id: string; status: RideStatus; vehicle_type: string; role: 'rider' | 'driver';
  pickup: Place & { address: string }; drop: Place & { address: string };
  distance_m: number; duration_s: number; surge: number; fare_paise: number; fare_breakdown: FareBreakdown;
  payment_method: 'wallet' | 'cash'; payment_status: string; cancel_fee_paise: number;
  cancelled_by: string | null; cancel_reason: string | null; driver_payout_paise: number | null;
  requested_at: string; completed_at: string | null; rated: boolean; start_otp?: string;
  rider: { id: string; name: string; rating: number } | null; driver: RideDriver | null;
  polyline?: [number, number][];
}

export interface Offer {
  offer_id: string; ride_id: string; expires_in_s: number; timeout_s: number; vehicle_type: string;
  pickup: Place; drop: Place; pickup_distance_m: number; trip_distance_m: number; trip_duration_s: number;
  fare_paise: number; earning_paise: number; payment_method: string; rider_name: string; rider_rating: number;
  polyline: [number, number][];
}

export interface WalletTxn {
  id: string; amount_paise: number; balance_after: number; kind: string; ref: string | null; created_at: string;
}
export interface AppNotification {
  id: string; title: string; body: string; event: string; read: boolean; created_at: string;
}
export interface NearbyDriver { id: string; vehicle_type: string; lat: number; lng: number; heading: number }
export interface Earnings {
  today: { earnings_paise: number; trips: number }; week: { earnings_paise: number; trips: number };
  wallet_paise: number;
}
export interface AppConfig {
  vehicle_types: { id: VehicleTypeId; label: string; icon: string; capacity: number; tagline: string; enabled: boolean }[];
}

export type ServerEvent =
  | { type: 'connected' }
  | { type: 'ride.updated'; ride: Partial<Ride> & { id: string; status: RideStatus } }
  | { type: 'ride.status'; ride_id: string; status: RideStatus }
  | { type: 'ride.offer'; offer: Offer }
  | { type: 'ride.offer_expired'; ride_id: string }
  | { type: 'driver.location'; ride_id: string; lat: number; lng: number; heading: number; eta_s: number; status: RideStatus }
  | ({ type: 'notification' } & AppNotification);
