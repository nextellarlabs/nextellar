import { useState, useCallback, useMemo } from 'react';
import {
    rpc,
    TransactionBuilder,
    Networks,
    Keypair,
    xdr,
    Address,
    Contract,
    Account,
    StrKey,
} from '@stellar/stellar-sdk';

const MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');
const SHIFT64 = BigInt(64);

export function isValidContractId(contractId) {
    if (!contractId || typeof contractId !== 'string' || contractId.trim().length === 0) return false;
    return StrKey.isValidContract(contractId.trim());
}

function bigintToU128Parts(value) {
    const hi = value >> SHIFT64;
    const lo = value & MASK64;
    return {
        hi: xdr.Uint64.fromString(String(hi < 0n ? hi + (MASK64 + 1n) : hi)),
        lo: xdr.Uint64.fromString(String(lo)),
    };
}

function bigintToI128Parts(value) {
    return {
        hi: xdr.Int64.fromString(String(value >> SHIFT64)),
        lo: xdr.Uint64.fromString(String(value & MASK64)),
    };
}

function hiLoToI128(hi, lo) {
    return (hi << SHIFT64) | (lo & MASK64);
}

function toBuffer(value) {
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value.startsWith('0x') ? value.slice(2) : value, 'hex');
    throw new Error(`Cannot convert ${typeof value} to Bytes - expected Uint8Array or hex string`);
}

function addressToScVal(value) {
    if (typeof Address.fromString === 'function') return Address.fromString(String(value)).toScVal();
    return new Address(String(value)).toScVal();
}

