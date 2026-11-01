import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The web widget is called from customer sites: any origin may reach /v1/widget/sessions (the site key's
 * registered origins are enforced in WidgetService). Everything else is same-site only (APP_URL).
 */
export function corsDelegate(req: { url?: string }, cb: (err: Error | null, options: CorsOptions) => void) {
  if ((req.url ?? '').startsWith('/v1/widget/sessions')) {
    cb(null, { origin: true, credentials: false, methods: ['POST'], allowedHeaders: ['Content-Type'], maxAge: 600 });
  } else {
    cb(null, { origin: process.env.APP_URL ?? 'http://localhost:5173', credentials: true });
  }
}
