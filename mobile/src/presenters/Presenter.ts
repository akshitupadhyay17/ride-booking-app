import { ApiClient, ApiError } from '../model/api';
import { RealtimeClient } from '../model/realtime';

/** Shared model-layer services handed to every presenter. */
export interface Services { api: ApiClient; realtime: RealtimeClient }

/**
 * PRESENTER base. A presenter owns the screen state and all logic; the View is passive:
 * it renders `getState()` and forwards user actions to presenter methods.
 */
export abstract class Presenter<S extends object> {
  private listeners = new Set<() => void>();
  private disposers: (() => void)[] = [];
  protected state: S;

  constructor(initial: S, protected svc: Services) { this.state = initial; }

  getState = (): S => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  protected set(patch: Partial<S>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  protected track(dispose: () => void) { this.disposers.push(dispose); }
  dispose() { this.disposers.forEach((d) => d()); this.disposers = []; }

  protected errorText(e: unknown): string {
    return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
  }
}
