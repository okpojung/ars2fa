import { randomUUID } from 'crypto';
import type { Request } from 'express';

export function getRequestId(request: Request): string {
  const headerValue = request.header('x-request-id');
  return headerValue && headerValue.length > 0 ? headerValue : randomUUID();
}

export function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.header('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim();
  }
  return request.ip;
}
