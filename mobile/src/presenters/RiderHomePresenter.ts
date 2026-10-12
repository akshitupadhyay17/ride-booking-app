import * as Haptics from 'expo-haptics';
import { Presenter, Services } from './Presenter';
import { getCurrentFix } from '../model/location';
import { POPULAR_PLACES } from '../model/config';
import type { NearbyDriver, Place, Quote, Ride, ServerEvent } from '../model/types';

export type RiderStage = 'idle' | 'search' | 'quote' | 'matching' | 'active' | 'completed';

interface State {
  stage: RiderStage;
  pickup: Place | null;
  drop: Place | null;
  searchTarget: 'pickup' | 'drop';
  query: string;
  results: Place[];
  searching: boolean;
  quote: Quote | null;
  vehicle: string | null;
  payment: 'wallet' | 'cash';
  ride: Ride | null;
  driverPos: { lat: number; lng: number; heading: number } | null;
  etaSec: number | null;
  nearby: NearbyDriver[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  balance: number;
  stars: number;
  tags: string[];
  ratingSubmitted: boolean;
  gpsIsReal: boolean;
  focus: { lat: number; lng: number } | null;
}

const ACTIVE = ['ACCEPTED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS'];

export class RiderHomePresenter extends Presenter<State> {
  private started = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private nearbyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(svc: Services) {
    super({
      stage: 'idle', pickup: null, drop: null, searchTarget: 'drop', query: '', results: [], searching: false,
      quote: null, vehicle: null, payment: 'wallet', ride: null, driverPos: null, etaSec: null, nearby: [],
      loading: false, error: null, notice: null, balance: 0, stars: 5, tags: [], ratingSubmitted: false,
      gpsIsReal: false, focus: null,
    }, svc);
  }

  async init() {
    if (!this.started) {
      this.started = true;
      this.track(this.svc.realtime.on((e) => this.onEvent(e)));
      this.nearbyTimer = setInterval(() => this.refreshNearby(), 6000);
      this.track(() => { if (this.nearbyTimer) clearInterval(this.nearbyTimer); });
    }
    this.refreshBalance();
    if (!this.state.pickup) await this.locate();
    await this.resume();
  }

  // ---------- location & nearby ----------
  async locate() {
    const fix = await getCurrentFix();
    const place: Place = { lat: fix.lat, lng: fix.lng, name: 'Current location', address: fix.real ? 'Locating…' : 'MG Road area (demo location)' };
    this.set({ pickup: place, gpsIsReal: fix.real, focus: { lat: fix.lat, lng: fix.lng } });
    try {
      const r = await this.svc.api.reverse(fix.lat, fix.lng);
      if (this.state.pickup && this.state.pickup.lat === fix.lat) {
        this.set({ pickup: { ...place, name: r.name || place.name, address: r.address } });
      }
    } catch {}
    this.refreshNearby();
  }

  async refreshNearby() {
    const { pickup, stage } = this.state;
    if (!pickup || (stage !== 'idle' && stage !== 'quote' && stage !== 'matching')) return;
    try {
      const r = await this.svc.api.nearby(pickup.lat, pickup.lng);
      this.set({ nearby: r.drivers });
    } catch {}
  }

  async refreshBalance() {
    try { this.set({ balance: (await this.svc.api.wallet()).balance_paise }); } catch {}
  }

  // ---------- resume ----------
  async resume() {
    try {
      const { ride } = await this.svc.api.activeRide('rider');
      if (ride) this.applyRide(ride, true);
    } catch {}
  }

  // ---------- search ----------
  openSearch(target: 'pickup' | 'drop') {
    this.set({ stage: 'search', searchTarget: target, query: '', results: target === 'drop' ? POPULAR_PLACES : [], error: null });
  }
  closeSearch() { this.set({ stage: this.state.quote ? 'quote' : 'idle' }); }

  setQuery(q: string) {
    this.set({ query: q });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (q.trim().length < 2) { this.set({ results: this.state.searchTarget === 'drop' ? POPULAR_PLACES : [], searching: false }); return; }
    this.set({ searching: true });
    this.searchTimer = setTimeout(async () => {
      try {
        const r = await this.svc.api.autocomplete(q.trim(), this.state.pickup ?? undefined);
        if (this.state.query === q) this.set({ results: r.items, searching: false });
      } catch { this.set({ searching: false }); }
    }, 300);
  }

  async useCurrentLocation() { await this.locate(); this.afterPlaceChosen(); }

  async selectPlace(p: Place) {
    if (this.state.searchTarget === 'pickup') this.set({ pickup: p, focus: { lat: p.lat, lng: p.lng } });
    else this.set({ drop: p });
    this.afterPlaceChosen();
  }

  private afterPlaceChosen() {
    const { pickup, drop } = this.state;
    if (pickup && drop) this.fetchQuote();
    else this.set({ stage: 'idle' });
  }

