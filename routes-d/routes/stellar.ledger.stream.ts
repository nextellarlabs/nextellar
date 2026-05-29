import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

/**
 * Stellar ledger close events stream
 * Server-sent events endpoint that streams ledger close information
 * Supports resume from client-provided cursor
 */
router.get(
  '/stellar/ledger/stream',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse optional cursor for resumption
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: 'connected', cursor })}\n\n`);

      // Mock ledger close events
      const ledgerCloser = setInterval(() => {
        const ledgerEvent = {
          type: 'ledger_close',
          sequence: Math.floor(Math.random() * 1000000),
          closeTime: new Date().toISOString(),
          txCount: Math.floor(Math.random() * 100),
        };

        res.write(`data: ${JSON.stringify(ledgerEvent)}\n\n`);
      }, 5000);

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(ledgerCloser);
        res.end();
      });

      // Send heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
      });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
