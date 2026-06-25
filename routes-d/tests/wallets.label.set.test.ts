import { setWalletLabel, WalletLabelError, LABEL_MAX_LENGTH } from "../routes/wallets.label.set.js";

describe("POST /wallets/label — setWalletLabel", () => {
  const validReq = {
    walletId: "wallet-abc",
    ownerId: "owner-xyz",
    label: "My Savings",
  };

  it("returns updated wallet with label and timestamp on success", async () => {
    const result = await setWalletLabel(validReq);

    expect(result.walletId).toBe(validReq.walletId);
    expect(result.label).toBe(validReq.label);
    expect(typeof result.updatedAt).toBe("string");
    expect(new Date(result.updatedAt).getTime()).not.toBeNaN();
  });

  it("rejects label longer than the max allowed length", async () => {
    const oversizedLabel = "a".repeat(LABEL_MAX_LENGTH + 1);

    await expect(
      setWalletLabel({ ...validReq, label: oversizedLabel }),
    ).rejects.toMatchObject({
      code: "LABEL_TOO_LONG",
    });
  });

  it("rejects when walletId is missing (simulates unauthorized / bad id)", async () => {
    await expect(
      setWalletLabel({ ...validReq, walletId: "" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects when ownerId is missing", async () => {
    await expect(
      setWalletLabel({ ...validReq, ownerId: "" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects when label is blank", async () => {
    await expect(
      setWalletLabel({ ...validReq, label: "   " }),
    ).rejects.toBeInstanceOf(WalletLabelError);
  });

  it("accepts a label exactly at the max allowed length", async () => {
    const boundaryLabel = "b".repeat(LABEL_MAX_LENGTH);
    const result = await setWalletLabel({ ...validReq, label: boundaryLabel });
    expect(result.label).toBe(boundaryLabel);
  });
});
