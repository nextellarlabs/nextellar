// jest.setup.jest-dom.ts
//
// Shared Jest setup for jest-dom, the ESM fetch polyfills, and MSW.
import { jest } from '@jest/globals';
Object.assign(global, { jest });

import '@testing-library/jest-dom';

import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextEncoder, TextDecoder });

class BroadcastChannel {
	name: string;
	onmessage: ((event: { data: unknown }) => void) | null = null;

	constructor(name: string) {
		this.name = name;
	}

	postMessage(_message: unknown) {}
	close() {}
}
Object.assign(global, { BroadcastChannel });

import {
	ReadableStream,
	WritableStream,
	TransformStream,
} from 'web-streams-polyfill';
Object.assign(global, { ReadableStream, WritableStream, TransformStream });

const undici = await import('undici');
Object.assign(globalThis, {
	Headers: undici.Headers,
	Request: undici.Request,
	Response: undici.Response,
	fetch: undici.fetch,
});

const { server } = await import('./src/mocks/server.js');
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
