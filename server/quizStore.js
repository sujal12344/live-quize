import crypto from 'node:crypto';
import {
  addPlayerRecord,
  awardPointsToCorrectPlayers,
  createRoomRecord,
  getAnswersCount,
  getLeaderboardFromDb,
  getLiveOptionCounts,
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

// Seed the default verified maths quiz into database in background (non-blocking)
seedDefaultQuizIfNeeded().catch((err) => {
  console.error('[DB SEED WARNING]', err.message);
});

// High-performance in-memory cache for sub-millisecond real-time game responses
const roomsCache = new Map(); // roomCode -> roomObject
const roomPlayersCache = new Map(); // roomCode -> Map<playerId, playerObject>
const tokenToPlayerMap = new Map(); // `${roomCode}:${playerToken}` -> playerObject
const roomAnswersCache = new Map(); // `${roomCode}:${qIndex}` -> Map<playerId, { optionIndex, isCorrect, answeredAt }>
const roomEventsMap = new Map(); // roomCode -> Array<{ type, text, time }>
const roomTimers = new Map();
const questionStartTimes = new Map();

function ts() {
  const d = new Date();
  const time = d.toTimeString().split(' ')[0];
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${time}.${ms}]`;
}

async function generateRoomCode() {
  for (let i = 0; i < 30; i += 1) {
    let code = '';
    for (let j = 0; j < 4; j += 1) {
      code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    }
    const exists = roomsCache.has(code) || (await getRoomRecord(code));
    if (!exists) return code;
  }
  throw new Error('Could not generate unique room code');
}

export async function createRoom(quizId = 'simple-maths-quiz-basic-arithmetic') {
  const t0 = Date.now();
  let quiz = (await getQuiz(quizId)) || (await getQuiz('simple-maths-quiz-basic-arithmetic'));
  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    await seedDefaultQuizIfNeeded();
    quiz = await getQuiz('simple-maths-quiz-basic-arithmetic');
  }
  if (!quiz) throw new Error('Quiz not found in database');

  const roomCode = await generateRoomCode();
  const hostToken = crypto.randomUUID();

  await createRoomRecord(roomCode, hostToken, quiz.id);

  const room = {
    code: roomCode,
    host_token: hostToken,
    quiz_id: quiz.id,
    phase: 'LOBBY',
    question_index: -1,
    ends_at: null,
    created_at: Date.now(),
    quiz,
  };

  roomsCache.set(roomCode, room);
  roomPlayersCache.set(roomCode, new Map());
  roomEventsMap.set(roomCode, []);

  const durationMs = Date.now() - t0;
  console.log(`\n==================================================`);
  console.log(`${ts()} [ROOM CREATED] Code: ${roomCode} (took ${durationMs}ms)`);
  console.log(`[QUIZ] "${quiz.title}" (${quiz.questions.length} questions, ${quiz.time_limit_sec}s per question)`);
  console.log(`==================================================\n`);

  return room;
}

export async function getRoom(roomCode) {
  if (typeof roomCode !== 'string') return null;
  const cleanCode = roomCode.trim().toUpperCase();
  if (roomsCache.has(cleanCode)) {
    return roomsCache.get(cleanCode);
  }
  const room = await getRoomRecord(cleanCode);
  if (!room) return null;
  const quiz = await getQuiz(room.quiz_id);
  const fullRoom = { ...room, quiz };
  roomsCache.set(cleanCode, fullRoom);
  return fullRoom;
}

export async function verifyHost(roomCode, hostToken) {
  const room = await getRoom(roomCode);
  if (!room || !hostToken || room.host_token !== hostToken) return null;
  return room;
}

export async function joinOrRejoinPlayer(roomCode, name, existingToken) {
  const t0 = Date.now();
  const room = await getRoom(roomCode);
  if (!room) return { error: 'Room not found. Check the code and try again.' };

  // Rule 3: Rejoin existing player with token
  if (existingToken) {
    const tokenKey = `${room.code}:${existingToken}`;
    let player = tokenToPlayerMap.get(tokenKey);
    if (!player) {
      player = await getPlayerByTokenRecord(room.code, existingToken);
      if (player) {
        tokenToPlayerMap.set(tokenKey, player);
        if (!roomPlayersCache.has(room.code)) roomPlayersCache.set(room.code, new Map());
        roomPlayersCache.get(room.code).set(player.id, player);
      }
    }
    if (player) {
      console.log(`${ts()} [PLAYER RECONNECTED] "${player.name}" reconnected to Room ${room.code} | Score: ${player.score} pts (took ${Date.now() - t0}ms)`);
      return { room, player, rejoined: true };
    }
  }

  if (room.phase !== 'LOBBY') {
    return { error: 'Quiz has already started. Ask host for a new room code.' };
  }

  const cleanName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  if (!cleanName) return { error: 'Please enter your name.' };

  const playerId = crypto.randomUUID();
  const playerToken = crypto.randomUUID();

  // Asynchronous non-blocking persistence
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

  const total = roomPlayersCache.get(room.code).size;
  console.log(`${ts()} [PLAYER JOINED] "${player.name}" entered Room ${room.code} | Total players: ${total} (instant: ${Date.now() - t0}ms)`);

  return { room, player, rejoined: false };
}

export async function rejoinPlayerByToken(roomCode, playerToken) {
  const room = await getRoom(roomCode);
  if (!room || !playerToken) return null;

  const tokenKey = `${room.code}:${playerToken}`;
  let player = tokenToPlayerMap.get(tokenKey);
  if (!player) {
    player = await getPlayerByTokenRecord(room.code, playerToken);
    if (player) {
      tokenToPlayerMap.set(tokenKey, player);
      if (!roomPlayersCache.has(room.code)) roomPlayersCache.set(room.code, new Map());
      roomPlayersCache.get(room.code).set(player.id, player);
    }
  }
  if (!player) return null;

  return { room, player };
}

export async function advanceQuestion(room) {
  if (roomTimers.has(room.code)) {
    clearTimeout(roomTimers.get(room.code));
    roomTimers.delete(room.code);
  }

  const nextIndex = room.question_index + 1;
  const totalQuestions = room.quiz.questions.length;

  if (nextIndex >= totalQuestions) {
    room.phase = 'FINAL';
    room.question_index = -1;
    room.ends_at = null;
    roomsCache.set(room.code, room);
    updateRoomRecord(room.code, 'FINAL', -1, null).catch(console.error);
    questionStartTimes.delete(room.code);

    const playersMap = roomPlayersCache.get(room.code);
    const leaders = playersMap
      ? Array.from(playersMap.values()).sort((a, b) => b.score - a.score)
      : await getLeaderboardFromDb(room.code);

    console.log(`\n==================================================`);
    console.log(`${ts()} [QUIZ FINISHED] Room ${room.code} is complete!`);
    console.log(`[FINAL RANKINGS]:`);
    leaders.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} — ${p.score} pts`));
    console.log(`==================================================\n`);

    return { done: true };
  }

  const timeLimit = room.quiz.time_limit_sec || 20;
  const endsAt = Date.now() + timeLimit * 1000;
  questionStartTimes.set(room.code, Date.now());
  roomEventsMap.set(room.code, []);

  room.phase = 'QUESTION';
  room.question_index = nextIndex;
  room.ends_at = endsAt;
  roomsCache.set(room.code, room);

  // Non-blocking database update
  updateRoomRecord(room.code, 'QUESTION', nextIndex, endsAt).catch(console.error);

  const curQ = room.quiz.questions[nextIndex];
  const qPoints = curQ.points || 100;
  console.log(`\n--------------------------------------------------`);
  console.log(`${ts()} [HOST ACTION] Question ${nextIndex + 1} of ${totalQuestions} OPEN in Room ${room.code}`);
  console.log(`[PROMPT] "${curQ.prompt}" (${qPoints} points)`);
  console.log(`[OPTIONS] ${curQ.options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join(' | ')}`);
  console.log(`[TIMER] ${timeLimit} seconds`);
  console.log(`--------------------------------------------------\n`);

  return { done: false, endsAt, timeLimit };
}

