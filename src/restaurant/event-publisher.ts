import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

export type DomainEvent = {
  channel: string;
  type: string;
  data: string | object;
};

export interface EventPublisher {
  publish(channel: string, type: string, data: string | object): void;
}

export interface EventStreamProvider {
  stream(channel: string): Observable<MessageEvent>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const EVENT_STREAM_PROVIDER = Symbol('EVENT_STREAM_PROVIDER');
