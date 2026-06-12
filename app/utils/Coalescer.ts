/**
 * Trailing-edge task coalescer: runs an async task such that at most one is in
 * flight at a time, and the most recently requested input always wins. If
 * requests arrive while a task is running, only the latest is run when the
 * current one settles; intermediate inputs are dropped.
 *
 * This bounds work to one in-flight + one pending regardless of how fast
 * `request()` is called (e.g. per mouse-move frame during a drag), and — since
 * only one task runs at a time — guarantees results are applied in request
 * order, eliminating stale-result races.
 */
export class Coalescer<I> {
  #inFlight = false;
  #pending: I | null = null;
  #hasPending = false;
  #cancelled = false;
  readonly #run: (input: I) => Promise<void>;

  constructor(run: (input: I) => Promise<void>) {
    this.#run = run;
  }

  /** Record `input` as the latest desired state and ensure a task is running. */
  request(input: I): void {
    if (this.#cancelled) return;
    this.#pending = input;
    this.#hasPending = true;
    if (!this.#inFlight) this.#drain();
  }

  /** Permanently stop: drops any pending input and prevents future runs. */
  cancel(): void {
    this.#cancelled = true;
    this.#pending = null;
    this.#hasPending = false;
  }

  #drain(): void {
    if (this.#cancelled || !this.#hasPending) return;
    const input = this.#pending as I;
    this.#pending = null;
    this.#hasPending = false;
    this.#inFlight = true;
    this.#run(input).finally(() => {
      this.#inFlight = false;
      if (this.#hasPending) this.#drain();
    });
  }
}