export async function recordAnswer(room, playerToken, optionIndex) {
  const t0 = Date.now();
  if (room.phase !== 'QUESTION') return { error: 'Question is closed.' };

  const tokenKey = `${room.code}:${playerToken}`;
  let player = tokenToPlayerMap.get(tokenKey);
  if (!player) {
    player = await getPlayerByTokenRecord(room.code, playerToken);
    if (player) tokenToPlayerMap.set(tokenKey, player);
  }
  if (!player) return { error: 'Player session not found.' };

  if (Date.now() > room.ends_at + NETWORK_GRACE_MS) {
    return { error: 'Time is up for this question.' };
  }

  const curQ = room.quiz.questions[room.question_index];
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= curQ.options.length) {
    return { error: 'Invalid option.' };
  }

  const answersKey = `${room.code}:${room.question_index}`;
  if (!roomAnswersCache.has(answersKey)) {
    roomAnswersCache.set(answersKey, new Map());
  }
  const answersMap = roomAnswersCache.get(answersKey);
  const existingAns = answersMap.has(player.id) ? answersMap.get(player.id).optionIndex : null;

  const isChange = existingAns !== null;
  if (isChange && existingAns === optionIndex) {
    return { ok: true, allAnswered: false, changed: false };
  }

  const isCorrect = optionIndex === curQ.correct_index;
  answersMap.set(player.id, { optionIndex, isCorrect, answeredAt: Date.now() });

  // Non-blocking asynchronous DB write
  insertAnswerRecord(room.code, player.id, room.question_index, optionIndex, isCorrect).catch(console.error);

  const optionLetter = String.fromCharCode(65 + optionIndex);
  const pickedText = curQ.options[optionIndex];

  const startTime = questionStartTimes.get(room.code) || Date.now();
  const responseTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!roomEventsMap.has(room.code)) roomEventsMap.set(room.code, []);
  const events = roomEventsMap.get(room.code);

  if (isChange) {
    const oldLetter = String.fromCharCode(65 + existingAns);
    console.log(`${ts()} [CHOICE CHANGED] "${player.name}" changed Option ${oldLetter} -> Option ${optionLetter} ("${pickedText}") in Room ${room.code} (processed in ${Date.now() - t0}ms)`);
    events.push({
      type: 'change',
      text: `${player.name} changed choice from ${oldLetter} to ${optionLetter}`,
      time: Date.now(),
    });
  } else {
    console.log(`${ts()} [PLAYER CHOICE] "${player.name}" picked Option ${optionLetter} ("${pickedText}") in ${responseTimeSec}s for Q${room.question_index + 1} in Room ${room.code} (processed in ${Date.now() - t0}ms)`);
    events.push({
      type: 'select',
      text: `${player.name} chose Option ${optionLetter}`,
      time: Date.now(),
    });
  }

  const playersMap = roomPlayersCache.get(room.code);
  const totalPlayers = playersMap ? playersMap.size : (await getPlayersCount(room.code));
  const totalAnswers = answersMap.size;

  const allAnswered = totalPlayers > 0 && totalAnswers >= totalPlayers;
  return { ok: true, allAnswered, changed: isChange };
}

