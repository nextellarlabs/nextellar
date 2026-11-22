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

/**
 * @typedef {Object} ContractDeployOptions
 * @property {string} [sorobanRpc] - Soroban RPC endpoint URL.
 * @property {'TESTNET'|'PUBLIC'} [network] - Network to target.
 */

/**
 * @typedef {Object} DeployContractParams
 * @property {Buffer} wasm - Raw WASM bytes to upload and deploy.
 * @property {string} sourcePublicKey - Source account that pays fees and owns the deployment.
 * @property {Buffer} [salt] - Optional 32-byte salt; random when omitted.
 * @property {import('@stellar/stellar-sdk').xdr.ScVal[]} [constructorArgs] - Constructor arguments passed to the new contract instance.
 * @property {{ functionName: string, args: import('@stellar/stellar-sdk').xdr.ScVal[] }} [constructorInvoke] - Optional contract function to invoke immediately after deploy.
 */

/**
 * @typedef {Object} DeployContractResult
 * @property {string} wasmHash
 * @property {string} contractId
 * @property {string} deployXdr
 * @property {string} [constructorXdr]
 */

/**
 * @typedef {Object} ContractDeployReturn
 * @property {(params: DeployContractParams) => Promise<DeployContractResult>} buildDeployXDR
 * @property {boolean} loading
 * @property {Error|null} error
 */

function randomSalt() {
  return Keypair.random().rawPublicKey();
}

/**
 * Builds Soroban deploy transactions: upload WASM, create contract, optional constructor invoke.
 *
 * @param {ContractDeployOptions} [opts]
 * @returns {ContractDeployReturn}
 */
export function useContractDeploy(opts = {}) {
  const {
    sorobanRpc = 'https://soroban-testnet.stellar.org',
    network = 'TESTNET',
  } = opts;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const networkPassphrase =
    network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const buildDeployXDR = useCallback(
    async (params) => {
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

        let constructorXdr;
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
