import { useState, useCallback, useMemo } from "react";
import { rpc, TransactionBuilder, Networks, Keypair, xdr, Address, Contract, Account, } from "@stellar/stellar-sdk";
/**
 * Custom React hook for interacting with Soroban smart contracts
 *
 * This hook provides a safe and typed abstraction to call contract functions
 * and build invoke transactions for submission. It supports read-only queries
 * via simulateTransaction and transaction building for contract invocations.
 *
 * @param opts - Configuration options including contractId, RPC URL, and network
 * @returns Object with contract interaction methods and state
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { callFunction, buildInvokeXDR, submitInvokeWithSecret, loading, error } =
 *     useSorobanContract({
 *       contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQAHHXK3AWCM',
 *       network: 'TESTNET'
 *     });
 *
 *   const handleReadContract = async () => {
 *     try {
 *       const result = await callFunction('get_balance', ['GABC...']);
 *       console.log('Contract result:', result);
 *     } catch (err) {
 *       console.error('Contract call failed:', err);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={handleReadContract} disabled={loading}>
 *         Read Contract {loading && '(Loading...)'}
 *       </button>
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @security
 * ⚠️ SECURITY WARNING: The submitInvokeWithSecret method is for DEVELOPMENT ONLY.
 * Never store secret keys in production code. In production, use a secure wallet
 * adapter for transaction signing to protect user funds and data.
 */
