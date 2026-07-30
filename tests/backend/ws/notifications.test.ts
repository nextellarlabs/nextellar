import { EventEmitter } from 'node:events';
import {
  handleConnection,
  getActiveListenerCount,
  NotificationSocket,
} from '../../../backend/ws/notifications.js';

function createMockSocket(): NotificationSocket {
  const socket = new EventEmitter() as NotificationSocket;
  socket.send = jest.fn();
  return socket;
}

describe('handleConnection — listener management', () => {
  it('attaches exactly one handler per event on connection', () => {
    const socket = createMockSocket();
    handleConnection(socket);

    expect(socket.listenerCount('message')).toBe(1);
    expect(socket.listenerCount('error')).toBe(1);
    expect(socket.listenerCount('close')).toBe(1);
    expect(getActiveListenerCount(socket)).toBe(3);
  });

  it('removes all listeners when the socket closes', () => {
    const socket = createMockSocket();
    handleConnection(socket);
    socket.emit('close');

    expect(socket.listenerCount('message')).toBe(0);
    expect(socket.listenerCount('error')).toBe(0);
    expect(socket.listenerCount('close')).toBe(0);
    expect(getActiveListenerCount(socket)).toBe(0);
  });

  it('stress test: opens 100 connections then closes all — listener count returns to 0', () => {
    const sockets: NotificationSocket[] = [];

    for (let i = 0; i < 100; i++) {
      const s = createMockSocket();
      sockets.push(s);
      handleConnection(s);
    }

    // All connected: each socket must have exactly 3 listeners
    for (const s of sockets) {
      expect(getActiveListenerCount(s)).toBe(3);
    }

    // Close every socket
    for (const s of sockets) {
      s.emit('close');
    }

    // No dangling listeners
    for (const s of sockets) {
      expect(getActiveListenerCount(s)).toBe(0);
    }
  });

  it('handles error events without crashing the process', () => {
    const socket = createMockSocket();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    handleConnection(socket);

    expect(() => socket.emit('error', new Error('network reset'))).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[ws:notifications] socket error:',
      'network reset',
    );

    consoleSpy.mockRestore();
  });

  it('handles valid JSON messages without throwing', () => {
    const socket = createMockSocket();
    handleConnection(socket);

    expect(() =>
      socket.emit('message', Buffer.from(JSON.stringify({ event: 'ping' }))),
    ).not.toThrow();
  });

  it('silently ignores malformed (non-JSON) messages', () => {
    const socket = createMockSocket();
    handleConnection(socket);

    expect(() => socket.emit('message', 'not-valid-json')).not.toThrow();
  });

  it('calling close twice does not throw', () => {
    const socket = createMockSocket();
    handleConnection(socket);
    socket.emit('close');

    expect(() => socket.emit('close')).not.toThrow();
  });
});
