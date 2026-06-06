import { performance } from 'node:perf_hooks';
import type { Router } from 'express';

export interface RouteRegistration {
  id: string;
  path: string;
  method: 'get' | 'post';
  loadHandler: () => Promise<Router>;
}

export interface BootstrapMetrics {
  startedAt: string;
  durationMs: number;
  registeredRoutes: number;
}

const DEFAULT_ROUTES: RouteRegistration[] = [
  {
    id: 'stellar.pool',
    path: '/stellar/pool',
    method: 'post',
    loadHandler: async () => (await import('../routes/stellar.pool.deposit.js')).default,
  },
  {
    id: 'stellar.ledger',
    path: '/stellar/ledger/stream',
    method: 'get',
    loadHandler: async () => (await import('../routes/stellar.ledger.stream.js')).default,
  },
];

export function createBootstrap(routes: RouteRegistration[] = DEFAULT_ROUTES) {
  const startedAt = new Date();
  const start = performance.now();
  const registry = new Map<string, RouteRegistration>();

  for (const route of routes) {
    registry.set(route.id, route);
  }

  const metrics: BootstrapMetrics = {
    startedAt: startedAt.toISOString(),
    durationMs: performance.now() - start,
    registeredRoutes: registry.size,
  };

  return {
    metrics,
    listRoutes: () => [...registry.values()].map(({ id, path, method }) => ({ id, path, method })),
    resolveRoute: async (id: string) => {
      const registration = registry.get(id);
      if (!registration) {
        throw new Error(`Unknown routes-d route: ${id}`);
      }

      return registration.loadHandler();
    },
  };
}

export const bootstrap = createBootstrap();
