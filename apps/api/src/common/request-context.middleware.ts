import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request & { requestId?: string }, response: Response, next: NextFunction): void {
    const supplied = request.header("x-request-id");
    request.requestId = supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  }
}