  // ---------- quote & booking ----------
  async fetchQuote() {
    const { pickup, drop } = this.state;
    if (!pickup || !drop) return;
    this.set({ stage: 'quote', loading: true, error: null, quote: null });
    this.refreshBalance();
    try {
      const quote = await this.svc.api.estimate(pickup, drop);
      const first = quote.options.find((o) => o.enabled);
      this.set({ quote, vehicle: first?.id ?? null, loading: false });
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  selectVehicle(id: string) {
    const o = this.state.quote?.options.find((x) => x.id === id);
    if (!o) return;
    if (!o.enabled) { this.set({ notice: `${o.label} rides are coming soon to Bengaluru`, vehicle: this.state.vehicle }); return; }
    Haptics.selectionAsync();
    this.set({ vehicle: id, notice: null });
  }
  setPayment(p: 'wallet' | 'cash') { Haptics.selectionAsync(); this.set({ payment: p, error: null }); }
  clearMessages() { this.set({ notice: null, error: null }); }

  back() {
    this.set({ stage: 'idle', drop: null, quote: null, error: null, notice: null });
    this.refreshNearby();
  }

  async book() {
    const { quote, vehicle, payment } = this.state;
    if (!quote || !vehicle) return;
    this.set({ loading: true, error: null });
    try {
      const ride = await this.svc.api.book(quote.quote_id, vehicle, payment);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      this.set({ loading: false });
      this.applyRide(ride);
    } catch (e: any) {
      if (e?.code === 'quote_expired') { this.set({ loading: false }); this.fetchQuote(); return; }
      this.set({ loading: false, error: this.errorText(e) });
    }
  }

  async cancelRide() {
    const ride = this.state.ride;
    if (!ride) return;
    this.set({ loading: true });
    try {
      const r = await this.svc.api.cancel(ride.id, 'Cancelled by rider');
      this.set({ loading: false });
      this.applyRide(r);
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  // ---------- rating ----------
  setStars(n: number) { Haptics.selectionAsync(); this.set({ stars: n }); }
  toggleTag(t: string) {
    const tags = this.state.tags.includes(t) ? this.state.tags.filter((x) => x !== t) : [...this.state.tags, t];
    this.set({ tags });
  }
  async submitRating() {
    const { ride, stars, tags } = this.state;
    if (!ride) return;
    this.set({ loading: true });
    try {
      await this.svc.api.rate(ride.id, stars, tags, '');
      this.set({ ratingSubmitted: true, loading: false });
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  done() {
    this.set({ stage: 'idle', ride: null, drop: null, quote: null, driverPos: null, etaSec: null, stars: 5, tags: [],
      ratingSubmitted: false, error: null });
    this.refreshBalance();
    this.refreshNearby();
  }

  // ---------- ride state ----------
  private applyRide(ride: Ride, silent = false) {
    const prev = this.state.ride;
    const s = ride.status;
    if (s === 'MATCHING') {
      this.set({ ride, stage: 'matching' });
    } else if (ACTIVE.includes(s)) {
      if (!silent && prev?.status !== s) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const d = ride.driver;
      this.set({ ride, stage: 'active', driverPos: this.state.driverPos ?? (d ? { lat: d.lat, lng: d.lng, heading: d.heading } : null) });
    } else if (s === 'COMPLETED') {
      this.set({ ride, stage: 'completed', stars: 5, tags: [], ratingSubmitted: ride.rated });
      this.refreshBalance();
    } else if (s === 'CANCELLED' || s === 'NO_DRIVERS') {
      const notice = s === 'NO_DRIVERS' ? 'No riders available nearby right now. Please try again in a moment.'
        : ride.cancel_fee_paise ? `Ride cancelled. A cancellation fee of ₹${ride.cancel_fee_paise / 100} was charged.` : 'Ride cancelled.';
      this.set({ ride: null, stage: 'idle', notice, driverPos: null, etaSec: null, quote: null, drop: s === 'NO_DRIVERS' ? this.state.drop : null });
      if (s === 'NO_DRIVERS' && this.state.drop) this.fetchQuote().then(() => this.set({ notice }));
      this.refreshBalance();
    }
  }

  private onEvent(e: ServerEvent) {
    const cur = this.state.ride;
    if (e.type === 'ride.updated') {
      if ((e.ride as any).role === 'driver') return; // belongs to driver mode of this same account
      if (cur && e.ride.id !== cur.id) return;
      if (!cur && this.state.stage !== 'matching') return;
      this.applyRide({ ...(cur ?? ({} as Ride)), ...(e.ride as Ride) });
    } else if (e.type === 'ride.status') {
      if (cur && cur.id === e.ride_id) this.applyRide({ ...cur, status: e.status });
    } else if (e.type === 'driver.location') {
      if (cur && cur.id === e.ride_id) this.set({ driverPos: { lat: e.lat, lng: e.lng, heading: e.heading }, etaSec: e.eta_s });
    }
  }
}
