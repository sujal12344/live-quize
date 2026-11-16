import crypto from 'node:crypto';
import {
  addPlayerRecord,
  awardPointsToCorrectPlayers,
  createRoomRecord,
  getAnswersCount,
  getLeaderboardFromDb,
  getPlayerAnswer,
  getPlayerByIdRecord,
  getPlayerByTokenRecord,
  getPlayerNames,
  getPlayersCount,
  getQuestionResultsBreakdown,
  getQuiz,
  getRoomRecord,
  insertAnswerRecord,
  seedDefaultQuizIfNeeded,
  updateRoomRecord,
} from './db.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NETWORK_GRACE_MS = 500;

// Seed default verified arithmetic quiz in background
seedDefaultQuizIfNeeded().catch((err) => console.error('[DB SEED WARNING]', err.message));

// High-Performance In-Memory L1 Cache for 0-2ms latency
const roomsCache = new Map();          // roomCode -> room
const roomPlayersCache = new Map();    // roomCode -> Map<playerId, player>
const tokenToPlayerMap = new Map();    // `${roomCode}:${playerToken}` -> player
const roomAnswersCache = new Map();    // `${roomCode}:${qIndex}` -> Map<playerId, answer>
const roomEventsMap = new Map();       // roomCode -> Array<{ type, text, time }>
const roomTimers = new Map();          // roomCode -> timeout
const questionStartTimes = new Map();  // roomCode -> timestamp

async function generateRoomCode() {
  for (let i = 0; i < 30; i++) {
    let code = '';
    for (let j = 0; j < 4; j++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!roomsCache.has(code) && !(await getRoomRecord(code))) return code;
  }
  throw new Error('Could not generate unique room code');
}

export async function createRoom(quizId = 'simple-maths-quiz-basic-arithmetic') {
  let quiz = (await getQuiz(quizId)) || (await getQuiz('simple-maths-quiz-basic-arithmetic'));
  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    await seedDefaultQuizIfNeeded();
    quiz = await getQuiz('simple-maths-quiz-basic-arithmetic');
  }
  if (!quiz) throw new Error('Quiz not found in database');

  const code = await generateRoomCode();
  const hostToken = crypto.randomUUID();

  await createRoomRecord(code, hostToken, quiz.id);

  const room = {
    code,
    host_token: hostToken,
    quiz_id: quiz.id,
    phase: 'LOBBY',
    question_index: -1,
    ends_at: null,
    created_at: Date.now(),
    quiz,
  };

  roomsCache.set(code, room);
  roomPlayersCache.set(code, new Map());
  roomEventsMap.set(code, []);
  return room;
}

export async function getRoom(roomCode) {
  if (typeof roomCode !== 'string') return null;
  const clean = roomCode.trim().toUpperCase();
  if (roomsCache.has(clean)) return roomsCache.get(clean);

  const record = await getRoomRecord(clean);
  if (!record) return null;

  const quiz = await getQuiz(record.quiz_id);
  const fullRoom = { ...record, quiz };
  roomsCache.set(clean, fullRoom);
  return fullRoom;
}

export async function verifyHost(roomCode, hostToken) {
  const room = await getRoom(roomCode);
  return room && hostToken && room.host_token === hostToken ? room : null;
}

export async function joinOrRejoinPlayer(roomCode, name, existingToken) {
  const room = await getRoom(roomCode);
  if (!room) return { error: 'Room not found. Check the code and try again.' };

  // Rule 3: Rejoin existing session
  if (existingToken) {
    const player = await rejoinPlayerByToken(room.code, existingToken);
    if (player) return { room, player: player.player, rejoined: true };
  }

  if (room.phase !== 'LOBBY') {
    return { error: 'Quiz has already started. Ask host for a new room code.' };
  }

  const cleanName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  if (!cleanName) return { error: 'Please enter your name.' };

  const playerId = crypto.randomUUID();
  const playerToken = crypto.randomUUID();

  addPlayerRecord(playerId, room.code, playerToken, cleanName).catch(console.error);

  const player = {
    id: playerId,
    room_code: room.code,
    token: playerToken,
    name: cleanName,
    score: 0,
    joined_at: Date.now(),
  };

  if (!roomPlayersCache.has(room.code)) roomPlayersCache.set(room.code, new Map());
  roomPlayersCache.get(room.code).set(playerId, player);
  tokenToPlayerMap.set(`${room.code}:${playerToken}`, player);

  return { room, player, rejoined: false };
}

