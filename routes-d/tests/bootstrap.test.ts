import { createBootstrap } from '../lib/bootstrap.js';

describe('routes-d cold-start bootstrap', () => {
  it('registers handlers within the startup budget', () => {
    const bootstrap = createBootstrap([
      {
        id: 'test.route',
        method: 'get',
        path: '/test',
        loadHandler: async () => ({}) as never,
      },
    ]);

    expect(bootstrap.metrics.registeredRoutes).toBe(1);
    expect(bootstrap.metrics.durationMs).toBeLessThan(25);
    expect(bootstrap.listRoutes()).toEqual([{ id: 'test.route', method: 'get', path: '/test' }]);
  });

  it('defers route module loading until resolution', async () => {
    let loadCount = 0;
    const bootstrap = createBootstrap([
      {
        id: 'lazy.route',
        method: 'post',
        path: '/lazy',
        loadHandler: async () => {
          loadCount += 1;
          return { lazy: true } as never;
        },
      },
    ]);

    expect(loadCount).toBe(0);
    await expect(bootstrap.resolveRoute('lazy.route')).resolves.toEqual({ lazy: true });
    expect(loadCount).toBe(1);
  });
});
