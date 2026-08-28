import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider } from '../contexts/ThemeProvider';
import ThemeToggle from './ThemeToggle';

const meta = {
  title: 'Components/ThemeToggle',
  component: ThemeToggle,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Live theme toggle backed by a real ThemeProvider — click Light/Dark/System
 * to see the selection change (persists to localStorage like the real app).
 */
export const Interactive: Story = {};
