import express, { type Express } from 'express';
import request from 'supertest';
import {
  createErrorHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  type InternalLogger,
} from '../middleware/errorHandler.js';

function buildApp(opts: {
  logger?: InternalLogger;
  includeRequestId?: boolean;
  errorFactory?: () => unknown;
  injectRequestId?: string;
} = {}): Express {
  const app = express();
  app.use(express.json());

  app.get('/boom', (_req, res, next) => {
    if (opts.injectRequestId) res.locals['requestId'] = opts.injectRequestId;
    next(opts.errorFactory ? opts.errorFactory() : new Error('unexpected'));
  });

  app.use(
    createErrorHandler({
      logger: opts.logger ?? (() => {}),
      includeRequestId: opts.includeRequestId,
    }),
  );
  return app;
}

// ── Known error types ──────────────────────────────────────────────────────

describe('createErrorHandler — known error types', () => {
  it('maps ValidationError to 400 with message and code', async () => {
    const app = buildApp({ errorFactory: () => new ValidationError('email is required') });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'email is required', code: 'validation_error' });
  });

  it('maps AuthenticationError to 401', async () => {
    const app = buildApp({ errorFactory: () => new AuthenticationError() });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('authentication_error');
  });

  it('maps AuthorizationError to 403', async () => {
    const app = buildApp({ errorFactory: () => new AuthorizationError() });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('authorization_error');
  });

  it('maps NotFoundError to 404', async () => {
    const app = buildApp({ errorFactory: () => new NotFoundError() });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('maps ConflictError to 409', async () => {
    const app = buildApp({ errorFactory: () => new ConflictError('duplicate key') });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('maps a custom AppError with arbitrary status and code', async () => {
    const app = buildApp({
      errorFactory: () => new AppError(422, 'unprocessable entity', 'unprocessable_entity'),
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'unprocessable entity', code: 'unprocessable_entity' });
  });

  it('accepts 4xx status from framework-shaped errors (body-parser)', async () => {
    const err = Object.assign(new Error('payload too large'), { status: 413 });
    const app = buildApp({ errorFactory: () => err });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(413);
  });
});

// ── Unknown errors ─────────────────────────────────────────────────────────

describe('createErrorHandler — unknown errors', () => {
  it('returns 500 with a generic message for an unrecognised Error', async () => {
    const app = buildApp({ errorFactory: () => new Error('secret db connection string') });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('db connection string');
  });

  it('returns 500 for non-Error throws', async () => {
    const app = buildApp({ errorFactory: () => 'something blew up' });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('never leaks stack traces or internal messages to the client', async () => {
    const app = buildApp({ errorFactory: () => new Error('private stack detail') });
    const res = await request(app).get('/boom');
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('stack');
    expect(serialised).not.toContain('private stack detail');
  });

  it('does not promote 5xx status from framework-shaped errors', async () => {
    const err = Object.assign(new Error('server error'), { status: 503 });
    const app = buildApp({ errorFactory: () => err });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
  });
});

// ── Internal logging ───────────────────────────────────────────────────────

describe('createErrorHandler — internal logging', () => {
  it('logs full error details including message and stack', async () => {
    const logged: unknown[] = [];
    const logger: InternalLogger = (d) => logged.push(d);
    const app = buildApp({ logger, errorFactory: () => new Error('secret internal detail') });

    await request(app).get('/boom');

    expect(logged).toHaveLength(1);
    const entry = logged[0] as Record<string, unknown>;
    const serialised = JSON.stringify(entry);
    expect(serialised).toContain('secret internal detail');
    expect(entry['status']).toBe(500);
    expect(entry['method']).toBe('GET');
  });

  it('includes requestId from res.locals in response and log when enabled', async () => {
    const logged: unknown[] = [];
    const app = buildApp({
      logger: (d) => logged.push(d),
      includeRequestId: true,
      injectRequestId: 'req-abc-123',
      errorFactory: () => new ValidationError('bad input'),
    });

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.requestId).toBe('req-abc-123');
    expect((logged[0] as Record<string, unknown>)['requestId']).toBe('req-abc-123');
  });

  it('omits requestId when includeRequestId is false', async () => {
    const app = buildApp({
      includeRequestId: false,
      injectRequestId: 'should-not-appear',
      errorFactory: () => new NotFoundError(),
    });

    const res = await request(app).get('/boom');

    expect(res.body.requestId).toBeUndefined();
  });

  it('omits requestId when res.locals.requestId is not set', async () => {
    const app = buildApp({
      includeRequestId: true,
      errorFactory: () => new AuthenticationError(),
    });

    const res = await request(app).get('/boom');

    expect(res.body.requestId).toBeUndefined();
  });
});

// ── Integration: default exported handler ──────────────────────────────────

describe('errorHandler (default export)', () => {
  it('is a usable Express error middleware', async () => {
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const app = express();
    app.get('/fail', (_req, _res, next) => next(new AppError(418, "I'm a teapot", 'teapot')));
    app.use(errorHandler);

    const res = await request(app).get('/fail');
    expect(res.status).toBe(418);
    expect(res.body.code).toBe('teapot');
  });
});
