import { Presenter, Services } from './Presenter';
import type { AppNotification, ServerEvent } from '../model/types';

interface State { items: AppNotification[]; unread: number; banner: AppNotification | null }

export class NotificationsPresenter extends Presenter<State> {
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(svc: Services) { super({ items: [], unread: 0, banner: null }, svc); }

  init() {
    this.track(this.svc.realtime.on((e: ServerEvent) => {
      if (e.type !== 'notification') return;
      this.set({ items: [e, ...this.state.items], unread: this.state.unread + 1, banner: e });
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => this.set({ banner: null }), 4000);
    }));
    this.load();
  }

  async load() {
    try {
      const r = await this.svc.api.notifications();
      this.set({ items: r.items, unread: r.unread });
    } catch {}
  }

  async markRead() {
    this.set({ unread: 0, items: this.state.items.map((n) => ({ ...n, read: true })) });
    try { await this.svc.api.markRead(); } catch {}
  }

  dismissBanner = () => this.set({ banner: null });
}
