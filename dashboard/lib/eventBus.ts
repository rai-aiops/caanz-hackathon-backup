import type { TraceEvent } from "./types";

type TraceEventSubscriber = (event: TraceEvent) => void;

const SUBSCRIBERS_KEY = Symbol.for("caanz.dashboard.traceEventSubscribers");

type EventBusGlobal = typeof globalThis & {
  [SUBSCRIBERS_KEY]?: Set<TraceEventSubscriber>;
};

const eventBusGlobal = globalThis as EventBusGlobal;
const subscribers = eventBusGlobal[SUBSCRIBERS_KEY]
  ?? new Set<TraceEventSubscriber>();

eventBusGlobal[SUBSCRIBERS_KEY] = subscribers;

export function publishTraceEvent(event: TraceEvent) {
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

export function subscribeTraceEvents(subscriber: TraceEventSubscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
