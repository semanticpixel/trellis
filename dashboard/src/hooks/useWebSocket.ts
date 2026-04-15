import { useEffect, useRef, useCallback } from 'react';
import type { WSMessage, WSEventType } from '@shared/types';

type Listener = (message: WSMessage) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const listeners = new Set<Listener>();

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connect(): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    reconnectDelay = 1000;
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WSMessage;
      for (const listener of listeners) {
        listener(msg);
      }
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    connect();
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Send a message through the shared WebSocket connection.
 * Ensures the connection is open before sending.
 */
export function sendWs(message: Record<string, unknown>): void {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    connect();
  }
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Subscribe to all WebSocket events. The hook handles connect/reconnect
 * with exponential backoff. All subscribers share a single connection.
 */
export function useWebSocket(onMessage: (msg: WSMessage) => void): void {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    const listener: Listener = (msg) => callbackRef.current(msg);
    return subscribe(listener);
  }, []);
}

/**
 * Subscribe to WebSocket events filtered by threadId.
 */
export function useThreadEvents(
  threadId: string | null,
  onEvent: (type: WSEventType, data: unknown) => void,
): void {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!threadId) return;
    const listener: Listener = (msg) => {
      if (msg.threadId === threadId) {
        callbackRef.current(msg.type, msg.data);
      }
    };
    return subscribe(listener);
  }, [threadId]);
}
