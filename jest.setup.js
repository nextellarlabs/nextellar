import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextEncoder, TextDecoder });

import { jest } from '@jest/globals';
Object.assign(global, { jest });

import '@testing-library/jest-dom';

class BroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
  }
  postMessage(_message) {}
  close() {}
}
Object.assign(global, { BroadcastChannel });

import { ReadableStream, WritableStream, TransformStream } from 'web-streams-polyfill';
Object.assign(global, { ReadableStream, WritableStream, TransformStream });

const undici = await import('undici');
Object.assign(globalThis, {
  Headers: undici.Headers,
  Request: undici.Request,
  Response: undici.Response,
  fetch: undici.fetch,
});
