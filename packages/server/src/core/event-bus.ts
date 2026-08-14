import { TickEvent } from '@stock-survival/shared';

type EventHandler = (event: TickEvent) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  async emit(event: TickEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = this.handlers.get('*') ?? new Set();
    for (const handler of [...handlers, ...allHandlers]) {
      await handler(event);
    }
  }
}

export const eventBus = new EventBus();
