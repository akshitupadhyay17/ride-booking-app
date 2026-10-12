import { useSyncExternalStore } from 'react';
import type { Presenter } from '../presenters/Presenter';

/** Binds a View to a Presenter's state (re-renders whenever the presenter calls set()). */
export function usePresenterState<S extends object>(p: Presenter<S>): S {
  return useSyncExternalStore(p.subscribe, p.getState, p.getState);
}
