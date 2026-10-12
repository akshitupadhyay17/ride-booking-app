import * as Haptics from 'expo-haptics';
import { Presenter, Services } from './Presenter';
import { bearing, distanceM, getCurrentFix } from '../model/location';
import type { Offer, Ride, ServerEvent, VehicleTypeId } from '../model/types';
import type { AppConfig } from '../model/types';

interface State {
  loading: boolean;
  isDriver: boolean;
  status: 'offline' | 'online' | 'busy';
  vehicleLabel: string;
  vehicleNumber: string;
  pos: { lat: number; lng: number; heading: number } | null;
  simulate: boolean;
  offer: Offer | null;
  offerLeft: number;
  ride: Ride | null;
  otp: string;
  busy: boolean;
  error: string | null;
  completedRide: Ride | null;
  stars: number;
  ratingSubmitted: boolean;
  // registration form
  vehicleTypes: AppConfig['vehicle_types'];
  formType: VehicleTypeId;
  formNumber: string;
  formModel: string;
}

const SIM_STEP_M = 70; // metres moved per 3-second telemetry tick while simulating GPS

export class DriverHomePresenter extends Presenter<State> {
  private started = false;
  private offerAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private countTimer: ReturnType<typeof setInterval> | null = null;
  private polyIdx = 0;

  constructor(svc: Services) {
    super({
      loading: true, isDriver: false, status: 'offline', vehicleLabel: '', vehicleNumber: '', pos: null, simulate: true,
      offer: null, offerLeft: 0, ride: null, otp: '', busy: false, error: null, completedRide: null, stars: 5,
      ratingSubmitted: false, vehicleTypes: [], formType: 'bike', formNumber: '', formModel: '',
    }, svc);
  }

  async init() {
    if (!this.started) {
      this.started = true;
      this.track(this.svc.realtime.on((e) => this.onEvent(e)));
      this.countTimer = setInterval(() => this.countdown(), 500);
      this.tickTimer = setInterval(() => this.telemetry(), 3000);
      this.track(() => { if (this.countTimer) clearInterval(this.countTimer); if (this.tickTimer) clearInterval(this.tickTimer); });
    }
    await this.refresh();
  }

