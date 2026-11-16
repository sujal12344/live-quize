import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
export const isPostgres = Boolean(databaseUrl);

let pool = null;
let sqliteDb = null;

if (isPostgres) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  console.log('[DB] Connected to Neon Cloud PostgreSQL.');
} else {
  const { DatabaseSync } = await import('node:sqlite');
  sqliteDb = new DatabaseSync(path.resolve(__dirname, 'quiz.db'));
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  console.log('[DB] Using local SQLite database (server/quiz.db).');
}

// Unified query runner: auto-maps '?' to '$1, $2...' for PostgreSQL
export async function query(sql, params = []) {
  if (isPostgres) {
    let idx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
    const res = await pool.query(pgSql, params);
    return res.rows;
  }
  const stmt = sqliteDb.prepare(sql);
  return /^SELECT/i.test(sql.trim()) ? stmt.all(...params) : stmt.run(...params);
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Database Schema Initialization
export async function initDbSchema() {
  const autoId = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  await query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id VARCHAR(255) PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      time_limit_sec INT DEFAULT 20,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id ${autoId},
      quiz_id VARCHAR(255) NOT NULL,
      q_order INT NOT NULL,
      stem TEXT,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INT NOT NULL,
      points INT DEFAULT 100,
      explain_text TEXT,
      source_url TEXT
    );
    CREATE TABLE IF NOT EXISTS rooms (
      code VARCHAR(32) PRIMARY KEY,
      host_token VARCHAR(255) NOT NULL,
      quiz_id VARCHAR(255) NOT NULL,
      phase VARCHAR(32) NOT NULL,
      question_index INT DEFAULT -1,
      ends_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id VARCHAR(255) PRIMARY KEY,
      room_code VARCHAR(32) NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      score INT DEFAULT 0,
      joined_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      room_code VARCHAR(32) NOT NULL,
      player_id VARCHAR(255) NOT NULL,
      question_index INT NOT NULL,
      option_index INT NOT NULL,
      is_correct INT NOT NULL,
      answered_at BIGINT NOT NULL,
      PRIMARY KEY (room_code, player_id, question_index)
    );
  `);
}

// Seed default 10-question verified quiz
export async function seedDefaultQuizIfNeeded() {
  await initDbSchema();
  const existing = await queryOne('SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?', ['simple-maths-quiz-basic-arithmetic']);
  if (Number(existing?.count || 0) >= 10) return;

  const quizPath = path.resolve(__dirname, 'sample-maths.quiz.json');
  if (!fs.existsSync(quizPath)) return;

  const data = JSON.parse(fs.readFileSync(quizPath, 'utf-8'));
  await saveQuizToDatabase(data);
  console.log(`[SEED] Seeded 10 verified questions into ${isPostgres ? 'Neon' : 'SQLite'}.`);
}

// Quiz & Question Queries
export async function saveQuizToDatabase(data) {
  const quizId = data.id || `quiz-${Date.now()}`;
  const title = data.title || 'Untitled Quiz';
  const desc = data.description || '';
  const timeLimit = Number(data.timeLimitSec) || 20;

  await query(
    `INSERT INTO quizzes (id, title, description, time_limit_sec, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, time_limit_sec = EXCLUDED.time_limit_sec`,
    [quizId, title, desc, timeLimit, Date.now()]
  );
  await query('DELETE FROM questions WHERE quiz_id = ?', [quizId]);

  const list = Array.isArray(data.questions) ? data.questions : [];
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    const opts = Array.isArray(q.options) ? q.options : ['A', 'B', 'C', 'D'];
    let correct = Number.isInteger(q.correctIndex) ? q.correctIndex : Number.isInteger(q.answerIndex) ? q.answerIndex : 0;
    await query(
      `INSERT INTO questions (quiz_id, q_order, stem, prompt, options_json, correct_index, points, explain_text, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quizId, i, q.stem || '', q.lead || q.prompt || `Q${i + 1}`, JSON.stringify(opts), correct, Number(q.points) || 100, q.explain || '', q.sourceUrl || '']
    );
  }
  return getQuiz(quizId);
}

