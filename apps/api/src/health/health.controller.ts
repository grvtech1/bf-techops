import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Public } from "../common/http.js";

@Controller("health")
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get("live")
  live(): Record<string, string> {
    return { status: "alive" };
  }

  @Public()
  @Get("ready")
  async ready(): Promise<Record<string, string>> {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ready", mysql: "up" };
    } catch {
      throw new ServiceUnavailableException({ status: "not_ready", mysql: "down" });
    }
  }
}

