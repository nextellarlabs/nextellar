/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import EmptyState from '../components/EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No transactions yet" />);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });

  it('renders the description when given', () => {
    render(<EmptyState title="No data" description="Nothing to show here" />);
    expect(screen.getByText('Nothing to show here')).toBeInTheDocument();
  });

  it('omits the description when not given', () => {
    const { container } = render(<EmptyState title="No data" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders a default icon when none is given', () => {
    const { container } = render(<EmptyState title="No data" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a custom icon when given', () => {
    render(<EmptyState title="No data" icon={<span data-testid="custom-icon" />} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders an action when given', () => {
    render(<EmptyState title="No wallet" action={<button>Connect</button>} />);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('omits the action region when not given', () => {
    render(<EmptyState title="No data" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has a status role for screen readers', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
