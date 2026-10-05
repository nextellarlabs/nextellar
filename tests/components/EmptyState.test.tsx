/**
 * @jest-environment jsdom
 */
import { renderWithProviders } from "../helpers/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import EmptyState, {
  NoWalletIcon,
} from "../../src/templates/default/src/components/EmptyState";

describe("EmptyState", () => {
  it("renders the title with the default inbox icon", () => {
    renderWithProviders(<EmptyState title="No transactions yet" />);

    expect(screen.getByRole("status")).toHaveTextContent("No transactions yet");
    expect(screen.getByRole("status").querySelector("svg")).toBeInTheDocument();
  });

  it("renders custom description, icon, and action props", () => {
    renderWithProviders(
      <EmptyState
        icon={<NoWalletIcon />}
        title="Connect wallet"
        description="Your balances will appear here."
        action={<button>Connect Wallet</button>}
      />,
    );

    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
    expect(
      screen.getByText("Your balances will appear here."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
  });

  it("passes through an interactive custom action", () => {
    const onClick = jest.fn();
    renderWithProviders(
      <EmptyState
        title="Nothing here"
        action={<button onClick={onClick}>Create one</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create one" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
