import { Presenter, Services } from './Presenter';
import type { WalletTxn } from '../model/types';

interface State { balance: number; items: WalletTxn[]; loading: boolean; error: string | null; toppingUp: boolean }

export class WalletPresenter extends Presenter<State> {
  constructor(svc: Services) { super({ balance: 0, items: [], loading: false, error: null, toppingUp: false }, svc); }

  async load() {
    this.set({ loading: true, error: null });
    try {
      const [w, t] = await Promise.all([this.svc.api.wallet(), this.svc.api.transactions()]);
      this.set({ balance: w.balance_paise, items: t.items, loading: false });
    } catch (e) { this.set({ loading: false, error: this.errorText(e) }); }
  }

  async topup(rupees: number) {
    this.set({ toppingUp: true, error: null });
    try {
      const r = await this.svc.api.topup(rupees * 100);
      this.set({ balance: r.balance_paise, toppingUp: false });
      this.load();
    } catch (e) { this.set({ toppingUp: false, error: this.errorText(e) }); }
  }
}
