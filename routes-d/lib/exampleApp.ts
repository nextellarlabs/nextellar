/**
 * Example Express application demonstrating deprecation middleware integration
 * 
 * This file shows how to integrate the deprecation middleware into an Express app.
 */

import express, { Application } from 'express';
import { getDeprecationMiddleware } from '../middleware/deprecation.js';
import { errorHandler } from '../middleware/errorHandler.js';
import exampleRouter from '../routes/example.deprecated.js';

/**
 * Create and configure Express application with deprecation middleware
 */
export function createApp(): Application {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize deprecation middleware
  const deprecation = getDeprecationMiddleware();
  
  // Enable hot-reloading in development
  if (process.env.NODE_ENV === 'development') {
    deprecation.watchManifest();
  }

  // Apply deprecation middleware globally (before routes)
  app.use(deprecation.middleware());

  // Register routes
  app.use(exampleRouter);

  // Health check endpoint (not deprecated)
  app.get('/health', (_req, res) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Deprecation statistics endpoint (for monitoring)
  app.get('/admin/deprecation-stats', (_req, res) => {
    const stats = deprecation.getStats();
    const manifest = deprecation.getManifest();
    
    res.json({
      manifest: {
        version: manifest?.version,
        deprecatedEndpoints: manifest?.deprecated.length || 0,
      },
      usage: stats,
      generatedAt: new Date().toISOString(),
    });
  });

  // Clear deprecation statistics (admin endpoint)
  app.post('/admin/deprecation-stats/clear', (_req, res) => {
    deprecation.clearStats();
    res.json({ 
      success: true,
      message: 'Statistics cleared',
    });
  });

  // Reload manifest manually (admin endpoint)
  app.post('/admin/deprecation-manifest/reload', (_req, res) => {
    const success = deprecation.loadManifest();
    res.json({
      success,
      message: success ? 'Manifest reloaded' : 'Failed to reload manifest',
      manifest: deprecation.getManifest(),
    });
  });

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Start the server
 */
export function startServer(port = 3000): void {
  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Deprecation stats: http://localhost:${port}/admin/deprecation-stats`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      const deprecation = getDeprecationMiddleware();
      deprecation.unwatchManifest();
      process.exit(0);
    });
  });
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  startServer(port);
}
