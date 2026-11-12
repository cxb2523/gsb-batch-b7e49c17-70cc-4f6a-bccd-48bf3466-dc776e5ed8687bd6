import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH, type Auth } from '../auth/auth.js';
import { AccessService } from './access.service.js';
import { ACCESS_KEY, IS_PUBLIC_KEY, type AccessRequirement } from './decorators.js';

interface GuardedRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: unknown;
  session?: unknown;
}

/**
 * Authenticates every non-public request once and attaches the session to it.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (typeof value === 'string') {
        headers.set(name, value);
      } else if (Array.isArray(value)) {
        headers.set(name, value.join(', '));
      }
    }

    const session = await this.auth.api.getSession({ headers });

    if (!session) {
      throw new UnauthorizedException();
    }

    request.user = session.user;
    request.session = session.session;
    return true;
  }
}

/**
 * Default deny. A non-public route without `@Access(...)` is refused; a route with one has its
 * resource resolved once and its stated action checked against the rule table.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<AccessRequirement>(ACCESS_KEY, targets);
    if (!requirement) {
      throw new ForbiddenException('This route does not declare who may call it');
    }

    const request = context.switchToHttp().getRequest();
    const access = await this.accessService.resolve(requirement, request);

    if (requirement.can) {
      const [action, subject] = requirement.can;
      if (!access.ability.can(action, subject)) {
        throw new ForbiddenException(`You may not ${action} this ${subject.toLowerCase()}`);
      }
    }

    request.access = access;
    return true;
  }
}
