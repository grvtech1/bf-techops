import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { loadApiConfig } from "./config.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const express = app.getHttpAdapter().getInstance();
  express.disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (config.nodeEnv === "production") {
      response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: false
  }));
  app.enableCors({
    origin: config.nodeEnv === "production" ? false : ["http://localhost:3000"],
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: [
      "authorization",
      "content-type",
      "idempotency-key",
      "x-payment-signature",
      "x-payment-timestamp",
      "x-platform-api-key",
      "x-request-id"
    ]
  });
  await app.listen(config.port, "0.0.0.0");
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(), level: "info", message: "api_listening",
    port: config.port, release: config.releaseVersion
  })}\n`);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(), level: "fatal", message: "api_start_failed",
    error: error instanceof Error ? error.message : String(error)
  })}\n`);
  process.exitCode = 1;
});
