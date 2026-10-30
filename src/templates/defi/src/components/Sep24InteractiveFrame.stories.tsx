import type { Meta, StoryObj } from '@storybook/react';
import Sep24InteractiveFrame from './Sep24InteractiveFrame';

const meta = {
  title: 'Components/Sep24InteractiveFrame',
  component: Sep24InteractiveFrame,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof Sep24InteractiveFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Anchor interactive page embedded, no close button. */
export const Default: Story = {
  args: {
    url: 'https://anchor.example.com/sep24/interactive?token=story-demo',
  },
};

/** With a close button, as used while a deposit/withdraw flow is open. */
export const WithCloseButton: Story = {
  args: {
    url: 'https://anchor.example.com/sep24/interactive?token=story-demo',
    onClose: () => {},
    closeLabel: 'Cancel',
  },
};

/**
 * An unsafe (non-https, non-localhost) URL is rejected by
 * `assertSafeInteractiveUrl` and the component renders nothing (null).
 */
export const UnsafeUrlRendersNothing: Story = {
  args: {
    url: 'javascript:alert(1)',
  },
};