export async function addTimeToCurrentQuestion(room, seconds = 15) {
  const currentRoom = await getRoom(room.code);
  if (!currentRoom || currentRoom.phase !== 'QUESTION') return null;

  const currentEndsAt = Number(currentRoom.ends_at) || Date.now();
  const newEndsAt = Math.max(Date.now() + 5000, currentEndsAt + seconds * 1000);
  currentRoom.ends_at = newEndsAt;
  roomsCache.set(currentRoom.code, currentRoom);

  // Non-blocking database update
  updateRoomRecord(currentRoom.code, 'QUESTION', currentRoom.question_index, newEndsAt).catch(console.error);

  if (roomTimers.has(currentRoom.code)) {
    clearTimeout(roomTimers.get(currentRoom.code));
  }
  const remainingMs = Math.max(1000, newEndsAt - Date.now());

  console.log(`${ts()} [HOST EXTRA TIME] Added +${seconds}s to Question ${currentRoom.question_index + 1} in Room ${currentRoom.code} (new countdown: ${Math.round(remainingMs / 1000)}s)`);
  return { newEndsAt, remainingMs };
}

export async function closeCurrentQuestion(room) {
  const t0 = Date.now();
  const currentRoom = await getRoom(room.code);
  if (!currentRoom || currentRoom.phase !== 'QUESTION') return null;

  if (roomTimers.has(currentRoom.code)) {
    clearTimeout(roomTimers.get(currentRoom.code));
    roomTimers.delete(currentRoom.code);
  }

  const curQ = currentRoom.quiz.questions[currentRoom.question_index];
  const qPoints = curQ.points || 100;

  currentRoom.phase = 'REVEALED';
  roomsCache.set(currentRoom.code, currentRoom);

  // Award custom points in memory immediately
  const answersKey = `${currentRoom.code}:${currentRoom.question_index}`;
  const answersMap = roomAnswersCache.get(answersKey);
  const playersMap = roomPlayersCache.get(currentRoom.code);

  if (answersMap && playersMap) {
    for (const [playerId, ans] of answersMap.entries()) {
      if (ans.isCorrect && playersMap.has(playerId)) {
        const p = playersMap.get(playerId);
        p.score = (p.score || 0) + qPoints;
      }
    }
  }

  // Non-blocking database updates
  awardPointsToCorrectPlayers(currentRoom.code, currentRoom.question_index, qPoints).catch(console.error);
  updateRoomRecord(currentRoom.code, 'REVEALED', currentRoom.question_index, null).catch(console.error);

  const correctLetter = String.fromCharCode(65 + curQ.correct_index);
  const correctText = curQ.options[curQ.correct_index];

  const leaders = playersMap
    ? Array.from(playersMap.values()).sort((a, b) => b.score - a.score)
    : await getLeaderboardFromDb(currentRoom.code);

  console.log(`\n--------------------------------------------------`);
  console.log(`${ts()} [QUESTION CLOSED] Question ${currentRoom.question_index + 1} closed in Room ${currentRoom.code} (processed in ${Date.now() - t0}ms)`);
  console.log(`[CORRECT ANSWER] Option ${correctLetter} ("${correctText}") | Points: +${qPoints}`);
  console.log(`[CURRENT LEADERBOARD]:`);
  leaders.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} — ${p.score} pts`));
  console.log(`--------------------------------------------------\n`);

  return {
    correctIndex: curQ.correct_index,
    points: qPoints,
    sourceUrl: curQ.source_url,
    explanation: curQ.explain_text,
  };
}

// Strips answer & explanation while question is open (Rule 1)
export function getPublicQuestion(room) {
  if (room.question_index < 0 || room.question_index >= room.quiz.questions.length) {
    return null;
  }
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

// Host-only state: includes room leaderboard and full player list (Rule 6)
export async function getHostState(room) {
  const currentRoom = await getRoom(room.code);
  const showLeaderboard = currentRoom.phase === 'REVEALED' || currentRoom.phase === 'FINAL';

  const playersMap = roomPlayersCache.get(currentRoom.code);
  let players = [];
  if (playersMap) {
    players = Array.from(playersMap.values()).map((p) => p.name);
  } else {
    players = await getPlayerNames(currentRoom.code);
  }

  const answersKey = `${currentRoom.code}:${currentRoom.question_index}`;
  const answersMap = roomAnswersCache.get(answersKey);
  const answeredCount = answersMap ? answersMap.size : (await getAnswersCount(currentRoom.code, currentRoom.question_index));

  let liveOptionCounts = [];
  if (currentRoom.phase === 'QUESTION' && currentRoom.question_index >= 0) {
    const curQ = currentRoom.quiz.questions[currentRoom.question_index];
    const optsCount = curQ?.options?.length || 4;
    liveOptionCounts = new Array(optsCount).fill(0);
    if (answersMap) {
      for (const ans of answersMap.values()) {
        if (ans.optionIndex >= 0 && ans.optionIndex < optsCount) {
          liveOptionCounts[ans.optionIndex] += 1;
        }
      }
    }
  }

  const liveEvents = (roomEventsMap.get(currentRoom.code) || []).slice(-8);

  let questionBreakdown = [];
  if (currentRoom.phase === 'FINAL') {
    questionBreakdown = await getQuestionResultsBreakdown(currentRoom.code);
  }

  let reveal = null;
  if (currentRoom.phase === 'REVEALED') {
    const q = currentRoom.quiz.questions[currentRoom.question_index];
    reveal = {
      correctIndex: q.correct_index,
      points: q.points || 100,
      sourceUrl: q.source_url,
      explanation: q.explain_text,
    };
  }

  let leaderboard = [];
  if (showLeaderboard) {
    if (playersMap) {
      leaderboard = Array.from(playersMap.values())
        .map((p) => ({ name: p.name, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);
    } else {
      leaderboard = await getLeaderboardFromDb(currentRoom.code);
    }
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
    liveEvents,
    questionBreakdown,
    reveal,
    leaderboard,
  };
}

// Player-only state: contains ONLY this player's data (Rule 6) and no open answers (Rule 1)
export async function getPlayerState(room, player) {
  const currentRoom = await getRoom(room.code);
  const playersMap = roomPlayersCache.get(currentRoom.code);
  const updatedPlayer = (playersMap && playersMap.get(player.id)) || (await getPlayerByIdRecord(player.id)) || player;

  const answersKey = `${currentRoom.code}:${currentRoom.question_index}`;
  const answersMap = roomAnswersCache.get(answersKey);
  let selectedOption = null;
  if (answersMap && answersMap.has(updatedPlayer.id)) {
    selectedOption = answersMap.get(updatedPlayer.id).optionIndex;
  } else {
    selectedOption = await getPlayerAnswer(currentRoom.code, updatedPlayer.id, currentRoom.question_index);
  }

  let reveal = null;
  if (currentRoom.phase === 'REVEALED') {
    const q = currentRoom.quiz.questions[currentRoom.question_index];
    const qPoints = q.points || 100;
    reveal = {
      correctIndex: q.correct_index,
      points: qPoints,
      sourceUrl: q.source_url,
      explanation: q.explain_text,
      isCorrect: selectedOption === q.correct_index,
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
