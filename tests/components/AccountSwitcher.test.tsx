/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { jest, describe, expect, it } from "@jest/globals";
import { renderWithProviders } from "../helpers/render";
import AccountSwitcher from "../../src/templates/default/src/components/AccountSwitcher";
import { ACCOUNT_MAIN, ACCOUNT_SECOND } from "../helpers/fixtures";

describe("AccountSwitcher", () => {
  it("renders the current account when connected", () => {
    renderWithProviders(<AccountSwitcher />, {
      wallet: {
        connected: true,
        publicKey: ACCOUNT_MAIN.address,
        accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
        currentAccountIndex: 0,
      },
    });

    expect(screen.getByRole("button")).toHaveTextContent(
      ACCOUNT_MAIN.displayName!,
    );
  });

  it("opens a menu containing every account", () => {
    renderWithProviders(<AccountSwitcher />, {
      wallet: {
        connected: true,
        publicKey: ACCOUNT_MAIN.address,
        accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
        currentAccountIndex: 0,
      },
    });

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByText(ACCOUNT_MAIN.displayName!)).toHaveLength(2);
    expect(screen.getByText(ACCOUNT_SECOND.displayName!)).toBeInTheDocument();
  });

  it("switches to the selected account and closes the menu", async () => {
    const switchAccount = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(<AccountSwitcher />, {
      wallet: {
        connected: true,
        publicKey: ACCOUNT_MAIN.address,
        accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
        currentAccountIndex: 0,
        switchAccount,
      },
    });

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Second Account/ }));

    await waitFor(() => {
      expect(switchAccount).toHaveBeenCalledWith(ACCOUNT_SECOND.address);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
