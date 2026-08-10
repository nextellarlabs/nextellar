import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.unstable_mockModule("@clack/prompts", () => ({
  __esModule: true,
  default: {
    intro: jest.fn(),
    text: jest.fn(),
    isCancel: jest.fn(),
    select: jest.fn(),
    multiselect: jest.fn(),
    confirm: jest.fn(),
    outro: jest.fn(),
  },
  intro: jest.fn(),
  text: jest.fn(),
  isCancel: jest.fn(),
  select: jest.fn(),
  multiselect: jest.fn(),
  confirm: jest.fn(),
  outro: jest.fn(),
}));

jest.unstable_mockModule("../src/lib/install.js", () => ({
  detectPackageManager: jest.fn(),
}));

const {
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} = await import("@clack/prompts");
const { detectPackageManager } = await import("../src/lib/install.js");
const { runInteractivePrompts } = await import("../src/lib/prompts.js");

type PromptContext = Parameters<typeof runInteractivePrompts>[0];

const mockedText = text as unknown as jest.Mock;
const mockedSelect = select as unknown as jest.Mock;
const mockedMultiselect = multiselect as unknown as jest.Mock;
const mockedConfirm = confirm as unknown as jest.Mock;
const mockedIsCancel = isCancel as unknown as jest.Mock;
const mockedIntro = intro as unknown as jest.Mock;
const mockedOutro = outro as unknown as jest.Mock;
const mockedDetectPackageManager = detectPackageManager as unknown as jest.Mock;

function buildContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    initialProjectName: "my-app",
    cwd: "/tmp",
    defaultWallets: ["freighter"],
    packageManagerFromFlag: undefined,
    networkFlagProvided: false,
    walletsFlagProvided: false,
    packageManagerFlagProvided: false,
    skipInstallFlagProvided: false,
    ...overrides,
  };
}

describe("runInteractivePrompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedText.mockResolvedValue("my-app");
    mockedSelect.mockImplementation((options: { message?: string }) => {
      if (options?.message === "Package manager") {
        return Promise.resolve("npm");
      }
      return Promise.resolve("testnet");
    });
    mockedMultiselect.mockResolvedValue(["freighter"]);
    mockedConfirm.mockResolvedValue(true);
    mockedIsCancel.mockReturnValue(false);
    mockedDetectPackageManager.mockReturnValue("npm");
  });

  it("skips the network prompt when the network flags are provided", async () => {
    const result = await runInteractivePrompts(
      buildContext({ networkFlagProvided: true })
    );

    const messages = mockedSelect.mock.calls.map(([options]) => options.message);
    expect(messages).toContain("Package manager");
    expect(messages).not.toContain("Which Stellar network?");
    expect(result).toEqual({
      projectName: "my-app",
      wallets: ["freighter"],
      packageManager: "npm",
      skipInstall: false,
    });
  });

  it("skips the wallet prompt when the wallets flag is provided", async () => {
    const result = await runInteractivePrompts(
      buildContext({ walletsFlagProvided: true })
    );

    expect(mockedMultiselect).not.toHaveBeenCalled();
    expect(result).toEqual({
      projectName: "my-app",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanUrl: "https://soroban-testnet.stellar.org",
      packageManager: "npm",
      skipInstall: false,
    });
  });

  it("skips the package manager prompt when the package manager flag is provided", async () => {
    const result = await runInteractivePrompts(
      buildContext({ packageManagerFlagProvided: true })
    );

    const messages = mockedSelect.mock.calls.map(([options]) => options.message);
    expect(messages).toContain("Which Stellar network?");
    expect(messages).not.toContain("Package manager");
    expect(result).toEqual({
      projectName: "my-app",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanUrl: "https://soroban-testnet.stellar.org",
      wallets: ["freighter"],
      skipInstall: false,
    });
  });

  it("skips the install prompt when the skip install flag is provided", async () => {
    const result = await runInteractivePrompts(
      buildContext({ skipInstallFlagProvided: true })
    );

    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(result).toEqual({
      projectName: "my-app",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanUrl: "https://soroban-testnet.stellar.org",
      wallets: ["freighter"],
      packageManager: "npm",
    });
  });

  it("returns null for cancellations so the CLI exits without scaffolding", async () => {
    mockedIsCancel.mockReturnValueOnce(true);

    const result = await runInteractivePrompts(buildContext());

    expect(result).toBeNull();
    expect(mockedOutro).toHaveBeenCalled();
    expect(mockedSelect).not.toHaveBeenCalled();
    expect(mockedMultiselect).not.toHaveBeenCalled();
    expect(mockedConfirm).not.toHaveBeenCalled();
  });
});
