import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';
import type {
  AppConfig, AppNotification, AuthResult, Earnings, NearbyDriver, Offer, Place, Quote, Ride, User, WalletTxn,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const KEY = 'ride.session.v1';

/** MODEL: HTTP client + token persistence. Presenters talk to this, never to fetch directly. */
export class ApiClient {
  access: string | null = null;
  refresh: string | null = null;
  onAuthLost: () => void = () => {};

  async loadSession(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    this.access = s.access; this.refresh = s.refresh;
    return true;
  }
  async saveSession(access: string, refresh: string) {
    this.access = access; this.refresh = refresh;
    await AsyncStorage.setItem(KEY, JSON.stringify({ access, refresh }));
  }
  async clearSession() {
    this.access = null; this.refresh = null;
    await AsyncStorage.removeItem(KEY);
  }

  private async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      return await fetch(`${API_URL}/v1${path}`, {
        method, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(this.access ? { Authorization: `Bearer ${this.access}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e: any) {
      throw new ApiError(0, 'network', `Can't reach the server at ${API_URL}. Is it running?`);
    } finally { clearTimeout(t); }
  }

  async request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    let res = await this.raw(method, path, body, headers);
    if (res.status === 401 && this.refresh && !path.startsWith('/auth/')) {
      const r = await this.raw('POST', '/auth/refresh', { refresh_token: this.refresh });
      if (r.ok) {
        const t = await r.json();
        await this.saveSession(t.access_token, t.refresh_token);
        res = await this.raw(method, path, body, headers);
      } else { await this.clearSession(); this.onAuthLost(); }
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = data.error ?? { code: 'http_' + res.status, message: typeof data.detail === 'string' ? data.detail : 'Something went wrong' };
      throw new ApiError(res.status, err.code, err.message);
    }
    return data as T;
  }
  get = <T,>(p: string) => this.request<T>('GET', p);
  post = <T,>(p: string, b?: unknown, h?: Record<string, string>) => this.request<T>('POST', p, b ?? {}, h);

  // ---- auth ----
  requestOtp = (phone: string) => this.post<{ ok: boolean; dev_otp?: string }>('/auth/otp/request', { phone });
  verifyOtp = (phone: string, code: string) => this.post<AuthResult>('/auth/otp/verify', { phone, code });
  me = () => this.get<User>('/me');
  updateMe = (name: string) => this.request<User>('PATCH', '/me', { name });
  config = () => this.get<AppConfig>('/config');

  // ---- maps ----
  autocomplete = (q: string, near?: { lat: number; lng: number }) =>
    this.get<{ items: Place[] }>(`/maps/autocomplete?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`);
  reverse = (lat: number, lng: number) => this.get<Place>(`/maps/reverse?lat=${lat}&lng=${lng}`);
  route = (plat: number, plng: number, dlat: number, dlng: number) =>
    this.get<{ distance_m: number; duration_s: number; polyline: [number, number][]; source: string }>(
      `/maps/route?plat=${plat}&plng=${plng}&dlat=${dlat}&dlng=${dlng}`
    );

  // ---- fare / rides ----
  estimate = (pickup: Place, drop: Place) => this.post<Quote>('/fares/estimate', { pickup, drop });
  book = (quote_id: string, vehicle_type: string, payment_method: string) =>
    this.post<Ride>('/rides', { quote_id, vehicle_type, payment_method });
  ride = (id: string) => this.get<Ride>(`/rides/${id}`);
  activeRide = (role: 'rider' | 'driver') => this.get<{ ride: Ride | null }>(`/rides/active?role=${role}`);
  history = (role: 'rider' | 'driver', cursor?: string | null) =>
    this.get<{ items: Ride[]; next_cursor: string | null }>(`/rides/history?role=${role}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  cancel = (id: string, reason?: string) => this.post<Ride>(`/rides/${id}/cancel`, { reason });
  rate = (id: string, stars: number, tags: string[], comment: string) =>
    this.post(`/rides/${id}/rating`, { stars, tags, comment });
  nearby = (lat: number, lng: number) => this.get<{ drivers: NearbyDriver[] }>(`/drivers/nearby?lat=${lat}&lng=${lng}&radius_m=3000`);

  // ---- driver ----
  registerDriver = (vehicle_type: string, vehicle_number: string, vehicle_model: string) =>
    this.post('/drivers/me/register', { vehicle_type, vehicle_number, vehicle_model });
  goOnline = (lat?: number, lng?: number) => this.post('/drivers/me/online', { lat, lng });
  goOffline = () => this.post('/drivers/me/offline');
  driverState = () => this.get<{ driver: any; pending_offer: Offer | null }>('/drivers/me/state');
  accept = (id: string) => this.post<Ride>(`/rides/${id}/accept`);
  reject = (id: string) => this.post(`/rides/${id}/reject`);
  arrived = (id: string) => this.post<Ride>(`/rides/${id}/arrived`);
  start = (id: string, otp: string) => this.post<Ride>(`/rides/${id}/start`, { otp });
  complete = (id: string) => this.post<Ride>(`/rides/${id}/complete`);
  earnings = () => this.get<Earnings>('/drivers/me/earnings');

  // ---- wallet / notifications ----
  wallet = () => this.get<{ balance_paise: number }>('/wallet');
  topup = (amount_paise: number) =>
    this.post<{ balance_paise: number }>('/wallet/topup', { amount_paise }, { 'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  transactions = () => this.get<{ items: WalletTxn[] }>('/wallet/transactions');
  notifications = () => this.get<{ items: AppNotification[]; unread: number }>('/notifications');
  markRead = () => this.post('/notifications/read');
}
