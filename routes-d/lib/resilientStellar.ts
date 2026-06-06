import { CircuitBreaker, CircuitOpenError } from "./circuitBreaker.js";
import {
  createHorizonClient,
  type HorizonClient,
  type HorizonClientOptions,
  type HorizonFailoverEvent,
} from "./horizonClient.js";

export interface ResilientHorizonOptions extends HorizonClientOptions {
  circuitBreaker?: ConstructorParameters<typeof CircuitBreaker>[0];
}

export interface ResilientHorizonClient extends HorizonClient {
  circuitState(): ReturnType<CircuitBreaker["getState"]>;
}

export function createResilientHorizonClient(options: ResilientHorizonOptions = {}): ResilientHorizonClient {
  const breaker = new CircuitBreaker(options.circuitBreaker);
  const inner = createHorizonClient(options);

  return {
    lastEndpointUsed() {
      return inner.lastEndpointUsed();
    },
    circuitState() {
      return breaker.getState();
    },
    getJson<T = unknown>(path: string): Promise<T> {
      return breaker.execute(() => inner.getJson<T>(path));
    },
  };
}

export interface SorobanRpcProbe {
  getLatestLedger(): Promise<{ sequence: number }>;
}

export interface ResilientSorobanRpc extends SorobanRpcProbe {
  circuitState(): ReturnType<CircuitBreaker["getState"]>;
}

export function createResilientSorobanRpc(
  rpc: SorobanRpcProbe,
  options: ConstructorParameters<typeof CircuitBreaker>[0] = {},
): ResilientSorobanRpc {
  const breaker = new CircuitBreaker(options);
  return {
    circuitState() {
      return breaker.getState();
    },
    getLatestLedger() {
      return breaker.execute(() => rpc.getLatestLedger());
    },
  };
}

export { CircuitOpenError, type HorizonFailoverEvent };
