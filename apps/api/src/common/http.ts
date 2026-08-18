import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";

export const IS_PUBLIC = "merchant-platform:is-public";
export const PLATFORM_ONLY = "merchant-platform:platform-only";
export const REQUIRED_ROLES = "merchant-platform:required-roles";

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);
export const RequireRoles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);

export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorTokenPayload => {
  const request = context.switchToHttp().getRequest<{ actor: ActorTokenPayload }>();
  return request.actor;
});

export const RequestIdentifier = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<{ requestId?: string }>();
  return request.requestId ?? "unknown";
});
