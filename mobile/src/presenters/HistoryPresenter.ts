import { Presenter, Services } from './Presenter';
import type { Earnings, Ride } from '../model/types';

interface State {
  items: Ride[]; cursor: string | null; loading: boolean; error: string | null; earnings: Earnings | null;
  role: 'rider' | 'driver';
}

export class HistoryPresenter extends Presenter<State> {
  constructor(svc: Services) {
    super({ items: [], cursor: null, loading: false, error: null, earnings: null, role: 'rider' }, svc);
  }

  async load(role: 'rider' | 'driver') {
    this.set({ loading: true, error: null, role, items: [], cursor: null });
    try {
      const [h, e] = await Promise.all([
        this.svc.api.history(role),
        role === 'driver' ? this.svc.api.earnings().catch(() => null) : Promise.resolve(null),
      ]);
      this.set({ items: h.items, cursor: h.next_cursor, loading: false, earnings: e });
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  async more() {
    const { cursor, role, loading } = this.state;
    if (!cursor || loading) return;
    this.set({ loading: true });
    try {
      const h = await this.svc.api.history(role, cursor);
      this.set({ items: [...this.state.items, ...h.items], cursor: h.next_cursor, loading: false });
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }
}
