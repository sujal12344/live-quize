import { getQuiz, listQuizzes, saveQuizToDatabase } from './db.js';
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

export async function broadcastRoomState(io, roomCode) {
  const room = await getRoom(roomCode);
  if (!room) return;

  const hostState = await getHostState(room);
  io.to(`host:${room.code}`).emit('host:state', hostState);

  // Send personalized state to each connected player in parallel (Rule 2 & 6)
  const playerSockets = io.sockets.adapter.rooms;
  const playerPromises = [];
  for (const [roomName] of playerSockets) {
    if (roomName.startsWith('player:')) {
      const playerId = roomName.slice(7);
      playerPromises.push(
        getPlayerState(room, { id: playerId })
          .then((playerState) => io.to(roomName).emit('player:state', playerState))
          .catch((err) => console.error('[BROADCAST ERROR]', err))
      );
    }
  }
  if (playerPromises.length > 0) {
    await Promise.all(playerPromises);
  }
}

export async function startQuestionFlow(io, room) {
  const { done, timeLimit } = await advanceQuestion(room);
  if (!done) {
    const timer = setTimeout(async () => {
      const reveal = await closeCurrentQuestion(room);
      if (reveal) {
        await broadcastRoomState(io, room.code);
      }
    }, (timeLimit || 20) * 1000);
    setRoomTimer(room.code, timer);
  }
  await broadcastRoomState(io, room.code);
}

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    // Quiz Editor Events
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
        ack?.({ ok: true, quiz: saved });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // Host Events
    socket.on('host:create', async ({ quizId } = {}, ack) => {
      try {
        const room = await createRoom(quizId);
        socket.join(`host:${room.code}`);
        const state = await getHostState(room);
        ack?.({ ok: true, hostToken: room.host_token, state });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('host:rejoin', async ({ roomCode, hostToken } = {}, ack) => {
      const room = await verifyHost(roomCode, hostToken);
      if (!room) return ack?.({ ok: false, error: 'Host session expired or invalid.' });
      socket.join(`host:${room.code}`);
      ack?.({ ok: true, state: await getHostState(room) });
    });

    socket.on('host:next', async ({ roomCode, hostToken } = {}, ack) => {
      const room = await verifyHost(roomCode, hostToken);
      if (!room) return ack?.({ ok: false, error: 'Unauthorized host.' });
      const hostState = await getHostState(room);
      if (room.phase === 'LOBBY' && hostState.playerCount === 0) {
        return ack?.({ ok: false, error: 'Wait for at least 1 player to join.' });
      }
      if (room.phase === 'QUESTION' || room.phase === 'FINAL') {
        return ack?.({ ok: false, error: 'Cannot advance right now.' });
      }
      await startQuestionFlow(io, room);
      ack?.({ ok: true });
    });

    socket.on('host:close_question', async ({ roomCode, hostToken } = {}, ack) => {
      const room = await verifyHost(roomCode, hostToken);
      if (!room || room.phase !== 'QUESTION') {
        return ack?.({ ok: false, error: 'Cannot close question.' });
      }
      clearRoomTimer(room.code);
      await closeCurrentQuestion(room, true);
      await broadcastRoomState(io, room.code);
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
        if (reveal) await broadcastRoomState(io, room.code);
      }, result.remainingMs);
      setRoomTimer(room.code, timer);

      await broadcastRoomState(io, room.code);
      ack?.({ ok: true, endsAt: result.newEndsAt });
    });

    // Player Events
    socket.on('player:join', async ({ roomCode, name, playerToken } = {}, ack) => {
      const result = await joinOrRejoinPlayer(roomCode, name, playerToken);
      if (result.error) return ack?.({ ok: false, error: result.error });

      const { room, player } = result;
      socket.join(`player:${player.id}`);
      io.to(`host:${room.code}`).emit('host:state', await getHostState(room));
      ack?.({ ok: true, playerToken: player.token, state: await getPlayerState(room, player) });
    });

    socket.on('player:rejoin', async ({ roomCode, playerToken } = {}, ack) => {
      const result = await rejoinPlayerByToken(roomCode, playerToken);
      if (!result) return ack?.({ ok: false, error: 'Session not found. Please join room again.' });

      const { room, player } = result;
      socket.join(`player:${player.id}`);
      ack?.({ ok: true, state: await getPlayerState(room, player) });
    });

    socket.on('player:answer', async ({ roomCode, playerToken, optionIndex } = {}, ack) => {
      const room = await getRoom(roomCode);
      if (!room) return ack?.({ ok: false, error: 'Room not found.' });

      const result = await recordAnswer(room, playerToken, optionIndex);
      if (result.error) return ack?.({ ok: false, error: result.error });

      const player = (await rejoinPlayerByToken(roomCode, playerToken))?.player;
      ack?.({ ok: true, state: await getPlayerState(room, player) });

      // Real-time host notification (< 2ms)
      io.to(`host:${room.code}`).emit('host:state', await getHostState(room));
    });
  });
}
