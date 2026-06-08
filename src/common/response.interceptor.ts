import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = _context.switchToHttp().getRequest<Request>();
    if (request.headers.accept?.includes('text/event-stream')) return next.handle();
    return next.handle().pipe(map((data) => ({
      success: true,
      data,
      message: 'Success',
    })));
  }
}
