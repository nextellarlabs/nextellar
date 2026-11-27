/**
 * @jest-environment jsdom
 *
 * NetworkStatusIndicator (#1502): shows degraded / offline state and stays
 * out of the way otherwise.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const { default: NetworkStatusIndicator } =
  await import("../../src/templates/default/src/components/NetworkStatusIndicator");
const { NetworkStatusContext, deriveNetworkStatus } =
  await import("../../src/templates/default/src/contexts/NetworkStatusContext");

type Service = "checking" | "up" | "down";

function renderWith(horizon: Service, rpc: Service) {
  const value = {
    status: deriveNetworkStatus(horizon, rpc),
    horizon,
    rpc,
    lastCheckedAt: horizon === "checking" ? null : 1,
  };
  return render(
    <NetworkStatusContext.Provider value={value}>
      <NetworkStatusIndicator />
    </NetworkStatusContext.Provider>,
  );
}

describe("NetworkStatusIndicator (#1502)", () => {
  it("renders nothing outside a NetworkStatusProvider", () => {
    render(<NetworkStatusIndicator />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing during the first health check", () => {
    renderWith("checking", "checking");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when Horizon and RPC are both healthy", () => {
    renderWith("up", "up");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a degraded warning naming Horizon when only Horizon is down", () => {
    renderWith("down", "up");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-network-status", "degraded");
    expect(alert).toHaveTextContent(/degraded/i);
    expect(alert).toHaveTextContent("Horizon");
    expect(alert).not.toHaveTextContent("Soroban RPC");
  });

  it("shows a degraded warning naming Soroban RPC when only RPC is down", () => {
    renderWith("up", "down");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-network-status", "degraded");
    expect(alert).toHaveTextContent("Soroban RPC");
    expect(alert).not.toHaveTextContent("Horizon");
  });

  it("shows an offline message when both are down", () => {
    renderWith("down", "down");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-network-status", "offline");
    expect(alert).toHaveTextContent(/unreachable/i);
    expect(alert).toHaveTextContent(/paused/i);
  });

  it("appears and disappears as the status changes", () => {
    const makeValue = (horizon: Service, rpc: Service) => ({
      status: deriveNetworkStatus(horizon, rpc),
      horizon,
      rpc,
      lastCheckedAt: 1,
    });
    const Wrapper = ({
      v,
      children,
    }: {
      v: ReturnType<typeof makeValue>;
      children: ReactNode;
    }) => (
      <NetworkStatusContext.Provider value={v}>
        {children}
      </NetworkStatusContext.Provider>
    );
    const { rerender } = render(
      <Wrapper v={makeValue("up", "up")}>
        <NetworkStatusIndicator />
      </Wrapper>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <Wrapper v={makeValue("down", "down")}>
        <NetworkStatusIndicator />
      </Wrapper>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <Wrapper v={makeValue("up", "up")}>
        <NetworkStatusIndicator />
      </Wrapper>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
