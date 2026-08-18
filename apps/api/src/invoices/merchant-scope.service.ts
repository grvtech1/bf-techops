import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MerchantEntity, StoreEntity } from "@merchant-platform/persistence";
import type { EntityManager } from "typeorm";

@Injectable()
export class MerchantScopeService {
  async authorizedMerchantIds(manager: EntityManager, actorMerchantId: string): Promise<string[]> {
    const authorized = new Set([actorMerchantId]);
    let frontier = [actorMerchantId];
    for (let depth = 0; frontier.length && depth < 16; depth += 1) {
      const children = await manager.createQueryBuilder(MerchantEntity, "merchant")
        .where("merchant.parent_merchant_id IN (:...frontier)", { frontier })
        .andWhere("merchant.active = :active", { active: true })
        .getMany();
      frontier = children.filter((child) => !authorized.has(child.id)).map((child) => child.id);
      frontier.forEach((id) => authorized.add(id));
    }
    return [...authorized];
  }

  async authorizeStore(manager: EntityManager, actorMerchantId: string, storeId: string): Promise<StoreEntity> {
    const store = await manager.findOne(StoreEntity, { where: { id: storeId, active: true } });
    if (!store) throw new NotFoundException("Store not found");

    let currentMerchantId: string | null = store.merchantId;
    const visited = new Set<string>();
    for (let depth = 0; currentMerchantId && depth < 16; depth += 1) {
      if (currentMerchantId === actorMerchantId) return store;
      if (visited.has(currentMerchantId)) break;
      visited.add(currentMerchantId);
      const merchant: MerchantEntity | null = await manager.findOne(MerchantEntity, {
        where: { id: currentMerchantId, active: true }
      });
      currentMerchantId = merchant?.parentMerchantId ?? null;
    }
    throw new ForbiddenException("Actor is not authorized for the requested store");
  }
}
