/**
 * Minimal client for TypeSafe's System One endpoint.
 *
 * One endpoint handles everything: POST https://api.typesafe.ai/v1/systemone.
 * The body carries `state`, `model`, and a map of `questions`; the response
 * carries `answers` keyed the same way, each with calibrated probabilities.
 *
 * Deliberately dependency-free rather than using the official SDK: this whole
 * extension ships to Spicetify as one classic script, and the surface we need
 * is a single POST.
 */

import type { DecisionEngine } from './engine';

export type QuestionType = 'noul' | 'choice' | 'score';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** Option label to description. Cardinality is capped at 255 by the API. */
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  /** 2 to 10 level descriptions, lowest first. */
  criteria: string[];
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface SystemOneRequest {
  state: unknown;
  model?: string;
  questions: Record<string, Question>;
}

export interface Answer {
  type: QuestionType;
  /** Present when type is 'noul'. Probability the statement is true, 0..1. */
  noul?: number;
  /** Present when type is 'choice'. One of the criteria keys. */
  choice?: string;
  /** Present when type is 'score'. */
  score?: number;
  /** Calibrated distribution over the answer space. */
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, string>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevConfig {
  /**
   * TypeSafe API key. Used only when `proxyUrl` is unset.
   *
   * Fine for a local extension on your own machine; do not ship a build with
   * a key baked in. Point `proxyUrl` at a server that holds the key instead.
   */
  apiKey?: string;
  /** If set, requests go here instead of directly to TypeSafe, with no key attached. */
  proxyUrl?: string;
  model?: string;
  /** Abort a decision that takes longer than this. The visuals keep running. */
  timeoutMs?: number;
}

export class JevError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'JevError';
  }
}

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export class JevClient implements DecisionEngine {
  readonly name = 'jev';
  #cfg: Required<Pick<JevConfig, 'model' | 'timeoutMs'>> & JevConfig;

  constructor(cfg: JevConfig) {
    this.#cfg = { model: 'jev-latest', timeoutMs: 4000, ...cfg };
  }

  get configured(): boolean {
    return Boolean(this.#cfg.apiKey || this.#cfg.proxyUrl);
  }

  async ask(req: SystemOneRequest): Promise<SystemOneResponse> {
    const { apiKey, proxyUrl, model, timeoutMs } = this.#cfg;
    if (!apiKey && !proxyUrl) throw new JevError('no API key or proxy configured');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!proxyUrl && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(proxyUrl ?? ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, ...req }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // 429 and 529 are rate limits; the docs call for exponential backoff.
        const retryable = res.status === 429 || res.status === 529;
        throw new JevError(`systemone ${res.status}: ${body.slice(0, 300)}`, res.status, retryable);
      }

      return (await res.json()) as SystemOneResponse;
    } catch (err) {
      if (err instanceof JevError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new JevError(`timed out after ${timeoutMs}ms`, undefined, true);
      }
      throw new JevError(String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
