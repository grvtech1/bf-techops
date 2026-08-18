import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../common/http.js";
import { TelemetryService } from "./telemetry.service.js";

@Controller()
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Public()
  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metrics(): Promise<string> {
    return this.telemetry.registry.metrics();
  }
}

