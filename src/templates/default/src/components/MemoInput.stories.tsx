import type { Meta, StoryObj } from '@storybook/react';
import MemoInput from './MemoInput';

const meta = {
  title: 'Components/MemoInput',
  component: MemoInput,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof MemoInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    memoType: 'text',
    memoValue: 'Hello Stellar',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};

export const None: Story = {
  args: {
    memoType: 'none',
    memoValue: '',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};

export const IdMemo: Story = {
  args: {
    memoType: 'id',
    memoValue: '123456789',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};

export const HashMemo: Story = {
  args: {
    memoType: 'hash',
    memoValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};

export const Locked: Story = {
  args: {
    memoType: 'id',
    memoValue: '987654321',
    readOnly: true,
    lockedReason: 'Memo required by federation server (locked).',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};

export const WithError: Story = {
  args: {
    memoType: 'text',
    memoValue: 'This text memo is definitely way too long for twenty-eight bytes',
    error: 'Text memo is 64 bytes; the maximum is 28.',
    onMemoTypeChange: () => {},
    onMemoValueChange: () => {},
  },
};
