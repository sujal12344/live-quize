import { useState } from 'react';
import { socket } from './socket.js';

export const SAMPLE_MATH_QUIZ = {
  id: 'simple-maths-quiz-basic-arithmetic',
  title: 'Simple Maths Quiz – Basic Arithmetic',
  description: '10 beginner-level maths questions (addition, subtraction, and multiplication). Single-digit arithmetic, 4 options each, 20s per question.',
  timeLimitSec: 20,
  questions: [
    {
      stem: 'A student is practising basic addition.',
      lead: 'What is 3 + 4?',
      options: ['5', '6', '7', '8'],
      correctIndex: 2,
      points: 100,
      explain: '3 + 4 = 7. Option C is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
    },
    {
      stem: 'A student is practising basic subtraction.',
      lead: 'What is 9 - 5?',
      options: ['2', '3', '4', '5'],
      correctIndex: 2,
      points: 100,
      explain: '9 - 5 = 4. Option C is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
    },
    {
      stem: 'A student is practising basic addition.',
      lead: 'What is 6 + 2?',
      options: ['7', '8', '9', '10'],
      correctIndex: 1,
      points: 100,
      explain: '6 + 2 = 8. Option B is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
    },
    {
      stem: 'A student is practising basic subtraction.',
      lead: 'What is 8 - 3?',
      options: ['4', '5', '6', '7'],
      correctIndex: 1,
      points: 100,
      explain: '8 - 3 = 5. Option B is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
    },
    {
      stem: 'A student is practising basic addition.',
      lead: 'What is 5 + 4?',
      options: ['7', '8', '9', '10'],
      correctIndex: 2,
      points: 100,
      explain: '5 + 4 = 9. Option C is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
    },
    {
      stem: 'A student is practising basic subtraction.',
      lead: 'What is 7 - 4?',
      options: ['2', '3', '4', '5'],
      correctIndex: 1,
      points: 100,
      explain: '7 - 4 = 3. Option B is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
    },
    {
      stem: 'A student is practising basic multiplication.',
      lead: 'What is 3 × 3?',
      options: ['6', '8', '9', '12'],
      correctIndex: 2,
      points: 100,
      explain: '3 × 3 = 9. Option C is correct.',
      sourceUrl: 'https://www.mathsisfun.com/multiplication.html',
    },
    {
      stem: 'A student is practising basic subtraction.',
      lead: 'What is 8 - 6?',
      options: ['1', '2', '3', '4'],
      correctIndex: 1,
      points: 100,
      explain: '8 - 6 = 2. Option B is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
    },
    {
      stem: 'A student is practising basic addition.',
      lead: 'What is 2 + 7?',
      options: ['8', '9', '10', '11'],
      correctIndex: 1,
      points: 100,
      explain: '2 + 7 = 9. Option B is correct.',
      sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
    },
    {
      stem: 'A student is practising basic multiplication.',
      lead: 'What is 4 × 2?',
      options: ['6', '7', '8', '10'],
      correctIndex: 2,
      points: 100,
      explain: '4 × 2 = 8. Option C is correct.',
      sourceUrl: 'https://www.mathsisfun.com/multiplication.html',
    },
  ],
};

const EMPTY_QUESTION = {
  stem: '',
  lead: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  points: 100,
  explain: '',
  sourceUrl: '',
};

