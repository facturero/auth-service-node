import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { AppDependencies, adminRoutes, authRoutes, healthRoutes } from './routes';
import { errorHandler } from './middlewares';

/**
 * Ensambla la aplicación Hono: middlewares transversales, rutas y manejador
 * de errores. No arranca el servidor (eso es responsabilidad de main.ts).
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: deps.corsOrigin,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.route('/', healthRoutes());
  app.route('/auth', authRoutes(deps));
  app.route('/', adminRoutes(deps));

  app.onError(errorHandler);
  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'Recurso no encontrado.' }, 404));

  return app;
}
