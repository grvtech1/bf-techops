import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  assertActorTokenPayload,
  constantTimeEqual,
  verifyActorToken,
  type ActorTokenPayload
} from "@merchant-platform/domain";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { API_CONFIG, type ApiConfig } from "../config.js";
import { IS_PUBLIC, PLATFORM_ONLY, REQUIRED_ROLES } from "./http.js";

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {
    this.jwks = config.actorJwksUrl ? createRemoteJWKSet(new URL(config.actorJwksUrl)) : undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      actor?: ActorTokenPayload;
    }>();
    if (!constantTimeEqual(header(request.headers["x-platform-api-key"]), this.config.platformApiKey)) {
      throw new UnauthorizedException("Invalid platform API key");
    }

    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (platformOnly) return true;

    const authorization = header(request.headers.authorization);
    if (!authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer actor token is required");
    }
    try {
      request.actor = await this.verifyActor(authorization.slice(7));
    } catch {
      throw new UnauthorizedException("Invalid or expired actor token");
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass()
    ]) ?? [];
    if (!requiredRoles.every((role) => request.actor?.roles.includes(role))) {
      throw new ForbiddenException("Actor does not have the required role");
    }
    return true;
  }

  private async verifyActor(token: string): Promise<ActorTokenPayload> {
    if (this.config.nodeEnv !== "production") {
      return verifyActorToken(token, this.config.actorTokenSecret!);
    }
    if (!this.jwks || !this.config.actorIssuer || !this.config.actorAudience) {
      throw new Error("OIDC actor verification is not configured");
    }
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.actorIssuer,
      audience: this.config.actorAudience
    });
    const actorMerchantId = payload.merchant_id;
    const roles = payload.roles;
    if (typeof actorMerchantId !== "string" || !Array.isArray(roles)) {
      throw new Error("Actor token is missing merchant_id or roles claims");
    }
    if (!payload.exp) throw new Error("Actor token must expire");
    const actor = {
      actorMerchantId,
      roles: roles as string[],
      exp: payload.exp,
      subject: payload.sub
    };
    assertActorTokenPayload(actor);
    return actor;
  }
}

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
