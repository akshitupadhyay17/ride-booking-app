import { Presenter, Services } from './Presenter';
import { WalletPresenter } from './WalletPresenter';
import { HistoryPresenter } from './HistoryPresenter';
import { NotificationsPresenter } from './NotificationsPresenter';
import { RiderHomePresenter } from './RiderHomePresenter';
import { DriverHomePresenter } from './DriverHomePresenter';
import type { User } from '../model/types';

export type Mode = 'rider' | 'driver';
export type Tab = 'home' | 'activity' | 'wallet' | 'profile';

interface AppState {
  booting: boolean;
  user: User | null;
  mode: Mode;
  tab: Tab;
  // login form
  phone: string;
  code: string;
  otpSent: boolean;
  devOtp: string | null;
  busy: boolean;
  error: string | null;
  connected: boolean;
}

export interface Container {
  rider: RiderHomePresenter;
  driver: DriverHomePresenter;
  wallet: WalletPresenter;
  history: HistoryPresenter;
  notifications: NotificationsPresenter;
}

/** Root presenter: authentication, mode/tab navigation, and the lifetime of the per-session presenters. */
export class AppPresenter extends Presenter<AppState> {
  container: Container | null = null;

  constructor(svc: Services) {
    super({ booting: true, user: null, mode: 'rider', tab: 'home', phone: '', code: '', otpSent: false,
      devOtp: null, busy: false, error: null, connected: false }, svc);
    svc.api.onAuthLost = () => this.teardown();
    svc.realtime.onStatus = (connected) => this.set({ connected });
  }

  async boot() {
    try {
      if (await this.svc.api.loadSession()) {
        const user = await this.svc.api.me();
        this.start(user);
        return;
      }
    } catch {}
    this.set({ booting: false });
  }

  private start(user: User) {
    this.svc.realtime.connect(this.svc.api.access!);
    this.container = {
      rider: new RiderHomePresenter(this.svc),
      driver: new DriverHomePresenter(this.svc),
      wallet: new WalletPresenter(this.svc),
      history: new HistoryPresenter(this.svc),
      notifications: new NotificationsPresenter(this.svc),
    };
    this.set({ user, booting: false, mode: user.driver?.status === 'busy' ? 'driver' : this.state.mode, tab: 'home' });
    this.container.rider.init();
    this.container.driver.init();
    this.container.notifications.init();
  }

  setPhone = (phone: string) => this.set({ phone: phone.replace(/[^0-9]/g, '').slice(0, 10), error: null });
  setCode = (code: string) => this.set({ code: code.replace(/[^0-9]/g, '').slice(0, 6), error: null });

  async sendOtp() {
    if (this.state.phone.length !== 10) return this.set({ error: 'Enter your 10-digit mobile number' });
    this.set({ busy: true, error: null });
    try {
      const r = await this.svc.api.requestOtp(this.state.phone);
      this.set({ otpSent: true, devOtp: r.dev_otp ?? null, busy: false });
    } catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }

  async verifyOtp() {
    if (this.state.code.length !== 6) return this.set({ error: 'Enter the 6-digit code' });
    this.set({ busy: true, error: null });
    try {
      const r = await this.svc.api.verifyOtp(this.state.phone, this.state.code);
      await this.svc.api.saveSession(r.access_token, r.refresh_token);
      this.set({ busy: false, code: '', otpSent: false });
      this.start(r.user);
    } catch (e) { this.set({ busy: false, error: this.errorText(e) }); }
  }

  backToPhone = () => this.set({ otpSent: false, code: '', error: null });

  setTab = (tab: Tab) => {
    this.set({ tab });
    if (tab === 'wallet') this.container?.wallet.load();
    if (tab === 'activity') this.container?.history.load(this.state.mode);
    if (tab === 'profile') this.container?.notifications.load();
  };

  setMode = async (mode: Mode) => {
    if (mode === this.state.mode) return;
    this.set({ mode, tab: 'home' });
    if (mode === 'driver') this.container?.driver.init();
    else this.container?.rider.init();
  };

  async refreshUser() {
    try { this.set({ user: await this.svc.api.me() }); } catch {}
  }

  async saveName(name: string) {
    try { this.set({ user: await this.svc.api.updateMe(name) }); } catch (e) { this.set({ error: this.errorText(e) }); }
  }

  async logout() {
    try { if (this.state.user?.driver?.status === 'online') await this.svc.api.goOffline(); } catch {}
    await this.svc.api.clearSession();
    this.teardown();
  }

  private teardown() {
    this.svc.realtime.close();
    this.container?.rider.dispose(); this.container?.driver.dispose();
    this.container?.wallet.dispose(); this.container?.history.dispose(); this.container?.notifications.dispose();
    this.container = null;
    this.set({ user: null, otpSent: false, phone: '', code: '', mode: 'rider', tab: 'home', booting: false });
  }
}
