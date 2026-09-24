export function useSorobanContract(_opts: unknown) {
  return {
    callFunction: async () => 0,
    buildInvokeXDR: async () => "",
    submitInvokeWithSecret: async () => ({}),
    loading: false,
    error: null,
  };
}