export async function rejoinPlayerByToken(roomCode, playerToken) {
  const room = await getRoom(roomCode);
  if (!room || !playerToken) return null;

  const key = `${room.code}:${playerToken}`;
  let player = tokenToPlayerMap.get(key);
  if (!player) {
    player = await getPlayerByTokenRecord(room.code, playerToken);
    if (player) {
      tokenToPlayerMap.set(key, player);
      if (!roomPlayersCache.has(room.code)) roomPlayersCache.set(room.code, new Map());
      roomPlayersCache.get(room.code).set(player.id, player);
    }
  }
  return player ? { room, player } : null;
}

export async function advanceQuestion(room) {
  clearRoomTimer(room.code);
  const nextIdx = room.question_index + 1;

  if (nextIdx >= room.quiz.questions.length) {
    room.phase = 'FINAL';
    room.question_index = -1;
    room.ends_at = null;
    roomsCache.set(room.code, room);
    updateRoomRecord(room.code, 'FINAL', -1, null).catch(console.error);
    questionStartTimes.delete(room.code);
    return { done: true };
  }

  const timeLimit = room.quiz.time_limit_sec || 20;
  const endsAt = Date.now() + timeLimit * 1000;
  questionStartTimes.set(room.code, Date.now());
  roomEventsMap.set(room.code, []);

  room.phase = 'QUESTION';
  room.question_index = nextIdx;
  room.ends_at = endsAt;
  roomsCache.set(room.code, room);

  updateRoomRecord(room.code, 'QUESTION', nextIdx, endsAt).catch(console.error);
  return { done: false, endsAt, timeLimit };
}

export async function recordAnswer(room, playerToken, optionIndex) {
  if (room.phase !== 'QUESTION') return { error: 'Question is closed.' };

  const player = (await rejoinPlayerByToken(room.code, playerToken))?.player;
  if (!player) return { error: 'Player session not found.' };

  if (Date.now() > room.ends_at + NETWORK_GRACE_MS) {
    return { error: 'Time is up for this question.' };
  }

  const curQ = room.quiz.questions[room.question_index];
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= curQ.options.length) {
    return { error: 'Invalid option.' };
  }

  const key = `${room.code}:${room.question_index}`;
  if (!roomAnswersCache.has(key)) roomAnswersCache.set(key, new Map());
  const answersMap = roomAnswersCache.get(key);

  const existingAns = answersMap.has(player.id) ? answersMap.get(player.id).optionIndex : null;
  const isChange = existingAns !== null;
  if (isChange && existingAns === optionIndex) {
    return { ok: true, allAnswered: false, changed: false };
  }

  const startTime = questionStartTimes.get(room.code) || Date.now();
  const responseTimeMs = Math.max(50, Date.now() - startTime);
  const isCorrect = optionIndex === curQ.correct_index;

  answersMap.set(player.id, { optionIndex, isCorrect, answeredAt: Date.now(), responseTimeMs });
  player.lastResponseTimeMs = responseTimeMs;
  if (!isChange) {
    player.totalResponseTimeMs = (player.totalResponseTimeMs || 0) + responseTimeMs;
  }

  insertAnswerRecord(room.code, player.id, room.question_index, optionIndex, isCorrect).catch(console.error);

  const events = roomEventsMap.get(room.code) || [];
  const optLetter = String.fromCharCode(65 + optionIndex);
  events.push({
    type: isChange ? 'change' : 'select',
    text: isChange
      ? `${player.name} changed choice to Option ${optLetter}`
      : `${player.name} chose Option ${optLetter}`,
    time: Date.now(),
  });
  roomEventsMap.set(room.code, events);

  const playersMap = roomPlayersCache.get(room.code);
  const totalPlayers = playersMap ? playersMap.size : (await getPlayersCount(room.code));
  return { ok: true, allAnswered: totalPlayers > 0 && answersMap.size >= totalPlayers, changed: isChange };
}

