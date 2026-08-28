/**
 * Deprecation Middleware for routes-d
 * 
 * Emits Deprecation and Sunset headers for deprecated endpoints.
 * Configured via a deprecation manifest file.
 */

import type { Request, Response, NextFunction } from 'express';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'fs';
import * as path from 'path';

export interface DeprecationEntry {
  /** HTTP method (GET, POST, etc.) or * for all methods */
  method: string;
  /** Route path pattern (e.g., /api/v1/users) */
  path: string;
  /** RFC 8594 Deprecation header value (true or HTTP date) */
  deprecation: string;
  /** RFC 8594 Sunset header value (HTTP date when endpoint will be removed) */
  sunset?: string;
  /** Optional deprecation message */
  message?: string;
  /** Link to migration guide or alternative endpoint */
  link?: string;
}

export interface DeprecationManifest {
  version: string;
  deprecated: DeprecationEntry[];
}

export interface DeprecationStats {
  endpoint: string;
  method: string;
  count: number;
  lastAccessed: string;
}

/**
 * Logger for deprecated endpoint usage
 */
class DeprecationLogger {
  private stats: Map<string, DeprecationStats> = new Map();

  log(method: string, path: string): void {
    const key = `${method}:${path}`;
    const existing = this.stats.get(key);
    
    if (existing) {
      existing.count++;
      existing.lastAccessed = new Date().toISOString();
    } else {
      this.stats.set(key, {
        endpoint: path,
        method,
        count: 1,
        lastAccessed: new Date().toISOString(),
      });
    }

    // Log to console for monitoring/outreach
    console.warn(
      `[DEPRECATION] ${method} ${path} accessed at ${new Date().toISOString()}`
    );
  }

  getStats(): DeprecationStats[] {
    return Array.from(this.stats.values());
  }

  clearStats(): void {
    this.stats.clear();
  }
}

/**
 * Deprecation middleware manager
 */
export class DeprecationMiddleware {
  private manifest: DeprecationManifest | null = null;
  private manifestPath: string;
  private logger = new DeprecationLogger();
  private watching = false;

  constructor(manifestPath?: string) {
    this.manifestPath =
      manifestPath ||
      path.join(process.cwd(), 'routes-d', 'config', 'deprecation-manifest.json');
    this.loadManifest();
  }

  /**
   * Load the deprecation manifest from disk
   */
  loadManifest(): boolean {
    try {
      if (!existsSync(this.manifestPath)) {
        console.warn(`[Deprecation] Manifest not found: ${this.manifestPath}`);
        this.manifest = null;
        return false;
      }

      const content = readFileSync(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(content) as DeprecationManifest;
      console.log(
        `[Deprecation] Loaded manifest v${this.manifest.version} with ${this.manifest.deprecated.length} entries`
      );
      return true;
    } catch (error) {
      console.error('[Deprecation] Failed to load manifest:', error);
      this.manifest = null;
      return false;
    }
  }

  /**
   * Enable hot-reloading of the manifest file
   */
  watchManifest(): void {
    if (this.watching) return;

    watchFile(this.manifestPath, { interval: 2000 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('[Deprecation] Manifest changed, reloading...');
        this.loadManifest();
      }
    });

    this.watching = true;
  }

  /**
   * Stop watching the manifest file
   */
  unwatchManifest(): void {
    if (!this.watching) return;
    unwatchFile(this.manifestPath);
    this.watching = false;
  }

  /**
   * Find deprecation entry matching the request
   */
  private findDeprecationEntry(req: Request): DeprecationEntry | null {
    if (!this.manifest) return null;

    return (
      this.manifest.deprecated.find((entry) => {
        // Match method (or wildcard *)
        const methodMatches =
          entry.method === '*' ||
          entry.method.toUpperCase() === req.method.toUpperCase();

        // Match path (exact match or pattern)
        const pathMatches = this.matchPath(entry.path, req.path);

        return methodMatches && pathMatches;
      }) || null
    );
  }

  /**
   * Simple path matching with wildcard support
   */
  private matchPath(pattern: string, path: string): boolean {
    // Exact match
    if (pattern === path) return true;

    // Convert pattern to regex (simple wildcard support)
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
      .replace(/:\w+/g, '[^/]+'); // Support :param style
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Express middleware function
   */
  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const entry = this.findDeprecationEntry(req);

      if (entry) {
        // Set Deprecation header (RFC 8594)
        res.setHeader('Deprecation', entry.deprecation);

        // Set Sunset header if provided
        if (entry.sunset) {
          res.setHeader('Sunset', entry.sunset);
        }

        // Set Link header for migration guide
        if (entry.link) {
          res.setHeader('Link', `<${entry.link}>; rel="deprecation"`);
        }

        // Set custom warning header with message
        if (entry.message) {
          res.setHeader(
            'X-Deprecation-Message',
            entry.message
          );
        }

        // Log usage for outreach
        this.logger.log(req.method, req.path);
      }

      next();
    };
  }

  /**
   * Get deprecation usage statistics
   */
  getStats(): DeprecationStats[] {
    return this.logger.getStats();
  }

  /**
   * Clear deprecation statistics
   */
  clearStats(): void {
    this.logger.clearStats();
  }

  /**
   * Get current manifest
   */
  getManifest(): DeprecationManifest | null {
    return this.manifest;
  }
}

// Singleton instance
let instance: DeprecationMiddleware | null = null;

/**
 * Get or create the singleton deprecation middleware instance
 */
export function getDeprecationMiddleware(manifestPath?: string): DeprecationMiddleware {
  if (!instance) {
    instance = new DeprecationMiddleware(manifestPath);
  }
  return instance;
}

/**
 * Create a new deprecation middleware instance (for testing)
 */
export function createDeprecationMiddleware(manifestPath?: string): DeprecationMiddleware {
  return new DeprecationMiddleware(manifestPath);
}
