import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

export const isPostgres = Boolean(databaseUrl);
let pool = null;

if (isPostgres) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  console.log('[DB] Connecting to Neon Cloud PostgreSQL database...');
} else {
  console.log('[DB] Using local SQLite database (no DATABASE_URL set).');
}

// Fallback SQLite instance if no DATABASE_URL
let sqliteDb = null;
if (!isPostgres) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = path.resolve(__dirname, 'quiz.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
}

export async function initDbSchema() {
  if (isPostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id VARCHAR(255) PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        time_limit_sec INT DEFAULT 20,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
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
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        time_limit_sec INTEGER DEFAULT 20,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id TEXT NOT NULL,
        q_order INTEGER NOT NULL,
        stem TEXT,
        prompt TEXT NOT NULL,
        options_json TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        points INTEGER DEFAULT 100,
        explain_text TEXT,
        source_url TEXT
      );
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_token TEXT NOT NULL,
        quiz_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        question_index INTEGER DEFAULT -1,
        ends_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        score INTEGER DEFAULT 0,
        joined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answers (
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        option_index INTEGER NOT NULL,
        is_correct INTEGER NOT NULL,
        answered_at INTEGER NOT NULL,
        PRIMARY KEY (room_code, player_id, question_index)
      );
    `);
  }
}

export async function seedDefaultQuizIfNeeded() {
  await initDbSchema();

  let existingCount = 0;
  if (isPostgres) {
    const res = await pool.query(
      'SELECT COUNT(*) as count FROM questions WHERE quiz_id = $1',
      ['simple-maths-quiz-basic-arithmetic']
    );
    existingCount = Number(res.rows[0]?.count || 0);
  } else {
    const row = sqliteDb
      .prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?')
      .get('simple-maths-quiz-basic-arithmetic');
    existingCount = Number(row?.count || 0);
  }

  if (existingCount >= 10) return;

  const candidatePaths = [
    path.resolve(__dirname, 'sample-maths-quiz-basic-arithmetic.quiz.json'),
    path.resolve(__dirname, '../sample-quizzes/sample-maths-quiz-basic-arithmetic.quiz.json'),
  ];
  const defaultQuizPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!defaultQuizPath) return;

  const raw = fs.readFileSync(defaultQuizPath, 'utf-8');
  const parsed = JSON.parse(raw);
  await saveQuizToDatabase(parsed);
  console.log(`[SEED] Seeded 10 verified questions into ${isPostgres ? 'Neon PostgreSQL' : 'SQLite'}!`);
}

export async function saveQuizToDatabase(quizData) {
  const quizId = quizData.id || `quiz-${Date.now()}`;
  const title = quizData.title || 'Untitled Quiz';
  const description = quizData.description || '';
  const timeLimit = Number(quizData.timeLimitSec) || 20;

  if (isPostgres) {
    await pool.query(
      `INSERT INTO quizzes (id, title, description, time_limit_sec, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, time_limit_sec = EXCLUDED.time_limit_sec`,
      [quizId, title, description, timeLimit, Date.now()]
    );
    await pool.query('DELETE FROM questions WHERE quiz_id = $1', [quizId]);
  } else {
    sqliteDb.prepare(`
      INSERT OR REPLACE INTO quizzes (id, title, description, time_limit_sec, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(quizId, title, description, timeLimit, Date.now());
    sqliteDb.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId);
  }

  const list = Array.isArray(quizData.questions) ? quizData.questions : [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const q = list[idx];
    const prompt = q.lead || q.prompt || `Question ${idx + 1}`;
    const stem = q.stem || '';
    const options = Array.isArray(q.options) ? q.options : ['A', 'B', 'C', 'D'];
    const points = Number.isInteger(q.points) ? q.points : 100;

    let correct = 0;
    if (Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < options.length) {
      correct = q.answerIndex;
    } else if (Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length) {
      correct = q.correctIndex;
    } else if (typeof q.answer === 'string' && q.answer.trim()) {
      const letterIdx = q.answer.trim().toUpperCase().charCodeAt(0) - 65;
      if (letterIdx >= 0 && letterIdx < options.length) correct = letterIdx;
    } else if (typeof q.explain === 'string') {
      const m = q.explain.match(/option\s+([A-E])/i);
      if (m) {
        const letterIdx = m[1].toUpperCase().charCodeAt(0) - 65;
        if (letterIdx >= 0 && letterIdx < options.length) correct = letterIdx;
      }
    }

    if (isPostgres) {
      await pool.query(
        `INSERT INTO questions (quiz_id, q_order, stem, prompt, options_json, correct_index, points, explain_text, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [quizId, idx, stem, prompt, JSON.stringify(options), correct, points, q.explain || '', q.sourceUrl || '']
      );
    } else {
      sqliteDb.prepare(`
        INSERT INTO questions (quiz_id, q_order, stem, prompt, options_json, correct_index, points, explain_text, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(quizId, idx, stem, prompt, JSON.stringify(options), correct, points, q.explain || '', q.sourceUrl || '');
    }
  }

  return await getQuiz(quizId);
}

export async function getQuiz(quizId) {
  if (isPostgres) {
    const qRes = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    if (qRes.rows.length === 0) return null;
    const quiz = qRes.rows[0];
    const qsRes = await pool.query(
      'SELECT * FROM questions WHERE quiz_id = $1 ORDER BY q_order ASC',
      [quizId]
    );
    const questions = qsRes.rows.map((q) => ({
      ...q,
      options: typeof q.options_json === 'string' ? JSON.parse(q.options_json) : q.options_json,
    }));
    return { ...quiz, questions };
  } else {
    const quiz = sqliteDb.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
    if (!quiz) return null;
    const questions = sqliteDb
      .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY q_order ASC')
      .all(quizId)
      .map((q) => ({
        ...q,
        options: JSON.parse(q.options_json),
      }));
    return { ...quiz, questions };
  }
}

export async function listQuizzes() {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT id, title, description, time_limit_sec FROM quizzes ORDER BY created_at DESC'
    );
    return res.rows;
  } else {
    return sqliteDb
      .prepare('SELECT id, title, description, time_limit_sec FROM quizzes ORDER BY created_at DESC')
      .all();
  }
}