export async function addTimeToCurrentQuestion(room, seconds = 15) {
  const currentRoom = await getRoom(room.code);
  if (!currentRoom || currentRoom.phase !== 'QUESTION') return null;

  const currentEnds = Number(currentRoom.ends_at) || Date.now();
  const newEndsAt = Math.max(Date.now() + 5000, currentEnds + seconds * 1000);
  currentRoom.ends_at = newEndsAt;
  roomsCache.set(currentRoom.code, currentRoom);

  updateRoomRecord(currentRoom.code, 'QUESTION', currentRoom.question_index, newEndsAt).catch(console.error);
  clearRoomTimer(currentRoom.code);

  return { newEndsAt, remainingMs: Math.max(1000, newEndsAt - Date.now()) };
}

export async function closeCurrentQuestion(room, closedEarly = false) {
  const currentRoom = await getRoom(room.code);
  if (!currentRoom || currentRoom.phase !== 'QUESTION') return null;

  clearRoomTimer(currentRoom.code);

  const curQ = currentRoom.quiz.questions[currentRoom.question_index];
  const qPoints = curQ.points || 100;

  currentRoom.phase = 'REVEALED';
  currentRoom.closed_early = Boolean(closedEarly);
  roomsCache.set(currentRoom.code, currentRoom);

  // Update in-memory player scores immediately
  const answersMap = roomAnswersCache.get(`${currentRoom.code}:${currentRoom.question_index}`);
  const playersMap = roomPlayersCache.get(currentRoom.code);

  if (answersMap && playersMap) {
    for (const [pId, ans] of answersMap.entries()) {
      if (ans.isCorrect && playersMap.has(pId)) {
        const p = playersMap.get(pId);
        p.score = (p.score || 0) + qPoints;
      }
    }
  }

  awardPointsToCorrectPlayers(currentRoom.code, currentRoom.question_index, qPoints).catch(console.error);
  updateRoomRecord(currentRoom.code, 'REVEALED', currentRoom.question_index, null).catch(console.error);

  return {
    correctIndex: curQ.correct_index,
    points: qPoints,
    sourceUrl: curQ.source_url,
    explanation: curQ.explain_text,
    closedEarly: Boolean(closedEarly),
  };
}

// Rule 1: Strips correct answer and explanation while question is active
export function getPublicQuestion(room) {
  if (room.question_index < 0 || room.question_index >= room.quiz.questions.length) return null;
  const q = room.quiz.questions[room.question_index];
  return {
    index: room.question_index,
    total: room.quiz.questions.length,
    stem: q.stem || '',
    prompt: q.prompt,
    options: q.options,
    points: q.points || 100,
    endsAt: room.ends_at,
  };
}

