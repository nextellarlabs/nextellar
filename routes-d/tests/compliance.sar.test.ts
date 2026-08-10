import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import complianceSarRouter from '../routes/compliance.sar.js';
import { __resetSarRulesConfig, __resetSarReportSequence } from '../lib/sarRules.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(complianceSarRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('compliance SAR routes', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSarRulesConfig();
    __resetSarReportSequence();
  });

  describe('POST /compliance/sar/generate', () => {
    it('returns structured JSON with rule hits when activity matches', async () => {
      const res = await request(app)
        .post('/compliance/sar/generate')
        .send({
          subjectId: 'acct-GABC',
          activities: [
            {
              id: 'tx-100',
              timestamp: '2026-07-25T12:00:00.000Z',
              type: 'payment_send',
              amount: 15_000,
              asset: 'USDC',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.suspicious).toBe(true);
      expect(res.body.data.hitCount).toBeGreaterThan(0);
      expect(res.body.data.hits[0]).toEqual(
        expect.objectContaining({
          ruleId: expect.any(String),
          activityId: 'tx-100',
          matchedValue: 15_000,
          message: expect.any(String),
        }),
      );
    });

    it('returns no hits for benign activity (rule miss)', async () => {
      const res = await request(app)
        .post('/compliance/sar/generate')
        .send({
          subjectId: 'acct-GABC',
          activities: [
            {
              id: 'tx-101',
              timestamp: '2026-07-25T12:05:00.000Z',
              type: 'payment_receive',
              amount: 40,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.suspicious).toBe(false);
      expect(res.body.data.hits).toEqual([]);
    });

    it('returns 400 when subjectId is missing', async () => {
      const res = await request(app)
        .post('/compliance/sar/generate')
        .send({ activities: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /compliance/sar/rules/reload', () => {
    it('reloads versioned rules and affects subsequent reports', async () => {
      const reload = await request(app)
        .post('/compliance/sar/rules/reload')
        .send({
          config: {
            version: '2.0.0',
            rules: [
              {
                id: 'strict-amount',
                name: 'Strict amount',
                description: 'Lower bar for integration test',
                field: 'amount',
                operator: 'gte',
                threshold: 100,
                severity: 'high',
                enabled: true,
              },
            ],
          },
        });

      expect(reload.status).toBe(200);
      expect(reload.body.data.version).toBe('2.0.0');

      const report = await request(app)
        .post('/compliance/sar/generate')
        .send({
          subjectId: 'acct-RELOAD',
          activities: [
            {
              id: 'tx-reload',
              timestamp: '2026-07-25T13:00:00.000Z',
              type: 'payment_receive',
              amount: 150,
            },
          ],
        });

      expect(report.status).toBe(200);
      expect(report.body.data.configVersion).toBe('2.0.0');
      expect(report.body.data.hits[0].ruleId).toBe('strict-amount');
    });
  });

  describe('GET /compliance/sar/rules', () => {
    it('returns the active rules configuration', async () => {
      const res = await request(app).get('/compliance/sar/rules');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe('1.0.0');
      expect(Array.isArray(res.body.data.rules)).toBe(true);
    });
  });
});
