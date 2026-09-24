/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonList } from '../components/Skeleton';

describe('Skeleton', () => {
  it('renders a single placeholder block', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
  });

  it('applies the given width and height classes', () => {
    const { container } = render(<Skeleton width="w-20" height="h-8" />);
    expect(container.firstChild).toHaveClass('w-20', 'h-8');
  });

  it('is hidden from the accessibility tree (decorative)', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SkeletonList', () => {
  it('renders the given number of rows', () => {
    const { container } = render(<SkeletonList rows={3} />);
    // Each default row renders 5 Skeleton blocks (avatar + 2 lines + 2 lines).
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3 * 5);
  });

  it('defaults to 4 rows', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4 * 5);
  });

  it('announces the given label to screen readers', () => {
    render(<SkeletonList label="Loading balances" />);
    expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument();
    expect(screen.getByText('Loading balances...')).toBeInTheDocument();
  });

  it('uses a custom row renderer when given', () => {
    render(<SkeletonList rows={2} renderRow={(i) => <div data-testid={`row-${i}`} />} />);
    expect(screen.getByTestId('row-0')).toBeInTheDocument();
    expect(screen.getByTestId('row-1')).toBeInTheDocument();
  });
});
