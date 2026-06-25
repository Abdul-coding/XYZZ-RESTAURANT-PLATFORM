import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../generated/prisma/client';
import { Request } from 'express';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

export type StaffRequest = Request & { user?: { sub: string; role: UserRole } };
type StaffJwtPayload = { sub: string; role: UserRole };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ])) return true;
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });
    try {
      req.user = await this.jwt.verifyAsync<StaffJwtPayload>(token);
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
    }
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user!.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient role' });
    }
    return true;
  }
}
