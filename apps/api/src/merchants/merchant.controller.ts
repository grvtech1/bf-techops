import { Controller, Get } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { StoreEntity } from "@merchant-platform/persistence";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, In } from "typeorm";
import { Actor, RequireRoles } from "../common/http.js";
import { MerchantScopeService } from "../invoices/merchant-scope.service.js";

export interface StoreResponse {
  id: string;
  merchantId: string;
  code: string;
  name: string;
  timezone: string;
}

@Controller("v1/stores")
export class MerchantController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly merchantScope: MerchantScopeService
  ) {}

  @Get()
  @RequireRoles("merchant:read")
  async listStores(@Actor() actor: ActorTokenPayload): Promise<StoreResponse[]> {
    const merchantIds = await this.merchantScope.authorizedMerchantIds(
      this.dataSource.manager,
      actor.actorMerchantId
    );
    const stores = await this.dataSource.getRepository(StoreEntity).find({
      where: { merchantId: In(merchantIds), active: true },
      order: { name: "ASC" }
    });
    return stores.map(({ id, merchantId, code, name, timezone }) => ({
      id,
      merchantId,
      code,
      name,
      timezone
    }));
  }
}
