#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const AMOUNT: i128 = 1_000;
const DEADLINE: u64 = 10_000;

struct Fixture<'a> {
    env: Env,
    client: EscrowContractClient<'a>,
    token: TokenClient<'a>,
    depositor: Address,
    beneficiary: Address,
    arbiter: Address,
    contract_id: Address,
}

fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin).address();
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let arbiter = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&depositor, &AMOUNT);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(
        &depositor,
        &beneficiary,
        &arbiter,
        &token_addr,
        &AMOUNT,
        &DEADLINE,
    );

    Fixture {
        token: TokenClient::new(&env, &token_addr),
        env,
        client,
        depositor,
        beneficiary,
        arbiter,
        contract_id,
    }
}

fn funded<'a>() -> Fixture<'a> {
    let f = setup();
    f.client.deposit();
    f
}

// ---- initialize ----

#[test]
fn initialize_sets_config_and_status() {
    let f = setup();
    assert_eq!(f.client.status(), Status::Created);
    let cfg = f.client.config();
    assert_eq!(cfg.amount, AMOUNT);
    assert_eq!(cfg.deadline, DEADLINE);
    assert_eq!(cfg.depositor, f.depositor);
    assert_eq!(cfg.beneficiary, f.beneficiary);
    assert_eq!(cfg.arbiter, f.arbiter);
}

