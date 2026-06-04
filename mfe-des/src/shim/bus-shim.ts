/**
 * Minimal EventBus shim for standalone dev mode.
 * The shell injects the real eventBus singleton via MFEProps.bus.
 */

import { Subject, Observable } from 'rxjs';
import { filter, share } from 'rxjs/operators';

export class EventBus {
  private _s = new Subject<{ type: string; payload: unknown; timestamp: number }>();
  readonly events$ = this._s.asObservable().pipe(share());

  emit(type: string, payload: unknown) {
    this._s.next({ type, payload, timestamp: Date.now() });
  }

  on(type: string): Observable<any> {
    return this.events$.pipe(filter((e) => e.type === type));
  }

  subscribe(type: string, handler: (e: any) => void) {
    const sub = this.on(type).subscribe(handler);
    return () => sub.unsubscribe();
  }
}