// Rule 6: Host receives complete student choices and leaderboards
export async function getHostState(room) {
  const currentRoom = await getRoom(room.code);
  const showLeaderboard = currentRoom.phase === 'REVEALED' || currentRoom.phase === 'FINAL';

  const playersMap = roomPlayersCache.get(currentRoom.code);
  const players = playersMap
    ? Array.from(playersMap.values()).map((p) => p.name)
    : await getPlayerNames(currentRoom.code);

  const answersKey = `${currentRoom.code}:${currentRoom.question_index}`;
  const answersMap = roomAnswersCache.get(answersKey);
  const answeredCount = answersMap ? answersMap.size : (await getAnswersCount(currentRoom.code, currentRoom.question_index));

  let liveOptionCounts = [];
  let liveOptionStudentNames = [];
  if ((currentRoom.phase === 'QUESTION' || currentRoom.phase === 'REVEALED') && currentRoom.question_index >= 0) {
    const curQ = currentRoom.quiz.questions[currentRoom.question_index];
    const optsCount = curQ?.options?.length || 4;
    liveOptionCounts = new Array(optsCount).fill(0);
    liveOptionStudentNames = Array.from({ length: optsCount }, () => []);
    if (answersMap) {
      for (const [playerId, ans] of answersMap.entries()) {
        if (ans.optionIndex >= 0 && ans.optionIndex < optsCount) {
          liveOptionCounts[ans.optionIndex] += 1;
          const pName = playersMap?.get(playerId)?.name || 'Student';
          liveOptionStudentNames[ans.optionIndex].push(pName);
        }
      }
    }
  }

  let leaderboard = [];
  if (showLeaderboard) {
    if (playersMap) {
      leaderboard = Array.from(playersMap.values())
        .map((p) => ({
          name: p.name,
          score: p.score || 0,
          totalTimeMs: p.totalResponseTimeMs || 0,
          lastResponseSec: p.lastResponseTimeMs ? (p.lastResponseTimeMs / 1000).toFixed(1) : null,
        }))
        .sort((a, b) => b.score - a.score || a.totalTimeMs - b.totalTimeMs);
    } else {
      leaderboard = await getLeaderboardFromDb(currentRoom.code);
    }
  }

  let reveal = null;
  if (currentRoom.phase === 'REVEALED') {
    const q = currentRoom.quiz.questions[currentRoom.question_index];
    reveal = {
      correctIndex: q.correct_index,
      points: q.points || 100,
      sourceUrl: q.source_url,
      explanation: q.explain_text,
      closedEarly: Boolean(currentRoom.closed_early),
    };
  }

  return {
    roomCode: currentRoom.code,
    quizTitle: currentRoom.quiz.title,
    phase: currentRoom.phase,
    playerCount: players.length,
    answeredCount,
    players,
    question: getPublicQuestion(currentRoom),
    liveOptionCounts,
    liveOptionStudentNames,
    liveEvents: (roomEventsMap.get(currentRoom.code) || []).slice(-8),
    questionBreakdown: currentRoom.phase === 'FINAL' ? await getQuestionResultsBreakdown(currentRoom.code) : [],
    reveal,
    leaderboard,
  };
}

// Rule 6: Player state contains ONLY this player's data; no global scores during question
export async function getPlayerState(room, player) {
  const currentRoom = await getRoom(room.code);
  const playersMap = roomPlayersCache.get(currentRoom.code);
  const updatedPlayer = (playersMap && playersMap.get(player.id)) || (await getPlayerByIdRecord(player.id)) || player;

  const answersMap = roomAnswersCache.get(`${currentRoom.code}:${currentRoom.question_index}`);
  const selectedOption = answersMap && answersMap.has(updatedPlayer.id)
    ? answersMap.get(updatedPlayer.id).optionIndex
    : await getPlayerAnswer(currentRoom.code, updatedPlayer.id, currentRoom.question_index);

  let reveal = null;
  if (currentRoom.phase === 'REVEALED') {
    const q = currentRoom.quiz.questions[currentRoom.question_index];
    reveal = {
      correctIndex: q.correct_index,
      points: q.points || 100,
      sourceUrl: q.source_url,
      explanation: q.explain_text,
      isCorrect: selectedOption === q.correct_index,
      closedEarly: Boolean(currentRoom.closed_early),
    };
  }

  return {
    roomCode: currentRoom.code,
    quizTitle: currentRoom.quiz.title,
    name: updatedPlayer.name,
    score: updatedPlayer.score || 0,
    phase: currentRoom.phase,
    question: getPublicQuestion(currentRoom),
    selectedOption,
    reveal,
  };
}

export function setRoomTimer(roomCode, timer) {
  roomTimers.set(roomCode, timer);
}

export function clearRoomTimer(roomCode) {
  if (roomTimers.has(roomCode)) {
    clearTimeout(roomTimers.get(roomCode));
    roomTimers.delete(roomCode);
  }
}
