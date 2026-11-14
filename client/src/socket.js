import { io } from 'socket.io-client';

// When deployed on Vercel with backend on Render, SERVER_URL points to the Render backend.
// In local dev, Vite proxies /socket.io to http://localhost:3000 when SERVER_URL is unset.
const SERVER_URL = import.meta.env.SERVER_URL || '';

export const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 8000,
  transports: ['websocket', 'polling'],
});
