import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { AppDependencies, adminRoutes, authRoutes, healthRoutes, internalRoutes, trustedIpsRoutes } from './routes';
import { errorHandler } from './middlewares';

/**
 * Ensambla la aplicación Hono: middlewares transversales, rutas y manejador
 * de errores. No arranca el servidor (eso es responsabilidad de main.ts).
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    app.use('*', httpInstrumentationMiddleware({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'auth-service',
      captureRequestHeaders: ['x-request-id'],
      spanNameFactory: (c) => `HTTP ${c.req.method} ${c.req.path}`,
    }));
  }
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: deps.corsOrigin,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret'],
    }),
  );

  app.route('/', healthRoutes());
  app.route('/auth', authRoutes(deps));
  app.route('/', adminRoutes(deps));
  app.route('/', trustedIpsRoutes(deps));
  app.route('/', internalRoutes(deps));

  app.onError(errorHandler);
  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'Recurso no encontrado.' }, 404));

  return app;
}
