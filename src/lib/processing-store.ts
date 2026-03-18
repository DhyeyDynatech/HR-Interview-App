/**
 * Module-level processing store.
 *
 * Persists `analyzing` + `progress` outside of React component lifecycle so
 * that when a user navigates away from a page mid-analysis and comes back,
 * the component can restore the in-progress UI immediately on remount.
 *
 * Key is typically scanId (Company Finder) or interviewId (ATS Scoring).
 */

export interface ProcessingState {
  analyzing: boolean;
  progress: { current: number; total: number };
  /** Total number of resumes/items being processed — used for display labels */
  itemCount: number;
  /** ATS-specific: whether the batch processor component should be active */
  batchJobActive?: boolean;
  /** ATS-specific: total resumes in the batch job */
  batchTotal?: number;
}

type Listener = (state: ProcessingState) => void;

const states = new Map<string, ProcessingState>();
const listeners = new Map<string, Set<Listener>>();

function defaultState(): ProcessingState {
  return { analyzing: false, progress: { current: 0, total: 0 }, itemCount: 0 };
}

/** Get current state for a key. Returns null if no entry exists. */
export function getProcessingState(key: string): ProcessingState | null {
  return states.get(key) ?? null;
}

/** Update state for a key and notify all subscribers. */
export function setProcessingState(key: string, update: Partial<ProcessingState>): void {
  const current = states.get(key) ?? defaultState();
  const next = { ...current, ...update };
  states.set(key, next);
  listeners.get(key)?.forEach((fn) => fn(next));
}

/** Subscribe to state changes for a key. Returns an unsubscribe function. */
export function subscribeProcessing(key: string, fn: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => listeners.get(key)?.delete(fn);
}

/** Clear the state and all listeners for a key once processing is done. */
export function clearProcessingState(key: string): void {
  states.delete(key);
  listeners.delete(key);
}
