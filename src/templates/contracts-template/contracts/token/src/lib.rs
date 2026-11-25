#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, String,
};

/// Storage keys for the token contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    TotalSupply,
    Balance(Address),
    Allowance(AllowanceKey),
}

/// Composite key for an allowance: `from` has approved `spender`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

/// An allowance plus the ledger at which it stops being valid.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

/// Errors returned by the token contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NegativeAmount = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
}

/// SEP-41 fungible token.
///
/// Implements the SEP-41 token interface (`allowance`, `approve`, `balance`,
/// `transfer`, `transfer_from`, `burn`, `burn_from`, `decimals`, `name`,
/// `symbol`, `total_supply`) and adds an admin-controlled `mint`.
#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    /// Initialize the token metadata and set the admin allowed to mint.
    ///
    /// Can only be called once.
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, TokenError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
    }

    /// Return the admin address allowed to mint.
    pub fn admin(env: Env) -> Address {
        Self::read_admin(&env)
    }

    /// Mint `amount` new tokens to `to`. Requires the admin's authorization.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        if amount < 0 {
            panic_with_error!(&env, TokenError::NegativeAmount);
        }

        let total_supply = Self::read_total_supply(&env);
        Self::write_total_supply(&env, total_supply + amount);
        Self::write_balance(&env, &to, Self::read_balance(&env, &to) + amount);
    }

    /// Return the number of decimals used to represent amounts.
    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or_else(|| panic_with_error!(&env, TokenError::NotInitialized))
    }

    /// Return the token name.
    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| panic_with_error!(&env, TokenError::NotInitialized))
    }

    /// Return the token symbol.
    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| panic_with_error!(&env, TokenError::NotInitialized))
    }

    /// Return the total number of tokens in existence.
    pub fn total_supply(env: Env) -> i128 {
        Self::read_total_supply(&env)
    }

    /// Return the token balance held by `id`.
    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    /// Return the amount `spender` may still transfer on behalf of `from`.
    ///
    /// An expired allowance reports a balance of `0`.
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, &from, &spender).amount
    }

    /// Approve `spender` to transfer up to `amount` of `from`'s tokens,
    /// valid until `expiration_ledger`. Requires `from`'s authorization.
    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();

        if amount < 0 {
            panic_with_error!(&env, TokenError::NegativeAmount);
        }

        let key = AllowanceKey {
            from: from.clone(),
            spender,
        };
        env.storage().persistent().set(
            &DataKey::Allowance(key),
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
    }

    /// Transfer `amount` from `from` to `to`. Requires `from`'s authorization.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, &from, &to, amount);
    }

    /// Transfer `amount` from `from` to `to` using the caller's allowance.
    /// Requires `spender`'s authorization and consumes allowance.
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::do_transfer(&env, &from, &to, amount);
    }

    /// Burn `amount` of `from`'s tokens. Requires `from`'s authorization.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::do_burn(&env, &from, amount);
    }

    /// Burn `amount` of `from`'s tokens using the caller's allowance.
    /// Requires `spender`'s authorization and consumes allowance.
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::do_burn(&env, &from, amount);
    }

    // --- Internal helpers -------------------------------------------------

    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, TokenError::NotInitialized))
    }

    fn read_total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    fn write_total_supply(env: &Env, amount: i128) {
        env.storage().instance().set(&DataKey::TotalSupply, &amount);
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &amount);
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        let key = AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        };
        let allowance = env
            .storage()
            .persistent()
            .get::<DataKey, AllowanceValue>(&DataKey::Allowance(key));
        match allowance {
            Some(value) if env.ledger().sequence() < value.expiration_ledger => value,
            _ => AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            },
        }
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        if amount < 0 {
            panic_with_error!(env, TokenError::NegativeAmount);
        }

        let allowance = Self::read_allowance(env, from, spender);
        if allowance.amount < amount {
            panic_with_error!(env, TokenError::InsufficientAllowance);
        }

        let key = AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        };
        env.storage().persistent().set(
            &DataKey::Allowance(key),
            &AllowanceValue {
                amount: allowance.amount - amount,
                expiration_ledger: allowance.expiration_ledger,
            },
        );
    }

    fn do_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount < 0 {
            panic_with_error!(env, TokenError::NegativeAmount);
        }

        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic_with_error!(env, TokenError::InsufficientBalance);
        }

        Self::write_balance(env, from, from_balance - amount);
        Self::write_balance(env, to, Self::read_balance(env, to) + amount);
    }

    fn do_burn(env: &Env, from: &Address, amount: i128) {
        if amount < 0 {
            panic_with_error!(env, TokenError::NegativeAmount);
        }

        let balance = Self::read_balance(env, from);
        if balance < amount {
            panic_with_error!(env, TokenError::InsufficientBalance);
        }

        Self::write_balance(env, from, balance - amount);
        Self::write_total_supply(env, Self::read_total_supply(env) - amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn setup(env: &Env) -> (TokenContractClient<'_>, Address, Address) {
        env.mock_all_auths();

        let contract_id = env.register(TokenContract, ());
        let client = TokenContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let user = Address::generate(env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(env, "Nextellar Token"),
            &String::from_str(env, "NXTL"),
        );
        client.mint(&user, &1_000);

        (client, admin, user)
    }

    #[test]
    fn test_metadata() {
        let env = Env::default();
        let (client, admin, _user) = setup(&env);

        assert_eq!(client.admin(), admin);
        assert_eq!(client.decimals(), 7);
        assert_eq!(client.name(), String::from_str(&env, "Nextellar Token"));
        assert_eq!(client.symbol(), String::from_str(&env, "NXTL"));
        assert_eq!(client.total_supply(), 1_000);
    }

    #[test]
    fn test_initialize_twice_panics() {
        let env = Env::default();
        let (client, admin, _user) = setup(&env);

        let result = client.try_initialize(
            &admin,
            &7,
            &String::from_str(&env, "Again"),
            &String::from_str(&env, "AGN"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_mint() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let recipient = Address::generate(&env);

        client.mint(&recipient, &500);

        assert_eq!(client.balance(&recipient), 500);
        assert_eq!(client.total_supply(), 1_500);
        assert_eq!(client.balance(&user), 1_000);
    }

    #[test]
    fn test_mint_requires_admin_auth() {
        let env = Env::default();
        let contract_id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Nextellar Token"),
            &String::from_str(&env, "NXTL"),
        );

        // Drop the mocked authorizations so require_auth has to succeed for real.
        env.set_auths(&[]);
        let result = client.try_mint(&recipient, &100);

        assert!(result.is_err());
        assert_eq!(client.balance(&recipient), 0);
    }

    #[test]
    fn test_transfer() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let recipient = Address::generate(&env);

        client.transfer(&user, &recipient, &250);

        assert_eq!(client.balance(&user), 750);
        assert_eq!(client.balance(&recipient), 250);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let recipient = Address::generate(&env);

        let result = client.try_transfer(&user, &recipient, &1_001);

        assert!(result.is_err());
        assert_eq!(client.balance(&user), 1_000);
        assert_eq!(client.balance(&recipient), 0);
    }

    #[test]
    fn test_transfer_requires_auth() {
        let env = Env::default();
        let contract_id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Nextellar Token"),
            &String::from_str(&env, "NXTL"),
        );
        client.mint(&user, &1_000);

        env.set_auths(&[]);
        let result = client.try_transfer(&user, &recipient, &100);

        assert!(result.is_err());
        assert_eq!(client.balance(&user), 1_000);
    }

    #[test]
    fn test_approve_and_allowance() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let spender = Address::generate(&env);

        client.approve(&user, &spender, &400, &(env.ledger().sequence() + 100));

        assert_eq!(client.allowance(&user, &spender), 400);
    }

    #[test]
    fn test_allowance_expires() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let spender = Address::generate(&env);

        client.approve(&user, &spender, &400, &(env.ledger().sequence() + 10));
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 11);

        assert_eq!(client.allowance(&user, &spender), 0);
    }

    #[test]
    fn test_transfer_from_consumes_allowance() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.approve(&user, &spender, &400, &(env.ledger().sequence() + 100));
        client.transfer_from(&spender, &user, &recipient, &150);

        assert_eq!(client.balance(&user), 850);
        assert_eq!(client.balance(&recipient), 150);
        assert_eq!(client.allowance(&user, &spender), 250);
    }

    #[test]
    fn test_transfer_from_over_allowance() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.approve(&user, &spender, &100, &(env.ledger().sequence() + 100));
        let result = client.try_transfer_from(&spender, &user, &recipient, &150);

        assert!(result.is_err());
        assert_eq!(client.balance(&user), 1_000);
        assert_eq!(client.allowance(&user, &spender), 100);
    }

    #[test]
    fn test_transfer_from_requires_auth() {
        let env = Env::default();
        let contract_id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Nextellar Token"),
            &String::from_str(&env, "NXTL"),
        );
        client.mint(&user, &1_000);
        client.approve(&user, &spender, &400, &(env.ledger().sequence() + 100));

        env.set_auths(&[]);
        let result = client.try_transfer_from(&spender, &user, &recipient, &100);

        assert!(result.is_err());
        assert_eq!(client.balance(&user), 1_000);
    }

    #[test]
    fn test_burn() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);

        client.burn(&user, &250);

        assert_eq!(client.balance(&user), 750);
        assert_eq!(client.total_supply(), 750);
    }

    #[test]
    fn test_burn_requires_auth() {
        let env = Env::default();
        let contract_id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Nextellar Token"),
            &String::from_str(&env, "NXTL"),
        );
        client.mint(&user, &1_000);

        env.set_auths(&[]);
        let result = client.try_burn(&user, &100);

        assert!(result.is_err());
        assert_eq!(client.balance(&user), 1_000);
    }

    #[test]
    fn test_burn_from_consumes_allowance() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let spender = Address::generate(&env);

        client.approve(&user, &spender, &300, &(env.ledger().sequence() + 100));
        client.burn_from(&spender, &user, &200);

        assert_eq!(client.balance(&user), 800);
        assert_eq!(client.total_supply(), 800);
        assert_eq!(client.allowance(&user, &spender), 100);
    }

    #[test]
    fn test_negative_amount_rejected() {
        let env = Env::default();
        let (client, _admin, user) = setup(&env);
        let recipient = Address::generate(&env);

        assert!(client.try_transfer(&user, &recipient, &-1).is_err());
        assert!(client.try_burn(&user, &-1).is_err());
        assert!(client
            .try_approve(&user, &recipient, &-1, &(env.ledger().sequence() + 100))
            .is_err());
    }
}
