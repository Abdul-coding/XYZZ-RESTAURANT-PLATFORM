import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile,
} from '@nestjs/common';
import { Request } from 'express';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = _context.switchToHttp().getRequest<Request>();
    if (request.headers.accept?.includes('text/event-stream')) return next.handle();
    return next.handle().pipe(map((data) => {
      if (data instanceof StreamableFile) return data;
      return { success: true, data, message: 'Success' };
    }));
  }
}
