import { EventEmitter } from 'node:events';

export interface NotificationSocket extends EventEmitter {
  send(data: string): void;
}

type MessageHandler = (data: Buffer | string) => void;
type ErrorHandler = (err: Error) => void;
type CloseHandler = () => void;

interface ConnectionHandlers {
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onClose: CloseHandler;
}

// WeakMap so the socket itself is the only strong reference — no retention after GC
const handlerRegistry = new WeakMap<NotificationSocket, ConnectionHandlers>();

export function handleConnection(socket: NotificationSocket): void {
  const onMessage: MessageHandler = (data) => {
    const raw = data instanceof Buffer ? data.toString('utf8') : data;
    try {
      JSON.parse(raw); // validate JSON; extend with business logic as needed
    } catch {
      // silently drop malformed frames
    }
  };

  const onError: ErrorHandler = (err) => {
    console.error('[ws:notifications] socket error:', err.message);
  };

  const onClose: CloseHandler = () => {
    socket.off('message', onMessage);
    socket.off('error', onError);
    socket.off('close', onClose);
    handlerRegistry.delete(socket);
  };

  handlerRegistry.set(socket, { onMessage, onError, onClose });

  socket.on('message', onMessage);
  socket.on('error', onError);
  socket.on('close', onClose);
}

export function getActiveListenerCount(socket: NotificationSocket): number {
  return (
    socket.listenerCount('message') +
    socket.listenerCount('error') +
    socket.listenerCount('close')
  );
}
