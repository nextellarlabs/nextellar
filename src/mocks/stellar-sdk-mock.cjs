const mockGetEvents = jest.fn();
const mockServerConstructor = jest.fn();

const TOKENS = {
  scvBool: { name: "scvBool" },
  scvI32: { name: "scvI32" },
  scvI64: { name: "scvI64" },
  scvU32: { name: "scvU32" },
  scvU64: { name: "scvU64" },
  scvString: { name: "scvString" },
  scvBytes: { name: "scvBytes" },
  scvVec: { name: "scvVec" },
  scvMap: { name: "scvMap" },
  scvAddress: { name: "scvAddress" },
};

class ScVal {
  constructor(type, value) {
    this._type = type;
    this._value = value;
  }
  static scvString(value) {
    return new ScVal("scvString", String(value));
  }
  static scvI32(value) {
    return new ScVal("scvI32", Number(value));
  }
  static scvBool(value) {
    return new ScVal("scvBool", Boolean(value));
  }
  static scvVec(value) {
    return new ScVal("scvVec", value);
  }
  static scvMap(value) {
    return new ScVal("scvMap", value);
  }
  static scvAddress(value) {
    return new ScVal("scvAddress", value);
  }
  switch() {
    return TOKENS[this._type] || TOKENS.scvString;
  }
  b() {
    return Boolean(this._value);
  }
  i32() {
    return Number(this._value);
  }
  i64() {
    return { toString: () => String(this._value) };
  }
  u32() {
    return Number(this._value);
  }
  u64() {
    return { toString: () => String(this._value) };
  }
  str() {
    return { toString: () => String(this._value) };
  }
  bytes() {
    return this._value;
  }
  vec() {
    return this._value;
  }
  map() {
    return this._value;
  }
  address() {
    return { toString: () => String(this._value) };
  }
  toXDR() {
    if (this._type === "scvString") return "AAAAFgAAAAAAAAAAbw==";
    return "AAAAAQAAAAA=";
  }
  toString() {
    return String(this._value);
  }
}

class ScMapEntry {
  constructor({ key, val }) {
    this._key = key;
    this._val = val;
  }
  key() {
    return this._key;
  }
  val() {
    return this._val;
  }
}

const ScValType = {
  scvBool: () => TOKENS.scvBool,
  scvI32: () => TOKENS.scvI32,
  scvI64: () => TOKENS.scvI64,
  scvU32: () => TOKENS.scvU32,
  scvU64: () => TOKENS.scvU64,
  scvString: () => TOKENS.scvString,
  scvBytes: () => TOKENS.scvBytes,
  scvVec: () => TOKENS.scvVec,
  scvMap: () => TOKENS.scvMap,
  scvAddress: () => TOKENS.scvAddress,
};

class Address {
  constructor(address) {
    this._address = address;
  }
  static fromString(address) {
    return new Address(address);
  }
  toScVal() {
    return ScVal.scvAddress(this._address);
  }
  toString() {
    return this._address;
  }
}

class Contract {
  constructor(contractId) {
    if (!/^C[A-Z0-9]{20,}$/.test(contractId)) {
      throw new Error("invalid contract ID");
    }
    this.contractId = contractId;
  }
  call(name, ...args) {
    return { name, args, contractId: this.contractId };
  }
}

class Account {
  constructor(accountId, sequence) {
    this.accountId = accountId;
    this.sequence = sequence;
  }
}

class Transaction {
  constructor(operation) {
    this.operation = operation;
  }
  toXDR() {
    return "QUFBQUFRQUFBQUE9";
  }
  sign() {}
}

class TransactionBuilder {
  constructor(account, opts) {
    this.account = account;
    this.opts = opts;
    this.operation = null;
  }
  addOperation(operation) {
    this.operation = operation;
    return this;
  }
  setTimeout() {
    return this;
  }
  build() {
    return new Transaction(this.operation);
  }
  static fromXDR() {
    return new Transaction(null);
  }
}

class Keypair {
  static random() {
    return {
      publicKey: () => "GMOCKPUBLICKEY000000000000000000000000000000000000000000000",
    };
  }
  static fromSecret() {
    return new Keypair();
  }
}

class RpcServer {
  constructor(url) {
    this.url = url;
    mockServerConstructor(url);
  }
  async getEvents(request) {
    return mockGetEvents(request);
  }
  async simulateTransaction() {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "simulateTransaction",
        params: {},
      }),
    });
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.message || "RPC error");
    }
    return payload;
  }
  async sendTransaction() {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "sendTransaction",
        params: {},
      }),
    });
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.message || "RPC error");
    }
    return payload.result || payload;
  }
}

const rpc = {
  Server: RpcServer,
};

const xdr = {
  ScVal,
  ScValType,
  ScMapEntry,
};

const Networks = {
  TESTNET: "TESTNET",
  PUBLIC: "PUBLIC",
};

const exported = {
  mockGetEvents,
  mockServerConstructor,
  rpc,
  xdr,
  Address,
  Contract,
  Account,
  Keypair,
  TransactionBuilder,
  Networks,
};

module.exports = exported;
module.exports.default = exported;
