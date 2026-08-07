/**
 * Integration tests for SAR generation and config reload flow.
 */

import express from 'express';
import request from 'supertest';
import complianceSarRouter from '../../routes/compliance.sar.js';
import {
  __resetSarRulesConfig,
  __resetSarReportSequence,
} from '../../lib/sarRules.js';

describe('Compliance SAR integration', () => {
  let app: express.Express;

  beforeEach(() => {
    __resetSarRulesConfig();
    __resetSarReportSequence();

    app = express();
    app.use(express.json());
    app.use(complianceSarRouter);
  });

  it('runs end-to-end: reload config, generate report, fetch rules', async () => {
    await request(app)
      .post('/compliance/sar/rules/reload')
      .send({
        config: {
          version: '3.0.0',
          rules: [
            {
              id: 'integration-rule',
              name: 'Integration rule',
              description: 'E2E threshold',
              field: 'amount',
              operator: 'gt',
              threshold: 999,
              severity: 'medium',
              enabled: true,
            },
          ],
        },
      })
      .expect(200);

    const generate = await request(app)
      .post('/compliance/sar/generate')
      .send({
        subjectId: 'user-integ',
        activities: [
          {
            id: 'a1',
            timestamp: '2026-07-25T14:00:00.000Z',
            type: 'transfer',
            amount: 1_500,
          },
        ],
      })
      .expect(200);

    expect(generate.body.data.configVersion).toBe('3.0.0');
    expect(generate.body.data.hits).toHaveLength(1);

    const rules = await request(app).get('/compliance/sar/rules').expect(200);

    expect(rules.body.data.version).toBe('3.0.0');
    expect(rules.body.data.rules[0].id).toBe('integration-rule');
  });
});
