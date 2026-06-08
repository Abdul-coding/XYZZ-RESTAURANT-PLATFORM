import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException
      ? exception.getResponse()
      : { message: 'Internal server error' };
    const body = typeof raw === 'string' ? { message: raw } : raw as Record<string, unknown>;
    const message = Array.isArray(body.message) ? body.message.join(', ') : String(body.message);
    response.status(status).json({
      success: false,
      error: {
        code: String(body.code ?? HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR'),
        message,
      },
    });
  }
}