export function useSorobanContract(opts) {
    const { contractId, sorobanRpc = "https://soroban-testnet.stellar.org", network = "TESTNET", } = opts;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Get network passphrase based on network selection
    const networkPassphrase = network === "TESTNET" ? Networks.TESTNET : Networks.PUBLIC;
    // Initialize Soroban RPC client using useMemo to prevent recreation on every render
    const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);
    /**
     * Convert JavaScript values to Stellar XDR values for contract calls
     */
    const toXdrValue = useCallback((value) => {
        if (typeof value === "string") {
            return xdr.ScVal.scvString(value);
        }
        else if (typeof value === "number") {
            return xdr.ScVal.scvI32(value);
        }
        else if (typeof value === "boolean") {
            return xdr.ScVal.scvBool(value);
        }
        else if (value instanceof Address) {
            return value.toScVal();
        }
        else if (value && typeof value === "object" && "_address" in value) {
            // Handle Address objects
            return value.toScVal();
        }
        else if (Array.isArray(value)) {
            return xdr.ScVal.scvVec(value.map(toXdrValue));
        }
        else if (value && typeof value === "object") {
            // Handle objects by converting to map
            const entries = Object.entries(value).map(([key, val]) => new xdr.ScMapEntry({
                key: toXdrValue(key),
                val: toXdrValue(val),
            }));
            return xdr.ScVal.scvMap(entries);
        }
        // Default to string representation
        return xdr.ScVal.scvString(String(value));
    }, []);
    /**
     * Convert Stellar XDR values back to JavaScript values
     */
    const fromXdrValue = useCallback((scVal) => {
        switch (scVal.switch()) {
            case xdr.ScValType.scvBool():
                return scVal.b();
            case xdr.ScValType.scvI32():
                return scVal.i32();
            case xdr.ScValType.scvI64():
                return scVal.i64().toString();
            case xdr.ScValType.scvU32():
                return scVal.u32();
            case xdr.ScValType.scvU64():
                return scVal.u64().toString();
            case xdr.ScValType.scvString():
                return scVal.str().toString();
            case xdr.ScValType.scvBytes():
                return scVal.bytes();
            case xdr.ScValType.scvVec():
                return scVal.vec()?.map(fromXdrValue) || [];
            case xdr.ScValType.scvMap():
                const map = scVal.map();
                const result = {};
                if (map) {
                    for (let i = 0; i < map.length; i++) {
                        const entry = map[i];
                        const key = fromXdrValue(entry.key());
                        const val = fromXdrValue(entry.val());
                        result[String(key)] = val;
                    }
                }
                return result;
            case xdr.ScValType.scvAddress():
                return scVal.address().toString();
            default:
                return scVal.toString();
        }
    }, []);
    /**
     * Call a contract function in read-only mode (simulate)
     * This method uses the Soroban RPC simulateTransaction endpoint to execute
     * contract functions without submitting transactions to the network.
     *
     * @param name - The name of the contract function to call
     * @param args - Array of arguments to pass to the function
     * @returns Promise resolving to the function result
     */
    const callFunction = useCallback(async (name, args = []) => {
        setLoading(true);
        setError(null);
        try {
            // Create a dummy account for simulation (doesn't need to exist)
            const dummyKeypair = Keypair.random();
            const dummyAccount = new Account(dummyKeypair.publicKey(), "0");
            // Build the contract invocation operation
            const contract = new Contract(contractId);
            const operation = contract.call(name, ...args.map(toXdrValue));
            // Build transaction for simulation
            const txBuilder = new TransactionBuilder(dummyAccount, {
                fee: "100",
                networkPassphrase,
            })
                .addOperation(operation)
                .setTimeout(30);
            const transaction = txBuilder.build();
            // Simulate the transaction
            const simulation = await rpcServer.simulateTransaction(transaction);
            if ("error" in simulation && simulation.error) {
                throw new Error(`Simulation failed: ${simulation.error}`);
            }
            // Extract and convert the result
            if ("result" in simulation && simulation.result?.retval) {
                return fromXdrValue(simulation.result.retval);
            }
            return null;
        }
        catch (err) {
            const error = err;
            setError(error);
            throw error;
        }
        finally {
            setLoading(false);
        }
    }, [contractId, networkPassphrase, rpcServer, toXdrValue, fromXdrValue]);
    /**
     * Build an unsigned contract invocation XDR
     * This method creates a transaction XDR that can be signed and submitted later.
     *
     * @param name - The name of the contract function to invoke
     * @param args - Array of arguments to pass to the function
     * @returns Promise resolving to the unsigned XDR string
     */
    const buildInvokeXDR = useCallback(async (name, args = []) => {
        setLoading(true);
        setError(null);
        try {
            // Create a dummy account for building (will be replaced by actual signer)
            const dummyKeypair = Keypair.random();
            const dummyAccount = new Account(dummyKeypair.publicKey(), "0");
            // Build the contract invocation operation
            const contract = new Contract(contractId);
            const operation = contract.call(name, ...args.map(toXdrValue));
            // Build transaction
            const txBuilder = new TransactionBuilder(dummyAccount, {
                fee: "100",
                networkPassphrase,
            })
                .addOperation(operation)
                .setTimeout(30);
            const transaction = txBuilder.build();
            return transaction.toXDR();
        }
        catch (err) {
            const error = err;
            setError(error);
            throw error;
        }
        finally {
            setLoading(false);
        }
    }, [contractId, networkPassphrase, toXdrValue]);
    /**
     * Submit a signed contract invocation transaction
     *
     * ⚠️ SECURITY WARNING: This method is for DEVELOPMENT ONLY.
     * Never use this in production with real secret keys. Always use a secure
     * wallet adapter for transaction signing in production environments.
     *
     * @param xdr - The signed transaction XDR
     * @param secret - The secret key for signing (DEV-ONLY)
     * @returns Promise resolving to the transaction result
     */
    const submitInvokeWithSecret = useCallback(async (xdr, secret) => {
        setLoading(true);
        setError(null);
        try {
            // Parse the transaction from XDR
            const transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
            // Sign with the provided secret key (DEV-ONLY)
            const keypair = Keypair.fromSecret(secret);
            transaction.sign(keypair);
            // Submit the transaction
            const result = await rpcServer.sendTransaction(transaction);
            return result;
        }
        catch (err) {
            const error = err;
            setError(error);
            throw error;
        }
        finally {
            setLoading(false);
        }
    }, [networkPassphrase, rpcServer]);
    return {
        callFunction,
        buildInvokeXDR,
        submitInvokeWithSecret,
        loading,
        error,
    };
}
