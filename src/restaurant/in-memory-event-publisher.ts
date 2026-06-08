import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';
import { DomainEvent, EventPublisher, EventStreamProvider } from './event-publisher';

@Injectable()
export class InMemoryEventPublisher implements EventPublisher, EventStreamProvider {
  private readonly events = new Subject<DomainEvent>();

  publish(channel: string, type: string, data: string | object) {
    this.events.next({ channel, type, data });
  }

  stream(channel: string): Observable<MessageEvent> {
    return this.events.pipe(
      filter((event) => event.channel === channel),
      map((event) => ({ type: event.type, data: event.data })),
    );
  }
}
