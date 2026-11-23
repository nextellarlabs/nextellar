'use client';

import { useState, useCallback, useEffect } from 'react';
import { Asset, Claimant } from '@stellar/stellar-sdk';
import {
  I18nProvider,
  useTranslation,
  useWallet,
  useWalletConfig,
} from '../../contexts';
import WalletConnectButton from '../../components/WalletConnectButton';
import NetworkSwitcher from '../../components/NetworkSwitcher';
import EmptyState from '../../components/EmptyState';
import TransactionStatusBadge, {
  type TransactionStatus,
} from '../../components/TransactionStatusBadge';
import CopyButton from '../../components/CopyButton';
import { useClaimableBalances } from '../../hooks/useClaimableBalances';
import {
  usePathPayment,
  type PathPaymentMode,
} from '../../hooks/usePathPayment';
import {
  describePath,
  minReceiveAmount,
  maxSendAmount,
  DEFAULT_SLIPPAGE_BPS,
  type PathQuote,
  type SwapAsset,
} from '../../lib/pathPayment';
import { useLiquidityPool } from '../../hooks/useLiquidityPool';

// Standard Testnet USDC asset
const TESTNET_USDC: SwapAsset = {
  code: 'USDC',
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

// Known Testnet Liquidity Pool (XLM / USDC)
const DEMO_TESTNET_POOL_ID =
  'e6ee2e8969446d333068e64cbeee0055dfae24cfa9e8fbba5dae921d784a92c0';

type ProtocolTab = 'claimable' | 'pathPayment' | 'liquidityPool';

function ProtocolsContent() {
  const { t } = useTranslation();
  const { connected, publicKey } = useWallet();
  const walletConfig = useWalletConfig();

  const [activeTab, setActiveTab] = useState<ProtocolTab>('claimable');
  const [txStatus, setTxStatus] = useState<TransactionStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // 1. Claimable Balances Hook
  const {
    balances: claimables,
    loading: claimablesLoading,
    fetchClaimableBalances,
    buildCreateClaimableBalanceXDR,
    buildClaimClaimableBalanceXDR,
  } = useClaimableBalances({ network: 'TESTNET' });

  const [claimRecipient, setClaimRecipient] = useState('');
  const [claimAmount, setClaimAmount] = useState('10');
  const [claimPredicateType, setClaimPredicateType] = useState<
    'unconditional' | 'timelock'
  >('unconditional');

  // Load claimables when wallet connects or publicKey changes
  useEffect(() => {
    if (publicKey) {
      fetchClaimableBalances(publicKey);
    }
  }, [publicKey, fetchClaimableBalances]);

  // 2. Path Payments Hook
  const { findBestPath, buildPathPaymentXDR } = usePathPayment({
    network: 'TESTNET',
  });

  const [swapMode, setSwapMode] = useState<PathPaymentMode>('strict-send');
  const [swapAmount, setSwapAmount] = useState('5');
  const [swapQuote, setSwapQuote] = useState<PathQuote | null>(null);
  const [swapFinding, setSwapFinding] = useState(false);

  // 3. Liquidity Pools Hook
  const {
    pool,
    loading: poolLoading,
    fetchPoolById,
  } = useLiquidityPool({ network: 'TESTNET' });

  const [poolIdInput, setPoolIdInput] = useState(DEMO_TESTNET_POOL_ID);

  // Handlers
  const handleCreateClaimable = async () => {
    if (!connected || !publicKey) return;
    try {
      setTxStatus('pending');
      setStatusMessage('Building create claimable balance transaction…');

      const recipient = claimRecipient.trim() || publicKey;
      const claimants = [
        new Claimant(recipient, Claimant.predicateUnconditional()),
      ];

      if (claimPredicateType === 'timelock') {
        // Claimant can claim after 60 seconds
        claimants.push(
          new Claimant(
            publicKey,
            Claimant.predicateNot(
              Claimant.predicateBeforeRelativeTime('60'),
            ),
          ),
        );
      }

      const xdr = await buildCreateClaimableBalanceXDR({
        from: publicKey,
        asset: Asset.native(),
        amount: claimAmount,
        claimants,
      });

      setTxStatus('success');
      setStatusMessage(`Transaction XDR built for Testnet (${xdr.slice(0, 16)}…)`);
    } catch (err) {
      setTxStatus('failed');
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to build claimable balance XDR',
      );
    }
  };

  const handleClaim = async (balanceId: string) => {
    if (!connected || !publicKey) return;
    try {
      setTxStatus('pending');
      setStatusMessage('Building claim transaction…');

      const xdr = await buildClaimClaimableBalanceXDR({
        from: publicKey,
        balanceId,
      });

      setTxStatus('success');
      setStatusMessage(`Claim transaction XDR built (${xdr.slice(0, 16)}…)`);
    } catch (err) {
      setTxStatus('failed');
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to build claim XDR',
      );
    }
  };

  const handleFindPath = async () => {
    setSwapFinding(true);
    setSwapQuote(null);
    setStatusMessage('');
    try {
      const best = await findBestPath({
        mode: swapMode,
        sourceAsset: 'XLM',
        destinationAsset: TESTNET_USDC,
        amount: swapAmount,
      });

      if (!best) {
        setStatusMessage(t('protocols.noRouteFound'));
        return;
      }

      setSwapQuote(best);
      setStatusMessage(t('protocols.routeFound'));
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Error finding path route',
      );
    } finally {
      setSwapFinding(false);
    }
  };

  const handleFetchPool = async () => {
    setStatusMessage('');
    const res = await fetchPoolById(poolIdInput.trim());
    if (!res) {
      setStatusMessage('Pool record not found on Testnet.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Navigation & Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {t('protocols.title')}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                {t('protocols.testnetMode')}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('protocols.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <NetworkSwitcher />
            <WalletConnectButton />
          </div>
        </header>

        {/* Status Alert or Wallet Preview Notice */}
        {!connected && (
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200 text-sm">
            <span>{t('protocols.noWalletNotice')}</span>
            <span className="text-xs opacity-80">
              {t('protocols.connectToTransact')}
            </span>
          </div>
        )}

        {txStatus && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 shadow-sm">
            <TransactionStatusBadge status={txStatus} />
            <span className="text-sm truncate">{statusMessage}</span>
          </div>
        )}

        {/* Tab Selection */}
        <nav
          className="flex space-x-2 border-b border-gray-200 dark:border-gray-800"
          aria-label="Protocol Tabs"
        >
          <button
            onClick={() => setActiveTab('claimable')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'claimable'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {t('protocols.claimableBalances')}
          </button>
          <button
            onClick={() => setActiveTab('pathPayment')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'pathPayment'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {t('protocols.pathPayments')}
          </button>
          <button
            onClick={() => setActiveTab('liquidityPool')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'liquidityPool'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {t('protocols.liquidityPools')}
          </button>
        </nav>

        {/* Tab 1: Claimable Balances */}
        {activeTab === 'claimable' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold">
                Create Claimable Balance
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Lock native XLM on Testnet claimable by an address unconditionally or with time constraints.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Recipient Address (G...)
                  </label>
                  <input
                    type="text"
                    placeholder={publicKey || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'}
                    value={claimRecipient}
                    onChange={(e) => setClaimRecipient(e.target.value)}
                    className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Amount (XLM)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Predicate Condition
                  </label>
                  <select
                    value={claimPredicateType}
                    onChange={(e) =>
                      setClaimPredicateType(e.target.value as 'unconditional' | 'timelock')
                    }
                    className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="unconditional">Unconditional (Claimable anytime)</option>
                    <option value="timelock">Relative 60s Timelock (Cliff lock)</option>
                  </select>
                </div>

                <button
                  onClick={handleCreateClaimable}
                  disabled={!connected}
                  className="w-full mt-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connected ? 'Create Claimable Balance' : 'Connect Wallet to Create'}
                </button>
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Pending Claimables</h2>
                {publicKey && (
                  <button
                    onClick={() => fetchClaimableBalances(publicKey)}
                    disabled={claimablesLoading}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {claimablesLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                )}
              </div>

              {claimables.length === 0 ? (
                <EmptyState
                  title={
                    connected
                      ? 'No pending claimable balances'
                      : 'Connect wallet to view claimable balances'
                  }
                  description="Balances assigned to your address for claiming on Testnet will appear here."
                />
              ) : (
                <ul className="space-y-3">
                  {claimables.map((record) => (
                    <li
                      key={record.id}
                      className="p-3 rounded-lg border border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-sm">
                          {record.amount} XLM
                        </span>
                        <div className="flex items-center gap-1 text-gray-500 text-[10px] mt-0.5">
                          <span>ID: {record.id.slice(0, 12)}…</span>
                          <CopyButton textToCopy={record.id} />
                        </div>
                      </div>
                      <button
                        onClick={() => handleClaim(record.id)}
                        disabled={!connected}
                        className="py-1 px-3 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium disabled:opacity-50"
                      >
                        Claim
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* Tab 2: Path Payments */}
        {activeTab === 'pathPayment' && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Testnet Path Payment & Swap</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Find optimal multihop DEX conversion paths between XLM and Testnet USDC with slippage guarantees.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Payment Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSwapMode('strict-send')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border ${
                      swapMode === 'strict-send'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    Strict Send (Fixed spend)
                  </button>
                  <button
                    onClick={() => setSwapMode('strict-receive')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border ${
                      swapMode === 'strict-receive'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    Strict Receive (Fixed output)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {swapMode === 'strict-send' ? 'Spend Amount (XLM)' : 'Target Receive (USDC)'}
                </label>
                <input
                  type="text"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={handleFindPath}
                disabled={swapFinding}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors disabled:opacity-50"
              >
                {swapFinding ? 'Searching Routes…' : 'Find Best Route'}
              </button>

              {swapQuote && (
                <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    Route: {describePath(swapQuote)}
                  </div>
                  <div className="text-sm font-medium">
                    {swapMode === 'strict-send' ? (
                      <span>
                        Estimated Receive: {swapQuote.destinationAmount} USDC (Min:{' '}
                        {minReceiveAmount(swapQuote.destinationAmount, DEFAULT_SLIPPAGE_BPS)} USDC)
                      </span>
                    ) : (
                      <span>
                        Estimated Send: {swapQuote.sourceAmount} XLM (Max:{' '}
                        {maxSendAmount(swapQuote.sourceAmount, DEFAULT_SLIPPAGE_BPS)} XLM)
                      </span>
                    )}
                  </div>
                  <button
                    disabled={!connected}
                    className="w-full mt-3 py-2 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium text-xs disabled:opacity-50"
                  >
                    {connected ? 'Execute Path Payment' : 'Connect Wallet to Swap'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Liquidity Pools */}
        {activeTab === 'liquidityPool' && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Testnet Liquidity Pool (AMM)</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Inspect automated market maker reserves, total shares, and pool fees on Stellar Testnet.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Liquidity Pool ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={poolIdInput}
                    onChange={(e) => setPoolIdInput(e.target.value)}
                    className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleFetchPool}
                    disabled={poolLoading}
                    className="py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {poolLoading ? 'Fetching…' : 'Inspect'}
                  </button>
                </div>
              </div>

              {pool ? (
                <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Total Shares:</span>
                      <p className="font-semibold">{pool.total_shares}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Fee Basis Points:</span>
                      <p className="font-semibold">{pool.fee_bp} bps (0.3%)</p>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                    <span className="text-xs text-gray-500 block mb-1">Reserves:</span>
                    <ul className="space-y-1 text-xs">
                      {pool.reserves.map((reserve, idx) => (
                        <li key={idx} className="flex justify-between font-mono">
                          <span>{reserve.asset}</span>
                          <span>{reserve.amount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Inspect a Testnet Liquidity Pool"
                  description="Enter a pool ID or use the default XLM/USDC pool to view reserves and fees."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProtocolsPage() {
  return (
    <I18nProvider>
      <ProtocolsContent />
    </I18nProvider>
  );
}