export default function QuizEditor({ onExit, onPlayQuiz }) {
  const [title, setTitle] = useState(SAMPLE_MATH_QUIZ.title);
  const [description, setDescription] = useState(SAMPLE_MATH_QUIZ.description);
  const [timeLimitSec, setTimeLimitSec] = useState(20);
  const [questions, setQuestions] = useState(
    SAMPLE_MATH_QUIZ.questions.map((q) => ({ ...q, options: [...q.options] }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [saveStatus, setSaveStatus] = useState('');

  // Instantly loads the 10 verified arithmetic questions without network failure risk
  const loadSampleArithmetic = () => {
    setTitle(SAMPLE_MATH_QUIZ.title);
    setDescription(SAMPLE_MATH_QUIZ.description);
    setTimeLimitSec(SAMPLE_MATH_QUIZ.timeLimitSec);
    setQuestions(
      SAMPLE_MATH_QUIZ.questions.map((q) => ({
        ...q,
        options: [...q.options],
      }))
    );
    setActiveIdx(0);
    setSaveStatus('✓ Loaded 10-Question Sample Arithmetic Quiz!');
    setTimeout(() => setSaveStatus(''), 2500);

    // Sync to backend DB in background
    if (socket.connected) {
      socket.emit('quiz:save', SAMPLE_MATH_QUIZ);
    }
  };

  const handleAddQuestion = () => {
    const next = [...questions, { ...EMPTY_QUESTION, options: ['', '', '', ''], points: 100 }];
    setQuestions(next);
    setActiveIdx(next.length - 1);
  };

  const handleDuplicate = (idx) => {
    const copy = JSON.parse(JSON.stringify(questions[idx]));
    const next = [...questions.slice(0, idx + 1), copy, ...questions.slice(idx + 1)];
    setQuestions(next);
    setActiveIdx(idx + 1);
  };

  const handleDelete = (idx) => {
    if (questions.length <= 1) return;
    const next = questions.filter((_, i) => i !== idx);
    setQuestions(next);
    setActiveIdx(Math.max(0, idx - 1));
  };

  const updateActive = (field, val) => {
    const next = [...questions];
    next[activeIdx] = { ...next[activeIdx], [field]: val };
    setQuestions(next);
  };

  const updateOption = (optIdx, val) => {
    const next = [...questions];
    const opts = [...next[activeIdx].options];
    opts[optIdx] = val;
    next[activeIdx] = { ...next[activeIdx], options: opts };
    setQuestions(next);
  };

  const prepareQuizData = () => {
    const cleanId = `quiz-${Date.now()}`;
    return {
      format: 'acsom-live-quiz',
      version: 1,
      id: cleanId,
      title: title.trim() || 'Untitled Quiz',
      description: description.trim(),
      timeLimitSec: Number(timeLimitSec) || 20,
      questions: questions.map((q) => ({
        stem: q.stem.trim(),
        lead: q.lead.trim() || 'Question',
        options: q.options.map((o) => o.trim() || 'Option'),
        correctIndex: q.correctIndex,
        points: Number(q.points) || 100,
        explain: q.explain.trim(),
        sourceUrl: q.sourceUrl.trim(),
      })),
    };
  };

  const handleSaveToDb = (andPlay = false) => {
    const quizData = prepareQuizData();
    if (!socket.connected) {
      setSaveStatus('⚠️ Server offline! Make sure "npm run dev" is running in the root folder.');
      return;
    }
    setSaveStatus(andPlay ? 'Saving quiz & opening host room...' : 'Saving quiz to database...');
    socket.timeout(6000).emit('quiz:save', quizData, (err, res) => {
      if (err) {
        setSaveStatus('⚠️ Request timed out. Please check server connection.');
        return;
      }
      if (res?.ok) {
        setSaveStatus(`✓ Saved "${quizData.title}" (${quizData.questions.length} questions)!`);
        if (andPlay) {
          onPlayQuiz(res.quiz.id);
        } else {
          setTimeout(() => setSaveStatus(''), 2500);
        }
      } else {
        setSaveStatus(`Failed to save: ${res?.error || 'Unknown error'}`);
      }
    });
  };

  const handleExportJson = () => {
    const quizData = prepareQuizData();
    const blob = new Blob([JSON.stringify(quizData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quizData.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.quiz.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const curQ = questions[activeIdx] || EMPTY_QUESTION;

  return (
    <div>
      {/* Top Bar */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem' }} onClick={onExit}>
              ← Back
            </button>
            <span className="badge badge-primary">✏️ Teacher Quiz Editor</span>
            {saveStatus && <span className="badge" style={{ background: 'var(--success-light)', color: 'var(--success-text)', borderColor: 'var(--success)' }}>{saveStatus}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem' }} onClick={loadSampleArithmetic}>
              Load Sample 10-Q Quiz
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem' }} onClick={handleExportJson}>
              📥 Export JSON
            </button>
          </div>
        </div>
      </div>

      <div className="editor-grid">
        {/* Left Column: Quiz Info & Questions List */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Quiz Title
            </label>
            <input
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Mathematics Practice Test"
            />
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Seconds Per Question
            </label>
            <select
              className="input-field"
              value={timeLimitSec}
              onChange={(e) => setTimeLimitSec(Number(e.target.value))}
            >
              <option value={15}>15 seconds</option>
              <option value={20}>20 seconds (Default)</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <strong>Questions ({questions.length})</strong>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '4px 10px', fontSize: '0.85rem' }}
              onClick={handleAddQuestion}
            >
              + Add
            </button>
          </div>

          <div
            className="custom-scrollbar"
            style={{
              maxHeight: 340,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingRight: 4,
            }}
          >
            {questions.map((q, idx) => (
              <div
                key={idx}
                onClick={() => setActiveIdx(idx)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: idx === activeIdx ? 'var(--primary-light)' : 'var(--surface-raised)',
                  border: idx === activeIdx ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  color: idx === activeIdx ? 'var(--primary)' : 'var(--text-main)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
                  #{idx + 1} {q.lead || 'Untitled Question'}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {q.points || 100} pts · {String.fromCharCode(65 + q.correctIndex)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => handleSaveToDb(false)}>
              💾 Save Quiz
            </button>
            <button className="btn" style={{ background: '#10b981' }} onClick={() => handleSaveToDb(true)}>
              ▶ Save & Host Room
            </button>
          </div>
        </div>

        {/* Right Column: Question Editor */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span className="badge badge-primary">
              Editing Question #{activeIdx + 1} of {questions.length}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem' }}
                onClick={() => handleDuplicate(activeIdx)}
              >
                Duplicate
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem', color: 'var(--danger)' }}
                disabled={questions.length <= 1}
                onClick={() => handleDelete(activeIdx)}
              >
                Delete
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                Case / Scenario Text (Optional Stem)
              </label>
              <input
                className="input-field"
                value={curQ.stem}
                onChange={(e) => updateActive('stem', e.target.value)}
                placeholder="e.g. A student is practicing single-digit multiplication."
              />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                Points Value
              </label>
              <input
                type="number"
                min={10}
                step={10}
                className="input-field"
                value={curQ.points ?? 100}
                onChange={(e) => updateActive('points', Number(e.target.value) || 100)}
                placeholder="100"
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              Question Prompt (Visible to all)
            </label>
            <input
              className="input-field"
              value={curQ.lead}
              onChange={(e) => updateActive('lead', e.target.value)}
              placeholder="e.g. What is 3 × 3?"
            />
          </div>

          <div style={{ margin: '14px 0 6px 0' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              Options (Tick the radio button for the correct answer)
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {curQ.options.map((opt, i) => {
              const isCorrect = curQ.correctIndex === i;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: isCorrect ? '2px solid var(--success)' : '1px solid var(--border)',
                    background: isCorrect ? 'var(--success-light)' : 'var(--surface-raised)',
                  }}
                >
                  <input
                    type="radio"
                    name={`correct-opt-${activeIdx}`}
                    checked={isCorrect}
                    onChange={() => updateActive('correctIndex', i)}
                    style={{ cursor: 'pointer', width: 18, height: 18 }}
                  />
                  <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                  <input
                    className="input-field"
                    style={{ margin: 0, background: 'transparent' }}
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  />
                  {isCorrect && (
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success-text)', flexShrink: 0 }}>
                      ✓ Correct
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              Explanation (Shown after question closes)
            </label>
            <input
              className="input-field"
              value={curQ.explain}
              onChange={(e) => updateActive('explain', e.target.value)}
              placeholder="e.g. 3 × 3 = 9. Option C is correct."
            />
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              Fact Source Link
            </label>
            <input
              className="input-field"
              value={curQ.sourceUrl}
              onChange={(e) => updateActive('sourceUrl', e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
