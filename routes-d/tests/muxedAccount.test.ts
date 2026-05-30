import express from 'express';
import request from 'supertest';
import {
  deriveMuxedAddress,
  isValidMuxId,
  parseMuxedAddress,
  MuxedAccountError,
} from '../lib/muxedAccount.js';
import depositRouter from '../routes/stellar.deposit.address.js';

const BASE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(depositRouter);
  return app;
}

describe('muxedAccount lib', () => {
  describe('isValidMuxId', () => {
    it('accepts valid uint64 ids', () => {
      expect(isValidMuxId('0')).toBe(true);
      expect(isValidMuxId('12345')).toBe(true);
      expect(isValidMuxId('18446744073709551615')).toBe(true);
    });

    it('rejects invalid id formats', () => {
      expect(isValidMuxId('')).toBe(false);
      expect(isValidMuxId('01')).toBe(false);
      expect(isValidMuxId('-1')).toBe(false);
      expect(isValidMuxId('abc')).toBe(false);
      expect(isValidMuxId('18446744073709551616')).toBe(false);
    });
  });

  describe('deriveMuxedAddress', () => {
    it('derives a muxed M-address from base account and id', () => {
      const muxed = deriveMuxedAddress(BASE_ACCOUNT, '12345');
      expect(muxed.startsWith('M')).toBe(true);
    });

    it('rejects invalid base account', () => {
      expect(() => deriveMuxedAddress('not-an-address', '1')).toThrow(MuxedAccountError);
    });

    it('rejects invalid mux id', () => {
      expect(() => deriveMuxedAddress(BASE_ACCOUNT, '01')).toThrow(MuxedAccountError);
    });
  });

  describe('parseMuxedAddress', () => {
    it('parses a derived muxed address back to base and id', () => {
      const muxed = deriveMuxedAddress(BASE_ACCOUNT, '12345');
      const parsed = parseMuxedAddress(muxed);
      expect(parsed.baseAccount).toBe(BASE_ACCOUNT);
      expect(parsed.muxId).toBe('12345');
    });

    it('rejects non-muxed addresses', () => {
      expect(() => parseMuxedAddress(BASE_ACCOUNT)).toThrow(MuxedAccountError);
    });
  });
});

describe('Stellar deposit address routes', () => {
  const app = buildApp();

  describe('POST /stellar/deposit/address', () => {
    it('returns a muxed deposit address', async () => {
      const res = await request(app)
        .post('/stellar/deposit/address')
        .send({ baseAccount: BASE_ACCOUNT, muxId: '42' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.depositAddress.startsWith('M')).toBe(true);
      expect(res.body.data.muxId).toBe('42');
    });

    it('rejects invalid mux id', async () => {
      const res = await request(app)
        .post('/stellar/deposit/address')
        .send({ baseAccount: BASE_ACCOUNT, muxId: '007' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /stellar/deposit/match', () => {
    it('matches inbound payment to subaccount', async () => {
      const addressRes = await request(app)
        .post('/stellar/deposit/address')
        .send({ baseAccount: BASE_ACCOUNT, muxId: '99' });

      const res = await request(app)
        .post('/stellar/deposit/match')
        .send({
          paymentDestination: addressRes.body.data.depositAddress,
          baseAccount: BASE_ACCOUNT,
          muxId: '99',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matched).toBe(true);
    });

    it('rejects mismatched payment destination', async () => {
      const other = deriveMuxedAddress(BASE_ACCOUNT, '100');

      const res = await request(app)
        .post('/stellar/deposit/match')
        .send({
          paymentDestination: other,
          baseAccount: BASE_ACCOUNT,
          muxId: '99',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matched).toBe(false);
    });
  });
});
