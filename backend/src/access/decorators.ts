import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessAction, AccessSubject } from './abilities.js';
import type { Access as AccessContext } from './access.types.js';

export const IS_PUBLIC_KEY = 'access:public';
export const ACCESS_KEY = 'access:requirement';

/** A route that needs no session and no access rule. Use it deliberately. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export type AccessScope = 'session' | 'workspace' | 'project' | 'board';

export interface AccessRequirement {
  /** What to resolve before the handler runs. */
  scope: AccessScope;
  /** Where the resource id lives. Defaults to `param` with the name `id`. */
  from?: 'param' | 'body';
  /** The path or body parameter holding the resource id. */
  param?: string;
  /** The action and subject the rule table must allow. Omit for "any authenticated member". */
  can?: [AccessAction, AccessSubject];
}

/** Declares who may call a route. Routes without this and without `@Public()` are refused. */
export const Access = (requirement: AccessRequirement): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_KEY, requirement);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessContext['user'] => {
    return context.switchToHttp().getRequest().user;
  },
);

export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessContext => {
    return context.switchToHttp().getRequest().access;
  },
);
