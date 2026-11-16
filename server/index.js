import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getQuiz, isPostgres, listQuizzes, saveQuizToDatabase } from './db.js';
import { setupSocketHandlers } from './socketHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../client/dist');
const PORT = process.env.PORT || 3000;

const app = express();

// Cross-origin and JSON body middleware
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
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// REST Health & Quiz Endpoints
app.get('/health', (_req, res) => res.json({ ok: true, db: isPostgres ? 'neon-postgres' : 'sqlite' }));

app.get('/api/quizzes', async (_req, res) => {
  try {
    res.json({ ok: true, quizzes: await listQuizzes() });
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
    res.json({ ok: true, quiz: saved });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Serve compiled frontend in production
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Attach real-time game socket handlers
setupSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Live Classroom Quiz Server`);
  console.log(`  Local URL : http://localhost:${PORT}`);
  console.log(`  Database  : ${isPostgres ? 'Neon Cloud PostgreSQL' : 'Local SQLite'}`);
  console.log(`======================================================\n`);
});
