import { useCallback, useMemo, useState } from 'react';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  rpc,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

export interface ContractDeployOptions {
  sorobanRpc?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

export interface DeployContractParams {
  /** Raw WASM bytes to upload and deploy. */
  wasm: Buffer;
  /** Source account that pays fees and owns the deployment. */
  sourcePublicKey: string;
  /** Optional 32-byte salt; random when omitted. */
  salt?: Buffer;
  /** Constructor arguments passed to the new contract instance. */
  constructorArgs?: xdr.ScVal[];
  /** Optional contract function to invoke immediately after deploy. */
  constructorInvoke?: { functionName: string; args: xdr.ScVal[] };
}

export interface DeployContractResult {
  wasmHash: string;
  contractId: string;
  deployXdr: string;
  constructorXdr?: string;
}

export interface ContractDeployReturn {
  buildDeployXDR: (params: DeployContractParams) => Promise<DeployContractResult>;
  loading: boolean;
  error: Error | null;
}

function randomSalt(): Buffer {
  return Keypair.random().rawPublicKey();
}

/**
 * Builds Soroban deploy transactions: upload WASM, create contract, optional constructor invoke.
 */
export function useContractDeploy(
  opts: ContractDeployOptions = {},
): ContractDeployReturn {
  const {
    sorobanRpc = 'https://soroban-testnet.stellar.org',
    network = 'TESTNET',
  } = opts;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const networkPassphrase =
    network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const buildDeployXDR = useCallback(
    async (params: DeployContractParams): Promise<DeployContractResult> => {
      setLoading(true);
      setError(null);
      try {
        const salt = params.salt ?? randomSalt();
        const wasmHash = await rpcServer.uploadContractWasm(params.wasm, {
          fee: BASE_FEE,
          networkPassphrase,
        });

        const deployer = new Address(params.sourcePublicKey);
        const createOp = Operation.createCustomContract({
          address: deployer,
          wasmHash,
          salt,
          constructorArgs: params.constructorArgs ?? [],
        });

        const sourceAccount = new Account(params.sourcePublicKey, '0');
        const deployTx = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(createOp)
          .setTimeout(30)
          .build();

        const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({
            address: deployer.toScAddress(),
            salt,
          }),
        );
        const contractId = StrKey.encodeContract(
          xdr.HashIdPreimage.envelopeTypeContractId(preimage).hash(),
        );

        let constructorXdr: string | undefined;
        if (params.constructorInvoke) {
          const contract = new Contract(contractId);
          const invokeOp = contract.call(
            params.constructorInvoke.functionName,
            ...params.constructorInvoke.args,
          );
          constructorXdr = new TransactionBuilder(sourceAccount, {
            fee: BASE_FEE,
            networkPassphrase,
          })
            .addOperation(invokeOp)
            .setTimeout(30)
            .build()
            .toXDR();
        }

        return {
          wasmHash: wasmHash.toString('hex'),
          contractId,
          deployXdr: deployTx.toXDR(),
          constructorXdr,
        };
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [networkPassphrase, rpcServer],
  );

  return { buildDeployXDR, loading, error };
}