export function useSorobanContract(opts) {
    const {
        contractId,
        sorobanRpc = '{{SOROBAN_URL}}',
        network = 'TESTNET',
    } = opts;

    if (!isValidContractId(contractId)) {
        throw new Error(`Invalid Soroban contract ID: "${contractId}". Must be a valid StrKey-encoded contract address (56 characters, starting with "C"). Did you forget to set your contract ID in .env.local?`);
    }

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const networkPassphrase = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;
    const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

    const toXdrValue = useCallback((arg) => {
        let value = arg;
        let hint;
        if (arg !== null && arg !== undefined && typeof arg === 'object' && !(arg instanceof Uint8Array) && 'value' in arg && 'type' in arg) {
            value = arg.value;
            hint = arg.type;
        }

        if (hint === 'u32') return xdr.ScVal.scvU32(Number(value));
        if (hint === 'i32') return xdr.ScVal.scvI32(Number(value));
        if (hint === 'u64') return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(BigInt(String(value)))));
        if (hint === 'i64') return xdr.ScVal.scvI64(xdr.Int64.fromString(String(BigInt(String(value)))));
        if (hint === 'u128') return xdr.ScVal.scvU128(new xdr.UInt128Parts(bigintToU128Parts(typeof value === 'string' ? BigInt(value) : value)));
        if (hint === 'i128') return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(typeof value === 'string' ? BigInt(value) : value)));
        if (hint === 'bool') return xdr.ScVal.scvBool(Boolean(value));
        if (hint === 'string') return xdr.ScVal.scvString(String(value));
        if (hint === 'symbol') return xdr.ScVal.scvSymbol(String(value));
        if (hint === 'address') return addressToScVal(value);
        if (hint === 'bytes') return xdr.ScVal.scvBytes(toBuffer(value));
        if (hint === 'timepoint') return xdr.ScVal.scvTimepoint(xdr.Uint64.fromString(String(value)));
        if (hint === 'duration') return xdr.ScVal.scvDuration(xdr.Uint64.fromString(String(value)));
        if (hint === 'vec') return xdr.ScVal.scvVec(value.map(toXdrValue));
        if (hint === 'map') return xdr.ScVal.scvMap(value.map(([key, val]) => new xdr.ScMapEntry({ key: toXdrValue(key), val: toXdrValue(val) })));
        if (hint === 'enum') {
            const { tag, values = [] } = value;
            return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag), ...values.map(toXdrValue)]);
        }

        if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
        if (typeof value === 'bigint') return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(value)));
        if (typeof value === 'number') return xdr.ScVal.scvI32(value);
        if (typeof value === 'string') {
            if ((value.startsWith('G') || value.startsWith('C')) && value.length === 56) return addressToScVal(value);
            return xdr.ScVal.scvString(value);
        }
        if (value instanceof Uint8Array) return xdr.ScVal.scvBytes(Buffer.from(value));
        if (value instanceof Address) return value.toScVal();
        if (value && typeof value === 'object' && '_address' in value) return value.toScVal();
        if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(toXdrValue));
        if (value && typeof value === 'object') {
            return xdr.ScVal.scvMap(Object.entries(value).map(([key, val]) => new xdr.ScMapEntry({ key: toXdrValue(key), val: toXdrValue(val) })));
        }
        return xdr.ScVal.scvString(String(value));
    }, []);

    const fromXdrValue = useCallback((scVal) => {
        const type = scVal.switch();
        if (type === xdr.ScValType.scvBool()) return scVal.b();
        if (type === xdr.ScValType.scvVoid()) return null;
        if (type === xdr.ScValType.scvU32()) return scVal.u32();
        if (type === xdr.ScValType.scvI32()) return scVal.i32();
        if (type === xdr.ScValType.scvU64()) return BigInt(scVal.u64().toString());
        if (type === xdr.ScValType.scvI64()) return BigInt(scVal.i64().toString());
        if (type === xdr.ScValType.scvU128()) {
            const parts = scVal.u128();
            return (BigInt(parts.hi().toString()) << SHIFT64) | BigInt(parts.lo().toString());
        }
        if (type === xdr.ScValType.scvI128()) {
            const parts = scVal.i128();
            return hiLoToI128(BigInt(parts.hi().toString()), BigInt(parts.lo().toString()));
        }
        if (type === xdr.ScValType.scvString()) return scVal.str().toString();
        if (type === xdr.ScValType.scvSymbol()) return scVal.sym().toString();
        if (type === xdr.ScValType.scvBytes()) return new Uint8Array(scVal.bytes());
        if (type === xdr.ScValType.scvAddress()) return scVal.address().toString();
        if (type === xdr.ScValType.scvTimepoint()) return Number(scVal.timepoint().toString());
        if (type === xdr.ScValType.scvDuration()) return Number(scVal.duration().toString());
        if (type === xdr.ScValType.scvVec()) {
            const values = scVal.vec() ?? [];
            const decoded = values.map(fromXdrValue);
            if (values.length >= 1 && values[0].switch() === xdr.ScValType.scvSymbol()) return { tag: values[0].sym().toString(), values: decoded.slice(1) };
            return decoded;
        }
        if (type === xdr.ScValType.scvMap()) {
            const map = new Map();
            for (const entry of scVal.map() ?? []) map.set(fromXdrValue(entry.key()), fromXdrValue(entry.val()));
            return map;
        }
        return scVal.toString();
    }, []);

    const buildTransaction = useCallback((name, args) => {
        const dummyKeypair = Keypair.random();
        const dummyAccount = new Account(dummyKeypair.publicKey(), '0');
        const operation = new Contract(contractId).call(name, ...args.map(toXdrValue));
        return new TransactionBuilder(dummyAccount, { fee: '100', networkPassphrase })
            .addOperation(operation)
            .setTimeout(30)
            .build();
    }, [contractId, networkPassphrase, toXdrValue]);

    const callFunction = useCallback(async (name, args = []) => {
        setLoading(true);
        setError(null);
        try {
            const simulation = await rpcServer.simulateTransaction(buildTransaction(name, args));
            if ('error' in simulation && simulation.error) throw new Error(`Simulation failed: ${simulation.error}`);
            if ('restorePreamble' in simulation && simulation.restorePreamble) {
                return { requiresRestore: true, restorePreamble: simulation.restorePreamble, transactionData: simulation.transactionData };
            }
            return 'result' in simulation && simulation.result?.retval ? fromXdrValue(simulation.result.retval) : null;
        } catch (err) {
            const nextError = err instanceof Error ? err : new Error(String(err));
            setError(nextError);
            throw nextError;
        } finally {
            setLoading(false);
        }
    }, [rpcServer, buildTransaction, fromXdrValue]);

    const simulateContractCall = useCallback(async (name, args = []) => {
        setLoading(true);
        setError(null);
        try {
            const simulation = await rpcServer.simulateTransaction(buildTransaction(name, args));
            if ('error' in simulation && simulation.error) throw new Error(`Simulation failed: ${simulation.error}`);
            return {
                result: 'result' in simulation && simulation.result?.retval ? fromXdrValue(simulation.result.retval) : null,
                minResourceFee: 'minResourceFee' in simulation ? String(simulation.minResourceFee) : '0',
                latestLedger: 'latestLedger' in simulation ? Number(simulation.latestLedger) : 0,
            };
        } catch (err) {
            const nextError = err instanceof Error ? err : new Error(String(err));
            setError(nextError);
            throw nextError;
        } finally {
            setLoading(false);
        }
    }, [rpcServer, buildTransaction, fromXdrValue]);

    const buildInvokeXDR = useCallback(async (name, args = []) => {
        setLoading(true);
        setError(null);
        try {
            return buildTransaction(name, args).toXDR();
        } catch (err) {
            const nextError = err instanceof Error ? err : new Error(String(err));
            setError(nextError);
            throw nextError;
        } finally {
            setLoading(false);
        }
    }, [buildTransaction]);

    const submitInvokeWithSecret = useCallback(async (transactionXdr, secret) => {
        setLoading(true);
        setError(null);
        try {
            const transaction = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
            transaction.sign(Keypair.fromSecret(secret));
            return await rpcServer.sendTransaction(transaction);
        } catch (err) {
            const nextError = err instanceof Error ? err : new Error(String(err));
            setError(nextError);
            throw nextError;
        } finally {
            setLoading(false);
        }
    }, [networkPassphrase, rpcServer]);

    return { callFunction, simulateContractCall, buildInvokeXDR, submitInvokeWithSecret, loading, error };
}