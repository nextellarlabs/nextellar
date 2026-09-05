#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol};

/// Counter contract - demonstrates basic state management on Soroban
/// 
/// This example contract maintains a counter that can be incremented,
/// decremented, and queried. It demonstrates:
/// - Reading/writing contract state
/// - Type-safe contract methods
/// - Basic smart contract patterns
#[contract]
pub struct CounterContract;

#[contractimpl]
impl CounterContract {
    /// Initialize the counter to a starting value
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    /// * `initial_count` - The initial counter value
    pub fn initialize(env: Env, initial_count: i32) {
        let key = Symbol::new(&env, "count");
        env.storage().instance().set(&key, &initial_count);
    }

    /// Get the current counter value
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    /// 
    /// # Returns
    /// Current counter value, or 0 if not initialized
    pub fn get_count(env: Env) -> i32 {
        let key = Symbol::new(&env, "count");
        env.storage()
            .instance()
            .get::<Symbol, i32>(&key)
            .unwrap_or(0)
    }

    /// Increment the counter by 1
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    /// 
    /// # Returns
    /// The new counter value
    pub fn increment(env: Env) -> i32 {
        let key = Symbol::new(&env, "count");
        let current = env.storage()
            .instance()
            .get::<Symbol, i32>(&key)
            .unwrap_or(0);
        let new_value = current + 1;
        env.storage().instance().set(&key, &new_value);
        new_value
    }

    /// Decrement the counter by 1
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    /// 
    /// # Returns
    /// The new counter value
    pub fn decrement(env: Env) -> i32 {
        let key = Symbol::new(&env, "count");
        let current = env.storage()
            .instance()
            .get::<Symbol, i32>(&key)
            .unwrap_or(0);
        let new_value = current - 1;
        env.storage().instance().set(&key, &new_value);
        new_value
    }

    /// Increment the counter by a specified amount
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    /// * `amount` - The amount to add
    /// 
    /// # Returns
    /// The new counter value
    pub fn add(env: Env, amount: i32) -> i32 {
        let key = Symbol::new(&env, "count");
        let current = env.storage()
            .instance()
            .get::<Symbol, i32>(&key)
            .unwrap_or(0);
        let new_value = current + amount;
        env.storage().instance().set(&key, &new_value);
        new_value
    }

    /// Reset the counter to 0
    /// 
    /// # Arguments
    /// * `env` - The contract environment
    pub fn reset(env: Env) {
        let key = Symbol::new(&env, "count");
        env.storage().instance().set(&key, &0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_increment() {
        let env = Env::default();
        CounterContract::initialize(env.clone(), 0);
        let value = CounterContract::increment(env.clone());
        assert_eq!(value, 1);
    }

    #[test]
    fn test_decrement() {
        let env = Env::default();
        CounterContract::initialize(env.clone(), 5);
        let value = CounterContract::decrement(env.clone());
        assert_eq!(value, 4);
    }

    #[test]
    fn test_add() {
        let env = Env::default();
        CounterContract::initialize(env.clone(), 10);
        let value = CounterContract::add(env.clone(), 5);
        assert_eq!(value, 15);
    }

    #[test]
    fn test_get_count() {
        let env = Env::default();
        CounterContract::initialize(env.clone(), 42);
        let value = CounterContract::get_count(env);
        assert_eq!(value, 42);
    }

    #[test]
    fn test_reset() {
        let env = Env::default();
        CounterContract::initialize(env.clone(), 100);
        CounterContract::reset(env.clone());
        let value = CounterContract::get_count(env);
        assert_eq!(value, 0);
    }
}
