import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getQuiz, isPostgres, listQuizzes, saveQuizToDatabase } from './db.js';
import {
  addTimeToCurrentQuestion,
  advanceQuestion,
  clearRoomTimer,
  closeCurrentQuestion,
  createRoom,
  getHostState,
  getPlayerState,
  getRoom,
  joinOrRejoinPlayer,
  recordAnswer,
  rejoinPlayerByToken,
  setRoomTimer,
  verifyHost,
} from './quizStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../client/dist');
const PORT = process.env.PORT || 3000;

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, db: isPostgres ? 'neon-postgres' : 'sqlite' });
});

app.get('/api/quizzes', async (_req, res) => {
  try {
    const quizzes = await listQuizzes();
    res.json({ ok: true, quizzes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/quizzes/:id', async (req, res) => {
  try {
    const quiz = await getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ ok: false, error: 'Quiz not found' });
    res.json({ ok: true, quiz });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/quizzes', async (req, res) => {
  try {
    const saved = await saveQuizToDatabase(req.body);
    console.log(`[CUSTOM QUIZ UPLOADED] "${saved.title}" with ${saved.questions.length} questions saved to ${isPostgres ? 'Neon' : 'SQLite'}.`);
    res.json({ ok: true, quiz: saved });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

async function broadcastRoomState(roomCode) {
  const room = await getRoom(roomCode);
  if (!room) return;

  const hostState = await getHostState(room);
  io.to(`host:${room.code}`).emit('host:state', hostState);

  // Send personalized state to each connected player in parallel
  const playerSockets = io.sockets.adapter.rooms;
  const playerPromises = [];
  for (const [roomName] of playerSockets) {
    if (roomName.startsWith('player:')) {
      const playerId = roomName.slice(7);
      playerPromises.push(
        getPlayerState(room, { id: playerId }).then((playerState) => {
          io.to(roomName).emit('player:state', playerState);
        }).catch((err) => console.error('[BROADCAST ERROR]', err))
      );
    }
  }
  if (playerPromises.length > 0) {
    await Promise.all(playerPromises);
  }
}

async function startQuestionFlow(room) {
  const { done, endsAt, timeLimit } = await advanceQuestion(room);
  if (!done) {
    const timer = setTimeout(async () => {
      const reveal = await closeCurrentQuestion(room);
      if (reveal) {
        await broadcastRoomState(room.code);
      }
    }, (timeLimit || 20) * 1000);
    setRoomTimer(room.code, timer);
  }
  await broadcastRoomState(room.code);
}

io.on('connection', (socket) => {
  socket.on('quiz:list', async (ack) => {
    const quizzes = await listQuizzes();
    ack?.({ ok: true, quizzes });
  });

  socket.on('quiz:get', async ({ id }, ack) => {
    const quiz = await getQuiz(id);
    if (!quiz) return ack?.({ ok: false, error: 'Quiz not found' });
    ack?.({ ok: true, quiz });
  });

  socket.on('quiz:save', async (quizData, ack) => {
    try {
      const saved = await saveQuizToDatabase(quizData);
      console.log(`[QUIZ SAVED VIA EDITOR] "${saved.title}" (${saved.questions.length} questions)`);
      ack?.({ ok: true, quiz: saved });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('quiz:upload', async (quizData, ack) => {
    try {
      const saved = await saveQuizToDatabase(quizData);
      console.log(`[CUSTOM QUIZ LOADED] "${saved.title}" (${saved.questions.length} questions)`);
      ack?.({ ok: true, quiz: saved });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('host:create', async ({ quizId } = {}, ack) => {
    try {
      const room = await createRoom(quizId);
      socket.join(`host:${room.code}`);
      const state = await getHostState(room);
      ack?.({
        ok: true,
        hostToken: room.host_token,
        state,
      });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('host:rejoin', async ({ roomCode, hostToken } = {}, ack) => {
    const room = await verifyHost(roomCode, hostToken);
    if (!room) {
      return ack?.({ ok: false, error: 'Host session expired or invalid.' });
    }
    socket.join(`host:${room.code}`);
    console.log(`[HOST RECONNECTED] Host restored session for Room ${room.code}`);
    const state = await getHostState(room);
    ack?.({ ok: true, state });
  });

  socket.on('host:next', async ({ roomCode, hostToken } = {}, ack) => {
    const room = await verifyHost(roomCode, hostToken);
    if (!room) {
      return ack?.({ ok: false, error: 'Unauthorized host.' });
    }
    const hostState = await getHostState(room);
    if (room.phase === 'LOBBY' && hostState.playerCount === 0) {
      return ack?.({ ok: false, error: 'Wait for at least 1 player to join.' });
    }
    if (room.phase === 'QUESTION' || room.phase === 'FINAL') {
      return ack?.({ ok: false, error: 'Cannot advance right now.' });
    }
    await startQuestionFlow(room);
    ack?.({ ok: true });
  });

  socket.on('host:close_question', async ({ roomCode, hostToken } = {}, ack) => {
    const room = await verifyHost(roomCode, hostToken);
    if (!room || room.phase !== 'QUESTION') {
      return ack?.({ ok: false, error: 'Cannot close question.' });
    }
    clearRoomTimer(room.code);
    await closeCurrentQuestion(room, true);
    await broadcastRoomState(room.code);
    ack?.({ ok: true });
  });

  socket.on('host:add_time', async ({ roomCode, hostToken, seconds = 15 } = {}, ack) => {
    const room = await verifyHost(roomCode, hostToken);
    if (!room || room.phase !== 'QUESTION') {
      return ack?.({ ok: false, error: 'Cannot add time right now.' });
    }
    const result = await addTimeToCurrentQuestion(room, seconds);
    if (!result) return ack?.({ ok: false, error: 'Could not add time.' });

    clearRoomTimer(room.code);
    const timer = setTimeout(async () => {
      const reveal = await closeCurrentQuestion(room);
      if (reveal) {
        await broadcastRoomState(room.code);
      }
    }, result.remainingMs);
    setRoomTimer(room.code, timer);

    await broadcastRoomState(room.code);
    ack?.({ ok: true, endsAt: result.newEndsAt });
  });

  socket.on('player:join', async ({ roomCode, name, playerToken } = {}, ack) => {
    const result = await joinOrRejoinPlayer(roomCode, name, playerToken);
    if (result.error) {
      return ack?.({ ok: false, error: result.error });
    }
    const { room, player } = result;
    socket.join(`player:${player.id}`);
    const hostState = await getHostState(room);
    io.to(`host:${room.code}`).emit('host:state', hostState);
    const playerState = await getPlayerState(room, player);
    ack?.({
      ok: true,
      playerToken: player.token,
      state: playerState,
    });
  });

  socket.on('player:rejoin', async ({ roomCode, playerToken } = {}, ack) => {
    const result = await rejoinPlayerByToken(roomCode, playerToken);
    if (!result) {
      return ack?.({ ok: false, error: 'Session not found. Please join room again.' });
    }
    const { room, player } = result;
    socket.join(`player:${player.id}`);
    const playerState = await getPlayerState(room, player);
    ack?.({ ok: true, state: playerState });
  });

  socket.on('player:answer', async ({ roomCode, playerToken, optionIndex } = {}, ack) => {
    const room = await getRoom(roomCode);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });

    const result = await recordAnswer(room, playerToken, optionIndex);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const player = (await rejoinPlayerByToken(roomCode, playerToken))?.player;
    const playerState = await getPlayerState(room, player);
    ack?.({ ok: true, state: playerState });

    // Update host display in real time with answers count
    const hostState = await getHostState(room);
    io.to(`host:${room.code}`).emit('host:state', hostState);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Live Classroom Quiz Server`);
  console.log(`  Local URL : http://localhost:${PORT}`);
  console.log(`  Database  : ${isPostgres ? 'Neon Cloud PostgreSQL (Active)' : 'Local SQLite'}`);
  console.log(`  Default   : Simple Maths Quiz – Basic Arithmetic (10 Questions)`);
  console.log(`======================================================\n`);
});
