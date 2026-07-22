import type { LearnableMetaStatus } from './api.js';

type Listener = (status: LearnableMetaStatus) => void;

let current: LearnableMetaStatus | null = null;
const listeners = new Set<Listener>();

export function publishLearnableMetaStatus(status: LearnableMetaStatus) {
  current = status;
  for (const listener of listeners) listener(status);
}

export function onLearnableMetaStatus(listener: Listener) {
  listeners.add(listener);
  if (current) listener(current);
  return () => listeners.delete(listener);
}
