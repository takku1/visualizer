import type { SystemOneRequest, SystemOneResponse } from './jev';

/**
 * Anything that can answer a System One request.
 *
 * The protocol is the seam. `JevClient` talks to TypeSafe over HTTP and
 * `LocalSystemOne` decides in-process, but both take the same `questions` map
 * and return the same `answers` with calibrated probabilities - so the
 * director, and the renderer downstream of it, cannot tell which one is
 * running. Swapping engines is a constructor argument, and running both to
 * compare is just two calls.
 */
export interface DecisionEngine {
  readonly name: string;
  /** False when the engine needs configuration it does not have. */
  readonly configured: boolean;
  ask(req: SystemOneRequest): Promise<SystemOneResponse>;
}