// Room & gameplay queries
export async function createRoomRecord(roomCode, hostToken, quizId) {
  if (isPostgres) {
    await pool.query(
      `INSERT INTO rooms (code, host_token, quiz_id, phase, question_index, ends_at, created_at)
       VALUES ($1, $2, $3, 'LOBBY', -1, NULL, $4)`,
      [roomCode, hostToken, quizId, Date.now()]
    );
  } else {
    sqliteDb.prepare(`
      INSERT INTO rooms (code, host_token, quiz_id, phase, question_index, ends_at, created_at)
      VALUES (?, ?, ?, 'LOBBY', -1, NULL, ?)
    `).run(roomCode, hostToken, quizId, Date.now());
  }
}

export async function getRoomRecord(roomCode) {
  if (typeof roomCode !== 'string') return null;
  const clean = roomCode.trim().toUpperCase();
  if (isPostgres) {
    const res = await pool.query('SELECT * FROM rooms WHERE code = $1', [clean]);
    return res.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT * FROM rooms WHERE code = ?').get(clean) || null;
  }
}

export async function updateRoomRecord(roomCode, phase, questionIndex, endsAt) {
  if (isPostgres) {
    await pool.query(
      'UPDATE rooms SET phase = $1, question_index = $2, ends_at = $3 WHERE code = $4',
      [phase, questionIndex, endsAt, roomCode]
    );
  } else {
    sqliteDb.prepare(
      'UPDATE rooms SET phase = ?, question_index = ?, ends_at = ? WHERE code = ?'
    ).run(phase, questionIndex, endsAt, roomCode);
  }
}

export async function addPlayerRecord(id, roomCode, token, name) {
  if (isPostgres) {
    await pool.query(
      `INSERT INTO players (id, room_code, token, name, score, joined_at)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [id, roomCode, token, name, Date.now()]
    );
  } else {
    sqliteDb.prepare(`
      INSERT INTO players (id, room_code, token, name, score, joined_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, roomCode, token, name, Date.now());
  }
}

export async function getPlayerByTokenRecord(roomCode, token) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT * FROM players WHERE room_code = $1 AND token = $2',
      [roomCode, token]
    );
    return res.rows[0] || null;
  } else {
    return (
      sqliteDb
        .prepare('SELECT * FROM players WHERE room_code = ? AND token = ?')
        .get(roomCode, token) || null
    );
  }
}

export async function getPlayerByIdRecord(id) {
  if (isPostgres) {
    const res = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
    return res.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
  }
}

export async function getPlayersCount(roomCode) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT COUNT(*) as count FROM players WHERE room_code = $1',
      [roomCode]
    );
    return Number(res.rows[0]?.count || 0);
  } else {
    const row = sqliteDb
      .prepare('SELECT COUNT(*) as count FROM players WHERE room_code = ?')
      .get(roomCode);
    return Number(row?.count || 0);
  }
}

export async function getPlayerNames(roomCode) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT name FROM players WHERE room_code = $1 ORDER BY joined_at ASC',
      [roomCode]
    );
    return res.rows.map((r) => r.name);
  } else {
    return sqliteDb
      .prepare('SELECT name FROM players WHERE room_code = ? ORDER BY joined_at ASC')
      .all(roomCode)
      .map((r) => r.name);
  }
}

export async function getAnswersCount(roomCode, questionIndex) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT COUNT(*) as count FROM answers WHERE room_code = $1 AND question_index = $2',
      [roomCode, questionIndex]
    );
    return Number(res.rows[0]?.count || 0);
  } else {
    const row = sqliteDb
      .prepare('SELECT COUNT(*) as count FROM answers WHERE room_code = ? AND question_index = ?')
      .get(roomCode, questionIndex);
    return Number(row?.count || 0);
  }
}