  async refresh() {
    try {
      const [me, cfg] = await Promise.all([this.svc.api.me(), this.svc.api.config()]);
      const enabled = cfg.vehicle_types.filter((v) => v.enabled);
      this.set({ vehicleTypes: cfg.vehicle_types, formType: (enabled[0]?.id ?? 'bike') as VehicleTypeId });
      if (!me.is_driver || !me.driver) { this.set({ loading: false, isDriver: false }); return; }
      const [st, active] = await Promise.all([this.svc.api.driverState(), this.svc.api.activeRide('driver')]);
      if (!this.state.pos) {
        const fix = await getCurrentFix();
        this.set({ pos: { lat: fix.lat, lng: fix.lng, heading: 0 }, simulate: !fix.real });
      }
      this.set({
        loading: false, isDriver: true, status: st.driver.status,
        vehicleLabel: `${me.driver.vehicle_model || me.driver.vehicle_type}`, vehicleNumber: me.driver.vehicle_number,
        ride: active.ride,
      });
      if (st.pending_offer) this.showOffer(st.pending_offer);
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  // ---------- registration ----------
  setForm(patch: Partial<Pick<State, 'formType' | 'formNumber' | 'formModel'>>) { this.set({ ...patch, error: null }); }
  async register() {
    const { formType, formNumber, formModel } = this.state;
    this.set({ busy: true, error: null });
    try {
      await this.svc.api.registerDriver(formType, formNumber, formModel);
      this.set({ busy: false });
      await this.refresh();
    } catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }

  // ---------- availability ----------
  async toggleOnline() {
    this.set({ busy: true, error: null });
    try {
      if (this.state.status === 'offline') {
        let pos = this.state.pos;
        if (!pos) {
          const fix = await getCurrentFix();
          pos = { lat: fix.lat, lng: fix.lng, heading: 0 };
          this.set({ pos, simulate: !fix.real });
        }
        await this.svc.api.goOnline(pos.lat, pos.lng);
        this.set({ status: 'online', busy: false });
        this.telemetry();
      } else {
        await this.svc.api.goOffline();
        this.set({ status: 'offline', busy: false, offer: null });
      }
    } catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }
  setSimulate(v: boolean) { this.set({ simulate: v }); }

  // ---------- offers ----------
  private showOffer(o: Offer) {
    this.offerAt = Date.now();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    this.set({ offer: o, offerLeft: o.expires_in_s });
  }
  private countdown() {
    const o = this.state.offer;
    if (!o) return;
    const left = Math.max(0, Math.ceil(o.expires_in_s - (Date.now() - this.offerAt) / 1000));
    if (left !== this.state.offerLeft) this.set({ offerLeft: left });
    if (left === 0) this.set({ offer: null });
  }
  async accept() {
    const o = this.state.offer;
    if (!o) return;
    this.set({ busy: true, error: null });
    try {
      const ride = await this.svc.api.accept(o.ride_id);
      this.polyIdx = 0;
      this.set({ ride, offer: null, status: 'busy', busy: false, otp: '' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) { this.set({ busy: false, offer: null, error: this.errorText(e) }); }
  }
  async reject() {
    const o = this.state.offer;
    if (!o) return;
    this.set({ offer: null });
    try { await this.svc.api.reject(o.ride_id); } catch {}
  }

  // ---------- trip actions ----------
  setOtp(v: string) { this.set({ otp: v.replace(/[^0-9]/g, '').slice(0, 4), error: null }); }

  private async act<T extends Ride>(fn: () => Promise<T>) {
    this.set({ busy: true, error: null });
    try { const ride = await fn(); this.applyRide(ride); this.set({ busy: false }); }
    catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }
  arrived() { const r = this.state.ride; if (r) return this.act(() => this.svc.api.arrived(r.id)); }
  startTrip() {
    const r = this.state.ride;
    if (!r) return;
    return this.act(() => this.svc.api.start(r.id, this.state.otp)).then(() => { this.polyIdx = 0; this.set({ otp: '' }); });
  }
  complete() { const r = this.state.ride; if (r) return this.act(() => this.svc.api.complete(r.id)); }
  async cancel() {
    const r = this.state.ride;
    if (!r) return;
    this.set({ busy: true });
    try { await this.svc.api.cancel(r.id, 'Cancelled by rider partner'); this.set({ ride: null, status: 'online', busy: false }); }
    catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }

  setStars(n: number) { this.set({ stars: n }); }
  async submitRating() {
    const c = this.state.completedRide;
    if (!c) return;
    try { await this.svc.api.rate(c.id, this.state.stars, [], ''); } catch {}
    this.set({ ratingSubmitted: true });
  }
  doneSummary() { this.set({ completedRide: null, ratingSubmitted: false, stars: 5 }); }

  private applyRide(ride: Ride) {
    if (ride.status === 'COMPLETED') {
      this.set({ ride: null, completedRide: ride, status: 'online', stars: 5, ratingSubmitted: ride.rated });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (ride.status === 'CANCELLED' || ride.status === 'NO_DRIVERS') {
      this.set({ ride: null, status: 'online' });
    } else this.set({ ride });
  }

  // ---------- telemetry (WebSocket) ----------
  private async telemetry() {
    const { status, pos, ride, simulate } = this.state;
    if (status === 'offline' || !pos) return;
    let next = pos;
    if (simulate) next = this.simulatedStep(pos, ride);
    this.set({ pos: next });
    this.svc.realtime.send({ type: 'location', lat: next.lat, lng: next.lng, heading: next.heading });
  }

  /** Demo GPS: drive to pickup, then follow the route polyline to the drop-off. */
  private simulatedStep(pos: NonNullable<State['pos']>, ride: Ride | null) {
    if (!ride) return pos;
    const move = (target: { lat: number; lng: number }, metres: number) => {
      const d = distanceM(pos, target);
      if (d < metres) return { lat: target.lat, lng: target.lng, heading: pos.heading, reached: true };
      const f = metres / d;
      return { lat: pos.lat + (target.lat - pos.lat) * f, lng: pos.lng + (target.lng - pos.lng) * f,
        heading: bearing(pos, target), reached: false };
    };
    if (ride.status === 'IN_PROGRESS' && ride.polyline?.length) {
      let budget = SIM_STEP_M, cur = pos, h = pos.heading;
      while (budget > 0 && this.polyIdx < ride.polyline.length) {
        const [lat, lng] = ride.polyline[this.polyIdx];
        const d = distanceM(cur, { lat, lng });
        if (d <= budget) { budget -= d; h = d > 1 ? bearing(cur, { lat, lng }) : h; cur = { ...cur, lat, lng }; this.polyIdx++; }
        else { const f = budget / d; h = bearing(cur, { lat, lng }); cur = { ...cur, lat: cur.lat + (lat - cur.lat) * f, lng: cur.lng + (lng - cur.lng) * f }; budget = 0; }
      }
      return { lat: cur.lat, lng: cur.lng, heading: h };
    }
    if (ride.status === 'ACCEPTED' || ride.status === 'ARRIVING') {
      const m = move(ride.pickup, SIM_STEP_M);
      return { lat: m.lat, lng: m.lng, heading: m.heading };
    }
    return pos;
  }

  private onEvent(e: ServerEvent) {
    if (e.type === 'ride.offer') {
      if (this.state.status === 'online' && !this.state.ride) this.showOffer(e.offer);
    } else if (e.type === 'ride.offer_expired') {
      if (this.state.offer?.ride_id === e.ride_id) this.set({ offer: null });
    } else if (e.type === 'ride.updated') {
      const r = e.ride as any;
      if (r.role === 'driver' && r.status === 'CANCELLED') { this.set({ ride: null, status: 'online' }); return; }
      const cur = this.state.ride;
      if (cur && r.id === cur.id && r.role !== 'rider') {
        if (r.status === 'CANCELLED') { this.set({ ride: null, status: 'online', error: 'The rider cancelled this trip.' }); return; }
        this.set({ ride: { ...cur, ...r } });
      }
    } else if (e.type === 'ride.status') {
      const cur = this.state.ride;
      if (cur && cur.id === e.ride_id) this.set({ ride: { ...cur, status: e.status } });
    }
  }
}
