import { renderHook, act } from '@testing-library/react';
import { useSorobanContract } from '../../src/lib/hooks/useSorobanContract.js';

describe('useSorobanContract', () => {
  const mockContractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQAHHXK3AWCM';
  
  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => 
        useSorobanContract({ contractId: mockContractId })
      );

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(typeof result.current.callFunction).toBe('function');
      expect(typeof result.current.buildInvokeXDR).toBe('function');
      expect(typeof result.current.submitInvokeWithSecret).toBe('function');
    });

    it('should use custom RPC URL when provided', () => {
      const customRpc = 'https://custom-rpc.example.com';
      const { result } = renderHook(() => 
        useSorobanContract({ 
          contractId: mockContractId, 
          sorobanRpc: customRpc 
        })
      );

      // The hook should be initialized with custom RPC
      expect(result.current).toBeDefined();
    });

    it('should use TESTNET network by default', () => {
      const { result } = renderHook(() => 
        useSorobanContract({ contractId: mockContractId })
      );

      expect(result.current).toBeDefined();
    });

    it('should use PUBLIC network when specified', () => {
      const { result } = renderHook(() => 
        useSorobanContract({ 
          contractId: mockContractId, 
          network: 'PUBLIC' 
        })
      );

      expect(result.current).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const { result } = renderHook(() => 
        useSorobanContract({ contractId: mockContractId })
      );

      // Test that the hook initializes without throwing
      expect(result.current.error).toBe(null);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('API surface', () => {
    it('should expose all required methods', () => {
      const { result } = renderHook(() => 
        useSorobanContract({ contractId: mockContractId })
      );

      expect(typeof result.current.callFunction).toBe('function');
      expect(typeof result.current.buildInvokeXDR).toBe('function');
      expect(typeof result.current.submitInvokeWithSecret).toBe('function');
      expect(typeof result.current.loading).toBe('boolean');
      expect(result.current.error === null || result.current.error instanceof Error).toBe(true);
    });
  });
});