export async function getPlayerAnswer(roomCode, playerId, questionIndex) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT option_index FROM answers WHERE room_code = $1 AND player_id = $2 AND question_index = $3',
      [roomCode, playerId, questionIndex]
    );
    return res.rows[0]?.option_index ?? null;
  } else {
    const row = sqliteDb
      .prepare(
        'SELECT option_index FROM answers WHERE room_code = ? AND player_id = ? AND question_index = ?'
      )
      .get(roomCode, playerId, questionIndex);
    return row?.option_index ?? null;
  }
}

export async function insertAnswerRecord(roomCode, playerId, questionIndex, optionIndex, isCorrect) {
  if (isPostgres) {
    await pool.query(
      `INSERT INTO answers (room_code, player_id, question_index, option_index, is_correct, answered_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (room_code, player_id, question_index) DO UPDATE
       SET option_index = EXCLUDED.option_index, is_correct = EXCLUDED.is_correct, answered_at = EXCLUDED.answered_at`,
      [roomCode, playerId, questionIndex, optionIndex, isCorrect ? 1 : 0, Date.now()]
    );
  } else {
    sqliteDb.prepare(`
      INSERT INTO answers (room_code, player_id, question_index, option_index, is_correct, answered_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (room_code, player_id, question_index) DO UPDATE
      SET option_index = excluded.option_index, is_correct = excluded.is_correct, answered_at = excluded.answered_at
    `).run(roomCode, playerId, questionIndex, optionIndex, isCorrect ? 1 : 0, Date.now());
  }
}

export async function getLiveOptionCounts(roomCode, questionIndex, optionsCount = 4) {
  const counts = new Array(optionsCount).fill(0);
  if (isPostgres) {
    const res = await pool.query(
      `SELECT option_index, COUNT(*) as count FROM answers
       WHERE room_code = $1 AND question_index = $2
       GROUP BY option_index`,
      [roomCode, questionIndex]
    );
    for (const r of res.rows) {
      if (r.option_index >= 0 && r.option_index < optionsCount) {
        counts[r.option_index] = Number(r.count);
      }
    }
  } else {
    const rows = sqliteDb.prepare(`
      SELECT option_index, COUNT(*) as count FROM answers
      WHERE room_code = ? AND question_index = ?
      GROUP BY option_index
    `).all(roomCode, questionIndex);
    for (const r of rows) {
      if (r.option_index >= 0 && r.option_index < optionsCount) {
        counts[r.option_index] = Number(r.count);
      }
    }
  }
  return counts;
}

export async function getQuestionResultsBreakdown(roomCode) {
  if (isPostgres) {
    const res = await pool.query(
      `SELECT question_index,
              COUNT(*) as total_answers,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers
       FROM answers
       WHERE room_code = $1
       GROUP BY question_index
       ORDER BY question_index ASC`,
      [roomCode]
    );
    return res.rows.map((r) => ({
      questionIndex: Number(r.question_index),
      total: Number(r.total_answers),
      correct: Number(r.correct_answers),
      percent: Number(r.total_answers) > 0 ? Math.round((Number(r.correct_answers) / Number(r.total_answers)) * 100) : 0,
    }));
  } else {
    const rows = sqliteDb.prepare(`
      SELECT question_index,
             COUNT(*) as total_answers,
             SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers
      FROM answers
      WHERE room_code = ?
      GROUP BY question_index
      ORDER BY question_index ASC
    `).all(roomCode);
    return rows.map((r) => ({
      questionIndex: Number(r.question_index),
      total: Number(r.total_answers),
      correct: Number(r.correct_answers),
      percent: Number(r.total_answers) > 0 ? Math.round((Number(r.correct_answers) / Number(r.total_answers)) * 100) : 0,
    }));
  }
}

export async function awardPointsToCorrectPlayers(roomCode, questionIndex, pointsAwarded) {
  if (isPostgres) {
    await pool.query(
      `UPDATE players SET score = score + $1
       WHERE id IN (
         SELECT player_id FROM answers
         WHERE room_code = $2 AND question_index = $3 AND is_correct = 1
       )`,
      [pointsAwarded, roomCode, questionIndex]
    );
  } else {
    const correctRows = sqliteDb.prepare(`
      SELECT player_id FROM answers
      WHERE room_code = ? AND question_index = ? AND is_correct = 1
    `).all(roomCode, questionIndex);
    for (const row of correctRows) {
      sqliteDb.prepare('UPDATE players SET score = score + ? WHERE id = ?').run(
        pointsAwarded,
        row.player_id
      );
    }
  }
}

export async function getLeaderboardFromDb(roomCode) {
  if (isPostgres) {
    const res = await pool.query(
      'SELECT id, name, score FROM players WHERE room_code = $1 ORDER BY score DESC, joined_at ASC',
      [roomCode]
    );
    return res.rows;
  } else {
    return sqliteDb.prepare(`
      SELECT id, name, score FROM players
      WHERE room_code = ?
      ORDER BY score DESC, joined_at ASC
    `).all(roomCode);
  }
}
