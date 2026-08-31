/**
 * @jest-environment jsdom
 */
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import LoadingBoundary from '../components/LoadingBoundary';

// A component that suspends until `resolve()` is called, to exercise the
// Suspense fallback path deterministically.
function createSuspendingComponent() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  let resolved = false;
  promise.then(() => {
    resolved = true;
  });

  function SuspendingChild() {
    if (!resolved) throw promise;
    return <div data-testid="loaded-content">Loaded</div>;
  }

  return { SuspendingChild, resolve };
}

describe('LoadingBoundary', () => {
  it('renders children immediately when they do not suspend', () => {
    render(
      <LoadingBoundary>
        <div data-testid="content">Ready</div>
      </LoadingBoundary>
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('shows the default skeleton fallback while children are suspended', () => {
    const { SuspendingChild } = createSuspendingComponent();

    render(
      <LoadingBoundary label="Loading balances">
        <SuspendingChild />
      </LoadingBoundary>
    );

    expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument();
  });

  it('renders children once they resolve', async () => {
    const { SuspendingChild, resolve } = createSuspendingComponent();

    render(
      <LoadingBoundary>
        <SuspendingChild />
      </LoadingBoundary>
    );

    resolve();

    await waitFor(() => {
      expect(screen.getByTestId('loaded-content')).toBeInTheDocument();
    });
  });

  it('uses a custom fallback when given', () => {
    const { SuspendingChild } = createSuspendingComponent();

    render(
      <LoadingBoundary fallback={<div data-testid="custom-fallback" />}>
        <SuspendingChild />
      </LoadingBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
  });

  it('respects a custom row count in the default fallback', () => {
    const { SuspendingChild } = createSuspendingComponent();

    const { container } = render(
      <LoadingBoundary rows={2}>
        <SuspendingChild />
      </LoadingBoundary>
    );

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2 * 5);
  });
});

// Sanity check that our suspending-component test helper actually behaves
// like a real Suspense boundary consumer (guards against a broken helper
// silently passing every test above).
it('sanity: Suspense itself shows the fallback for a thrown promise', () => {
  const { SuspendingChild } = createSuspendingComponent();
  render(
    <Suspense fallback={<div data-testid="raw-fallback" />}>
      <SuspendingChild />
    </Suspense>
  );
  expect(screen.getByTestId('raw-fallback')).toBeInTheDocument();
});
