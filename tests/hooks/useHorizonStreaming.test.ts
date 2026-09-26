/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

let streamHandlers: {
  onmessage?: () => void;
  onerror?: (err: unknown) => void;
} = {};

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: (handlers: typeof streamHandlers) => {
              streamHandlers = handlers;
              return () => {};
            },
          }),
        }),
      }),
      operations: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: (handlers: typeof streamHandlers) => {
              streamHandlers = handlers;
              return () => {};
            },
          }),
        }),
      }),
    })),
  },
}));

await jest.unstable_mockModule(
  '../../src/templates/default/src/contexts/index.ts',
  () => ({
    useWalletConfig: () => ({
      horizonUrl: 'https://horizon-testnet.stellar.org',
    }),
  }),
);

const { useHorizonStreaming } = await import(
  '../../src/templates/default/src/hooks/useHorizonStreaming'
);

describe('useHorizonStreaming (#949)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    streamHandlers = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('invokes onUpdate when the stream receives an event', () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', onUpdate),
    );

    act(() => {
      streamHandlers.onmessage?.();
    });

    expect(onUpdate).toHaveBeenCalled();
  });

  it('falls back to polling after a stream error', () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        onUpdate,
        { pollIntervalMs: 5000 },
      ),
    );

    act(() => {
      streamHandlers.onerror?.(new Error('stream dropped'));
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onUpdate).toHaveBeenCalled();
  });
});