#[test]
fn initialize_twice_fails() {
    let f = setup();
    let r = f.client.try_initialize(
        &f.depositor,
        &f.beneficiary,
        &f.arbiter,
        &f.token.address,
        &AMOUNT,
        &DEADLINE,
    );
    assert_eq!(r, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn initialize_rejects_bad_amount_and_deadline() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let a = Address::generate(&env);
    let id = env.register(EscrowContract, ());
    let c = EscrowContractClient::new(&env, &id);
    assert_eq!(
        c.try_initialize(&a, &a, &a, &a, &0, &DEADLINE),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        c.try_initialize(&a, &a, &a, &a, &1, &1_000),
        Err(Ok(Error::InvalidDeadline))
    );
}

#[test]
fn calls_before_initialize_fail() {
    let env = Env::default();
    let id = env.register(EscrowContract, ());
    let c = EscrowContractClient::new(&env, &id);
    assert_eq!(c.try_deposit(), Err(Ok(Error::NotInitialized)));
    assert_eq!(c.try_status(), Err(Ok(Error::NotInitialized)));
}

// ---- deposit ----

#[test]
fn deposit_moves_funds_into_escrow() {
    let f = setup();
    f.client.deposit();
    assert_eq!(f.client.status(), Status::Funded);
    assert_eq!(f.token.balance(&f.depositor), 0);
    assert_eq!(f.token.balance(&f.contract_id), AMOUNT);
}

#[test]
fn deposit_twice_fails() {
    let f = funded();
    assert_eq!(f.client.try_deposit(), Err(Ok(Error::InvalidState)));
}

#[test]
fn deposit_after_deadline_fails() {
    let f = setup();
    f.env.ledger().set_timestamp(DEADLINE);
    assert_eq!(f.client.try_deposit(), Err(Ok(Error::DeadlinePassed)));
}

#[test]
fn deposit_requires_depositor_auth() {
    let f = setup();
    f.client.deposit();
    let auths = f.env.auths();
    assert_eq!(auths[0].0, f.depositor);
}

// ---- release ----

#[test]
fn release_by_depositor_pays_beneficiary() {
    let f = funded();
    f.client.release(&f.depositor);
    assert_eq!(f.client.status(), Status::Released);
    assert_eq!(f.token.balance(&f.beneficiary), AMOUNT);
    assert_eq!(f.token.balance(&f.contract_id), 0);
}

#[test]
fn release_by_arbiter_pays_beneficiary() {
    let f = funded();
    f.client.release(&f.arbiter);
    assert_eq!(f.client.status(), Status::Released);
    assert_eq!(f.token.balance(&f.beneficiary), AMOUNT);
}

#[test]
fn release_by_beneficiary_or_stranger_is_unauthorized() {
    let f = funded();
    assert_eq!(
        f.client.try_release(&f.beneficiary),
        Err(Ok(Error::Unauthorized))
    );
    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client.try_release(&stranger),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(f.token.balance(&f.contract_id), AMOUNT);
}

#[test]
fn release_requires_approver_auth() {
    let f = funded();
    f.client.release(&f.arbiter);
    let auths = f.env.auths();
    assert_eq!(auths[0].0, f.arbiter);
}

#[test]
fn release_before_funding_fails() {
    let f = setup();
    assert_eq!(
        f.client.try_release(&f.depositor),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn release_after_deadline_fails() {
    let f = funded();
    f.env.ledger().set_timestamp(DEADLINE + 1);
    assert_eq!(
        f.client.try_release(&f.depositor),
        Err(Ok(Error::DeadlinePassed))
    );
}

#[test]
fn release_twice_fails() {
    let f = funded();
    f.client.release(&f.arbiter);
    assert_eq!(
        f.client.try_release(&f.arbiter),
        Err(Ok(Error::InvalidState))
    );
}

// ---- refund ----

#[test]
fn refund_by_beneficiary_returns_funds() {
    let f = funded();
    f.client.refund(&f.beneficiary);
    assert_eq!(f.client.status(), Status::Refunded);
    assert_eq!(f.token.balance(&f.depositor), AMOUNT);
    assert_eq!(f.token.balance(&f.contract_id), 0);
}

#[test]
fn refund_by_arbiter_returns_funds() {
    let f = funded();
    f.client.refund(&f.arbiter);
    assert_eq!(f.token.balance(&f.depositor), AMOUNT);
}

#[test]
fn refund_by_depositor_or_stranger_is_unauthorized() {
    let f = funded();
    assert_eq!(
        f.client.try_refund(&f.depositor),
        Err(Ok(Error::Unauthorized))
    );
    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client.try_refund(&stranger),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn refund_before_funding_or_after_release_fails() {
    let f = setup();
    assert_eq!(
        f.client.try_refund(&f.arbiter),
        Err(Ok(Error::InvalidState))
    );
    f.client.deposit();
    f.client.release(&f.arbiter);
    assert_eq!(
        f.client.try_refund(&f.arbiter),
        Err(Ok(Error::InvalidState))
    );
}

// ---- timeout ----

#[test]
fn timeout_before_deadline_fails() {
    let f = funded();
    f.env.ledger().set_timestamp(DEADLINE - 1);
    assert_eq!(f.client.try_timeout(), Err(Ok(Error::DeadlineNotReached)));
}

#[test]
fn timeout_after_deadline_refunds_depositor() {
    let f = funded();
    f.env.ledger().set_timestamp(DEADLINE);
    f.client.timeout();
    assert_eq!(f.client.status(), Status::Refunded);
    assert_eq!(f.token.balance(&f.depositor), AMOUNT);
    assert_eq!(f.env.auths()[0].0, f.depositor);
}

#[test]
fn timeout_without_funding_or_twice_fails() {
    let f = setup();
    f.env.ledger().set_timestamp(DEADLINE);
    assert_eq!(f.client.try_timeout(), Err(Ok(Error::InvalidState)));

    let g = funded();
    g.env.ledger().set_timestamp(DEADLINE);
    g.client.timeout();
    assert_eq!(g.client.try_timeout(), Err(Ok(Error::InvalidState)));
}

// ---- missing signatures ----

#[test]
#[should_panic]
fn deposit_without_signature_panics() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let a = Address::generate(&env);
    let id = env.register(EscrowContract, ());
    let c = EscrowContractClient::new(&env, &id);
    // No mock_all_auths: the depositor has not signed.
    c.initialize(&a, &a, &a, &a, &1, &DEADLINE);
    c.deposit();
}
