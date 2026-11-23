#![no_std]
//! Escrow contract: multi-party authorization and time-locked release.
//!
//! Three parties are involved:
//! - `depositor`   funds the escrow and may approve the release
//! - `beneficiary` receives the funds on release and may waive them (refund)
//! - `arbiter`     a neutral third party who may either release or refund
//!
//! Lifecycle: `initialize` -> `deposit` -> (`release` | `refund` | `timeout`)
//!
//! - `release`: depositor or arbiter sends funds to the beneficiary.
//! - `refund`:  beneficiary or arbiter returns funds to the depositor.
//! - `timeout`: once `deadline` has passed with no resolution, the depositor
//!   can reclaim the funds on their own.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    /// Initialized, waiting for the depositor to fund it.
    Created = 0,
    /// Funds are held by the contract.
    Funded = 1,
    /// Funds were paid to the beneficiary.
    Released = 2,
    /// Funds were returned to the depositor (refund or timeout).
    Refunded = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub depositor: Address,
    pub beneficiary: Address,
    pub arbiter: Address,
    pub token: Address,
    pub amount: i128,
    /// Unix timestamp (seconds) at which the depositor may reclaim funds.
    pub deadline: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Status,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidDeadline = 4,
    InvalidState = 5,
    Unauthorized = 6,
    DeadlineNotReached = 7,
    DeadlinePassed = 8,
}

#[contract]
pub struct EscrowContract;

fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn load_status(env: &Env) -> Result<Status, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Status)
        .ok_or(Error::NotInitialized)
}

fn set_status(env: &Env, status: Status) {
    env.storage().instance().set(&DataKey::Status, &status);
}

#[contractimpl]
impl EscrowContract {
    /// Configure the escrow. Can only be called once.
    pub fn initialize(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }
        let config = Config {
            depositor,
            beneficiary,
            arbiter,
            token,
            amount,
            deadline,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        set_status(&env, Status::Created);
        Ok(())
    }

    /// Depositor funds the escrow with the agreed amount (before the deadline).
    pub fn deposit(env: Env) -> Result<(), Error> {
        let config = load_config(&env)?;
        if load_status(&env)? != Status::Created {
            return Err(Error::InvalidState);
        }
        config.depositor.require_auth();
        if env.ledger().timestamp() >= config.deadline {
            return Err(Error::DeadlinePassed);
        }
        set_status(&env, Status::Funded);
        token::Client::new(&env, &config.token).transfer(
            &config.depositor,
            &env.current_contract_address(),
            &config.amount,
        );
        Ok(())
    }

    /// Pay the beneficiary. `approver` must be the depositor or the arbiter
    /// and must authorize the call. Not allowed once the deadline has passed.
    pub fn release(env: Env, approver: Address) -> Result<(), Error> {
        let config = load_config(&env)?;
        if load_status(&env)? != Status::Funded {
            return Err(Error::InvalidState);
        }
        if approver != config.depositor && approver != config.arbiter {
            return Err(Error::Unauthorized);
        }
        approver.require_auth();
        if env.ledger().timestamp() >= config.deadline {
            return Err(Error::DeadlinePassed);
        }
        set_status(&env, Status::Released);
        token::Client::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &config.beneficiary,
            &config.amount,
        );
        Ok(())
    }

    /// Return funds to the depositor. `caller` must be the beneficiary or the
    /// arbiter and must authorize the call.
    pub fn refund(env: Env, caller: Address) -> Result<(), Error> {
        let config = load_config(&env)?;
        if load_status(&env)? != Status::Funded {
            return Err(Error::InvalidState);
        }
        if caller != config.beneficiary && caller != config.arbiter {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        set_status(&env, Status::Refunded);
        token::Client::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &config.depositor,
            &config.amount,
        );
        Ok(())
    }

    /// Time-locked reclaim: once the deadline has passed, the depositor can
    /// withdraw the funds without anyone else's approval.
    pub fn timeout(env: Env) -> Result<(), Error> {
        let config = load_config(&env)?;
        if load_status(&env)? != Status::Funded {
            return Err(Error::InvalidState);
        }
        config.depositor.require_auth();
        if env.ledger().timestamp() < config.deadline {
            return Err(Error::DeadlineNotReached);
        }
        set_status(&env, Status::Refunded);
        token::Client::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &config.depositor,
            &config.amount,
        );
        Ok(())
    }

    /// Current lifecycle status.
    pub fn status(env: Env) -> Result<Status, Error> {
        load_status(&env)
    }

    /// Escrow configuration.
    pub fn config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }
}

#[cfg(test)]
mod test;
