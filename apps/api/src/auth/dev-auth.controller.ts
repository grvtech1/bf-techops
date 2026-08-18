import { Controller, ForbiddenException, Inject, Post } from "@nestjs/common";
import { createActorToken } from "@merchant-platform/domain";
import { API_CONFIG, type ApiConfig } from "../config.js";
import { PlatformOnly } from "../common/http.js";

@Controller("v1/auth")
export class DevAuthController {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  @Post("dev-token")
  @PlatformOnly()
  token(): { token: string; expiresAt: string } {
    if (this.config.nodeEnv === "production") {
      throw new ForbiddenException("Development token endpoint is disabled");
    }
    const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    return {
      token: createActorToken({
        actorMerchantId: "00000000-0000-4000-8000-000000000001",
        subject: "local-operator",
        roles: ["merchant:read", "invoice:read", "invoice:write", "payment:read", "audit:read", "ops:read"],
        exp
      }, this.config.actorTokenSecret!),
      expiresAt: new Date(exp * 1000).toISOString()
    };
  }
}
