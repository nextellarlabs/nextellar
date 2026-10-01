/**
 * Human-readable descriptions for Stellar transaction/operation result codes.
 *
 * Horizon's submission failures carry these in
 * `response.data.extras.result_codes` — a `transaction` code (e.g.
 * `tx_failed`) plus one `operations` code per operation in the transaction
 * (e.g. `op_no_destination`). The raw codes are accurate but not meant for
 * end users; this maps the codes actually reachable from a client-built
 * payment/change-trust transaction to a short, readable reason.
 *
 * Reference: https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes
 */

/** Transaction-level result codes (outer envelope), keyed by their raw Horizon string. */
const TRANSACTION_RESULT_CODES = {
  tx_success: 'Transaction succeeded.',
  tx_failed: 'One or more operations in the transaction failed.',
  tx_too_early: 'Transaction submitted before its valid start time.',
  tx_too_late: 'Transaction submitted after its valid end time (the signed XDR may have expired).',
  tx_missing_operation: 'Transaction has no operations.',
  tx_bad_seq: 'Transaction sequence number does not match the source account (it may have already been submitted, or another transaction was submitted first).',
  tx_bad_auth: 'Transaction signature is invalid or insufficient for the source account.',
  tx_insufficient_balance: 'Source account balance is too low to cover the transaction fee and reserves.',
  tx_no_source_account: 'Source account does not exist on the network.',
  tx_insufficient_fee: 'Transaction fee is too low for current network conditions.',
  tx_bad_auth_extra: 'Transaction has unused/extraneous signatures.',
  tx_internal_error: 'An unexpected internal error occurred on the Stellar network.',
};

/** Operation-level result codes, keyed by their raw Horizon string. */
const OPERATION_RESULT_CODES = {
  op_success: 'Operation succeeded.',
  op_malformed: 'Operation is malformed (invalid parameters).',
  op_underfunded: 'Source account does not have enough balance to complete this operation.',
  op_no_destination: 'Destination account does not exist. It may need to be funded first.',
  op_no_trust: 'Destination account does not have a trustline for this asset.',
  op_not_authorized: 'The asset issuer has not authorized this account to hold or transact this asset.',
  op_line_full: "Destination account's trustline limit for this asset would be exceeded.",
  op_no_issuer: 'The specified asset issuer account does not exist.',
  op_too_few_offers: 'Not enough offers exist on the order book to complete this operation.',
  op_cross_self: 'Operation would cross an offer from the same account.',
  op_sell_no_trust: 'Source account does not have a trustline for the asset being sent.',
  op_buy_no_trust: 'Source account does not have a trustline for the asset being bought.',
  op_low_reserve: 'Operation would leave the account below its minimum reserve requirement.',
  op_bad_auth: 'Operation requires authorization the submitting signer does not have.',
  op_no_account: 'The account referenced by this operation does not exist.',
  op_invalid_limit: 'The trustline limit is invalid (e.g. below the current balance).',
  op_already_exists: 'The trustline or entry this operation would create already exists.',
};

/**
 * Decode a Horizon `result_codes` payload into a readable reason. Prefers
 * the first failing operation code over the transaction-level code, since
 * the operation code is almost always the actionable one (e.g.
 * `op_no_destination` explains *why* `tx_failed`, not just *that* it did).
 *
 * @param {{ transaction?: string, operations?: string[] }} [codes]
 * @returns {{ transactionCode?: string, operationCodes?: string[], reason: string }}
 */
export function decodeResultCodes(codes) {
  if (!codes) {
    return { reason: 'Transaction failed for an unknown reason.' };
  }

  const failingOp = codes.operations?.find((code) => code !== 'op_success');
  const opDescription = failingOp ? OPERATION_RESULT_CODES[failingOp] : undefined;
  const txDescription = codes.transaction ? TRANSACTION_RESULT_CODES[codes.transaction] : undefined;

  const reason =
    opDescription ??
    txDescription ??
    (failingOp ? `Operation failed: ${failingOp}` : undefined) ??
    (codes.transaction ? `Transaction failed: ${codes.transaction}` : undefined) ??
    'Transaction failed for an unknown reason.';

  return {
    transactionCode: codes.transaction,
    operationCodes: codes.operations,
    reason,
  };
}
