/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/templates/js-template/src/components/ErrorBoundary.jsx';

function Boom() {
  throw new Error('boom');
}

describe('ErrorBoundary template component', () => {
  it('renders a fallback when a child throws during render', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(React.createElement(ErrorBoundary, null, React.createElement(Boom)));

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});