export async function getQuiz(quizId) {
  const quiz = await queryOne('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  if (!quiz) return null;
  const rows = await query('SELECT * FROM questions WHERE quiz_id = ? ORDER BY q_order ASC', [quizId]);
  const questions = rows.map((q) => ({
    ...q,
    options: typeof q.options_json === 'string' ? JSON.parse(q.options_json) : q.options_json,
  }));
  return { ...quiz, questions };
}

export const listQuizzes = () => query('SELECT id, title, description, time_limit_sec FROM quizzes ORDER BY created_at DESC');

// Room Queries
export const createRoomRecord = (code, hostToken, quizId) =>
  query('INSERT INTO rooms (code, host_token, quiz_id, phase, question_index, ends_at, created_at) VALUES (?, ?, ?, ?, -1, NULL, ?)', [code, hostToken, quizId, 'LOBBY', Date.now()]);

export const getRoomRecord = (code) =>
  queryOne('SELECT * FROM rooms WHERE code = ?', [code?.trim().toUpperCase()]);

export const updateRoomRecord = (code, phase, qIndex, endsAt) =>
  query('UPDATE rooms SET phase = ?, question_index = ?, ends_at = ? WHERE code = ?', [phase, qIndex, endsAt, code]);

// Player Queries
export const addPlayerRecord = (id, roomCode, token, name) =>
  query('INSERT INTO players (id, room_code, token, name, score, joined_at) VALUES (?, ?, ?, ?, 0, ?)', [id, roomCode, token, name, Date.now()]);

export const getPlayerByTokenRecord = (roomCode, token) =>
  queryOne('SELECT * FROM players WHERE room_code = ? AND token = ?', [roomCode, token]);

export const getPlayerByIdRecord = (id) =>
  queryOne('SELECT * FROM players WHERE id = ?', [id]);

export const getPlayersCount = async (roomCode) =>
  Number((await queryOne('SELECT COUNT(*) as count FROM players WHERE room_code = ?', [roomCode]))?.count || 0);

export const getPlayerNames = async (roomCode) =>
  (await query('SELECT name FROM players WHERE room_code = ? ORDER BY joined_at ASC', [roomCode])).map((r) => r.name);

// Answer Queries
export const insertAnswerRecord = (roomCode, playerId, qIndex, optionIndex, isCorrect) =>
  query(
    `INSERT INTO answers (room_code, player_id, question_index, option_index, is_correct, answered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (room_code, player_id, question_index) DO UPDATE
     SET option_index = EXCLUDED.option_index, is_correct = EXCLUDED.is_correct, answered_at = EXCLUDED.answered_at`,
    [roomCode, playerId, qIndex, optionIndex, isCorrect ? 1 : 0, Date.now()]
  );

export const getAnswersCount = async (roomCode, qIndex) =>
  Number((await queryOne('SELECT COUNT(*) as count FROM answers WHERE room_code = ? AND question_index = ?', [roomCode, qIndex]))?.count || 0);

export const getPlayerAnswer = async (roomCode, playerId, qIndex) =>
  (await queryOne('SELECT option_index FROM answers WHERE room_code = ? AND player_id = ? AND question_index = ?', [roomCode, playerId, qIndex]))?.option_index ?? null;

export async function getLiveOptionCounts(roomCode, qIndex, count = 4) {
  const result = new Array(count).fill(0);
  const rows = await query('SELECT option_index, COUNT(*) as count FROM answers WHERE room_code = ? AND question_index = ? GROUP BY option_index', [roomCode, qIndex]);
  for (const r of rows) {
    if (r.option_index >= 0 && r.option_index < count) result[r.option_index] = Number(r.count);
  }
  return result;
}

export async function getQuestionResultsBreakdown(roomCode) {
  const rows = await query(
    `SELECT question_index, COUNT(*) as total, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct
     FROM answers WHERE room_code = ? GROUP BY question_index ORDER BY question_index ASC`,
    [roomCode]
  );
  return rows.map((r) => ({
    questionIndex: Number(r.question_index),
    total: Number(r.total),
    correct: Number(r.correct || 0),
    percent: Number(r.total) > 0 ? Math.round((Number(r.correct || 0) / Number(r.total)) * 100) : 0,
  }));
}

export const awardPointsToCorrectPlayers = (roomCode, qIndex, points) =>
  query(
    `UPDATE players SET score = score + ?
     WHERE id IN (SELECT player_id FROM answers WHERE room_code = ? AND question_index = ? AND is_correct = 1)`,
    [points, roomCode, qIndex]
  );

export const getLeaderboardFromDb = (roomCode) =>
  query('SELECT id, name, score FROM players WHERE room_code = ? ORDER BY score DESC, joined_at ASC', [roomCode]);
