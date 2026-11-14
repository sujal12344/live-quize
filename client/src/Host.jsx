import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { socket } from './socket.js';

export default function Host({ onExit, onOpenEditor, initialQuizId }) {
  const [roomCode, setRoomCode] = useState(() => sessionStorage.getItem('host_room_code') || '');
  const [hostToken, setHostToken] = useState(() => sessionStorage.getItem('host_token') || '');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const attemptRejoin = useCallback(() => {
    if (!roomCode || !hostToken) return;
    socket.timeout(8000).emit('host:rejoin', { roomCode, hostToken }, (err, res) => {
      if (err) {
        setError('Connection timed out. Tap Retry.');
        return;
      }
      if (res?.ok) {
        setState(res.state);
        setError('');
      } else {
        sessionStorage.removeItem('host_room_code');
        sessionStorage.removeItem('host_token');
        setRoomCode('');
        setHostToken('');
        setState(null);
        setError(res?.error || 'Host session expired.');
      }
    });
  }, [roomCode, hostToken]);

  useEffect(() => {
    if (socket.connected) attemptRejoin();
    socket.on('connect', attemptRejoin);
    return () => socket.off('connect', attemptRejoin);
  }, [attemptRejoin]);

  useEffect(() => {
    const onHostState = (nextState) => {
      setState(nextState);
      setError('');
    };
    socket.on('host:state', onHostState);
    return () => socket.off('host:state', onHostState);
  }, []);

  // Generate QR code whenever roomCode is set
  useEffect(() => {
    if (!roomCode) {
      setQrUrl('');
      return;
    }
    const joinUrl = `${window.location.origin}/?join=${roomCode}`;
    QRCode.toDataURL(joinUrl, { width: 240, margin: 2 }, (err, url) => {
      if (!err && url) setQrUrl(url);
    });
  }, [roomCode]);

  // If launched with an initial quiz from the editor, create room immediately
  useEffect(() => {
    if (initialQuizId && !roomCode) {
      handleCreateRoom(initialQuizId);
    }
  }, [initialQuizId]);

  // Countdown timer aligned to server's endsAt
  useEffect(() => {
    if (!state?.question?.endsAt || state.phase !== 'QUESTION') {
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((state.question.endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    update();
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
      setTimeLeft(null);
    };
  }, [state?.question?.endsAt, state?.phase]);

  const handleCreateRoom = (quizId) => {
    setError('');
    setBusy(true);
    socket.timeout(8000).emit('host:create', { quizId }, (err, res) => {
      setBusy(false);
      if (err || !res?.ok) {
        setError('Could not reach server. Please retry.');
        return;
      }
      setRoomCode(res.state.roomCode);
      setHostToken(res.hostToken);
      setState(res.state);
      sessionStorage.setItem('host_room_code', res.state.roomCode);
      sessionStorage.setItem('host_token', res.hostToken);
    });
  };

  const handleNext = () => {
    setError('');
    setBusy(true);
    socket.timeout(8000).emit('host:next', { roomCode, hostToken }, (err, res) => {
      setBusy(false);
      if (err) {
        setError('Request timed out. Please retry.');
        return;
      }
      if (!res?.ok) {
        setError(res?.error || 'Could not advance quiz.');
      }
    });
  };

  const handleCloseQuestionEarly = () => {
    socket.emit('host:close_question', { roomCode, hostToken }, (res) => {
      if (!res?.ok) setError(res?.error || 'Could not close question.');
    });
  };

  const handleAddTime = (seconds = 15) => {
    if (state?.question?.endsAt) {
      const newEndsAt = Math.max(Date.now() + 5000, Number(state.question.endsAt) + seconds * 1000);
      setState((prev) => (prev ? {
        ...prev,
        question: { ...prev.question, endsAt: newEndsAt },
      } : prev));
    }
    socket.emit('host:add_time', { roomCode, hostToken, seconds }, (res) => {
      if (!res?.ok) setError(res?.error || 'Could not add time.');
    });
  };

  const handleDownloadCsv = () => {
    if (!state?.leaderboard || state.leaderboard.length === 0) return;
    const rows = [
      ['Rank', 'Student Name', 'Score (pts)'],
      ...state.leaderboard.map((p, idx) => [idx + 1, `"${p.name.replace(/"/g, '""')}"`, p.score]),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `quiz_results_${roomCode}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyJoinLink = () => {
    const joinUrl = `${window.location.origin}/?join=${roomCode}`;
    navigator.clipboard?.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const clearSessionAndExit = () => {
    sessionStorage.removeItem('host_room_code');
    sessionStorage.removeItem('host_token');
    onExit();
  };

  if (!roomCode || !state) {
    return (
      <div className="card" style={{ maxWidth: 540, margin: '24px auto', padding: '36px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '7px 16px', fontSize: '0.85rem' }}
            onClick={clearSessionAndExit}
          >
            ← Back
          </button>
          <span className="badge badge-primary">Presenter / Projector Setup</span>
        </div>

        <h2 style={{ marginTop: 0, fontSize: '1.8rem', fontWeight: 800 }}>Host a Classroom Quiz</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 28 }}>
          Project this display on the classroom screen. Students will scan a QR code to join from their phones.
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            className="btn"
            style={{ padding: '18px 20px', fontSize: '1.15rem' }}
            onClick={onOpenEditor}
          >
            ✏️ Open Quiz Editor to Set & Launch Quiz
          </button>
        </div>
      </div>
    );
  }

  const joinUrl = `${window.location.origin}/?join=${roomCode}`;

  return (
    <div>
      {/* Top Bar */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="live-dot" title="Live Server Connected"></span>
            <strong style={{ fontSize: '1.1rem' }}>{state.quizTitle}</strong>
            <span className="badge badge-primary">Room {roomCode}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="badge">
              <strong>{state.playerCount}</strong> connected
            </span>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem' }}
              onClick={clearSessionAndExit}
            >
              Exit
            </button>
          </div>
        </div>
        {error && (
          <div className="banner banner-error" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>{error}</span>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
              onClick={attemptRejoin}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Phase 1: Lobby with QR Code & Presenter Cards */}
      {state.phase === 'LOBBY' && (
        <div className="host-grid">
          {/* Left Card: QR Code & Code */}
          <div className="card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {qrUrl && (
              <img
                src={qrUrl}
                alt={`Scan QR to join room ${roomCode}`}
                style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--border)' }}
              />
            )}
            <p style={{ margin: '12px 0 4px 0', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
              Scan to join · or enter code
            </p>
            <div className="code-display" style={{ margin: '6px 0', padding: '10px 24px', fontSize: '2.6rem' }}>
              {roomCode}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{joinUrl}</span>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
                onClick={copyJoinLink}
              >
                {copied ? '✓ Copied!' : 'Copy link'}
              </button>
            </div>

            <div style={{ marginTop: 16, fontWeight: 600, color: 'var(--text-main)' }}>
              {state.playerCount === 0
                ? '0 students connected'
                : `${state.playerCount} student${state.playerCount === 1 ? '' : 's'} connected`}
            </div>

            {state.playerCount > 0 && (
              <div className="player-chips" style={{ marginTop: 8 }}>
                {state.players.map((name, i) => (
                  <span key={i} className="player-chip">
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right Card: Quiz Overview & Controls */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '1.3rem' }}>{state.quizTitle}</h3>
                  <span className="badge">10 questions · 20s per question</span>
                </div>
              </div>

              <div style={{ marginTop: 24, padding: '16px', background: 'var(--surface-raised)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
                  Presenter Instructions:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                  <li>Ask students to point their phone cameras at the QR code.</li>
                  <li>Their phones open directly with the room code prefilled.</li>
                  <li>Once all students appear, click <strong>Start quiz ▶</strong>.</li>
                </ul>
              </div>
            </div>

            <button
              className="btn"
              style={{ marginTop: 28, fontSize: '1.2rem', padding: '16px' }}
              disabled={busy || state.playerCount === 0}
              onClick={handleNext}
            >
              {state.playerCount === 0 ? 'Waiting for students...' : 'Start quiz ▶'}
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Active Question */}
      {state.phase === 'QUESTION' && state.question && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge badge-primary">
              Question {state.question.index + 1} of {state.question.total} ({state.question.points || 100} pts)
            </span>
            <span className="badge badge-timer">
              ⏱ {timeLeft ?? 20}s
            </span>
          </div>

          {state.question.stem && (
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', margin: '16px 0 8px 0' }}>
              {state.question.stem}
            </p>
          )}
          <h1 style={{ margin: '8px 0 24px 0', fontSize: '2.2rem', fontWeight: 800 }}>
            {state.question.prompt}
          </h1>

          <div>
            {state.question.options.map((opt, i) => {
              const voteCount = state.liveOptionCounts?.[i] ?? 0;
              return (
                <div
                  key={i}
                  className="btn-option"
                  style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{opt}</span>
                  </div>
                  {voteCount > 0 && (
                    <span className="badge badge-primary" style={{ fontSize: '0.85rem', maxWidth: '60%', textAlign: 'right', whiteSpace: 'normal', height: 'auto', lineHeight: 1.3, padding: '6px 12px' }}>
                      👤 {state.liveOptionStudentNames?.[i]?.join(', ')} ({voteCount})
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live Student Real-Time Choice Stream */}
          {state.liveEvents && state.liveEvents.length > 0 && (
            <div
              style={{
                marginTop: 18,
                padding: '12px 16px',
                background: 'var(--surface-raised)',
                borderRadius: 12,
                border: '2px solid var(--border)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                📡 Live Student Actions (Real-Time)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 85, overflowY: 'auto' }}>
                {state.liveEvents.map((ev, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      color: ev.type === 'change' ? '#f59e0b' : 'var(--text-main)',
                    }}
                  >
                    {ev.type === 'change' ? '🔄 ' : '🟢 '} {ev.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Teacher Question Controls: Extra Time & Early Close */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 20,
            }}
          >
            <div style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.95rem' }}>
              Answers: <strong>{state.answeredCount}</strong> / {state.playerCount}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }}
                onClick={() => handleAddTime(15)}
                title="Add 15 extra seconds for students"
              >
                ⏱ +15s Extra Time
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }}
                onClick={() => handleAddTime(30)}
                title="Add 30 extra seconds for students"
              >
                ⏱ +30s Extra Time
              </button>
              <button
                className="btn"
                style={{ width: 'auto', padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={handleCloseQuestionEarly}
                title="Close question early and reveal answer"
              >
                Close Question Early →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 3: Reveal Answer & Leaderboard */}
      {state.phase === 'REVEALED' && state.question && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge" style={{ background: 'var(--success-light)', color: 'var(--success-text)', borderColor: 'var(--success)' }}>
              Question {state.question.index + 1} Closed (+{state.reveal?.points || 100} pts)
            </span>
          </div>

          <h2 style={{ margin: '14px 0 20px 0' }}>{state.question.prompt}</h2>

          <div>
            {state.question.options.map((opt, i) => {
              const isCorrect = i === state.reveal?.correctIndex;
              return (
                <div
                  key={i}
                  className={`btn-option ${isCorrect ? 'correct' : ''}`}
                  style={{ cursor: 'default' }}
                >
                  <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1, fontSize: '1.15rem' }}>{opt}</span>
                  {state.liveOptionStudentNames?.[i]?.length > 0 && (
                    <span className="badge" style={{ fontSize: '0.85rem', marginRight: 10, background: 'var(--surface-raised)' }}>
                      👤 {state.liveOptionStudentNames[i].join(', ')}
                    </span>
                  )}
                  {isCorrect && <span style={{ fontWeight: 700 }}>✔ Correct Answer</span>}
                </div>
              );
            })}
          </div>

          {state.reveal?.explanation && (
            <div className="explain-box">
              <strong>Explanation:</strong> {state.reveal.explanation}
            </div>
          )}

          {state.reveal?.sourceUrl && (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', wordBreak: 'break-word' }}>
              Fact source:{' '}
              <a href={state.reveal.sourceUrl} target="_blank" rel="noreferrer">
                {state.reveal.sourceUrl}
              </a>
            </p>
          )}

          <h3 style={{ margin: '24px 0 12px 0' }}>Classroom Leaderboard</h3>
          <ul className="leaderboard-list">
            {state.leaderboard.map((item, idx) => (
              <li key={item.id || idx} className={`leaderboard-item ${idx === 0 ? 'rank-1' : ''}`}>
                <span>
                  {idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `#${idx + 1} `}
                  <strong>{item.name}</strong>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {item.lastResponseSec && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      ⚡ {item.lastResponseSec}s
                    </span>
                  )}
                  <span className="badge badge-primary">{item.score} pts</span>
                </div>
              </li>
            ))}
          </ul>

          <button className="btn" disabled={busy} style={{ marginTop: 18 }} onClick={handleNext}>
            {state.question.index + 1 >= state.question.total
              ? 'View Final Podium 🏆'
              : 'Next Question →'}
          </button>
        </div>
      )}

      {/* Phase 4: Final Rankings & Results Analytics */}
      {state.phase === 'FINAL' && (
        <div className="host-grid">
          {/* Left Card: Summary Stats & Actions */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <span className="badge badge-primary" style={{ marginBottom: 14 }}>
                Quiz Results Completed
              </span>

              {(() => {
                const totalScore = state.leaderboard.reduce((acc, p) => acc + (p.score || 0), 0);
                const maxPossible = (state.question?.total || 10) * 100 * (state.leaderboard.length || 1);
                const classAvgPct = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0;
                return (
                  <div>
                    <div style={{ fontSize: '3.6rem', fontWeight: 900, color: 'var(--primary)', lineHeight: 1 }}>
                      {classAvgPct}%
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, margin: '8px 0 16px 0', color: 'var(--text-muted)' }}>
                      class average · {state.playerCount} student{state.playerCount === 1 ? '' : 's'} · {state.question?.total || 10} questions
                    </div>
                  </div>
                );
              })()}

              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.5 }}>
                Each student now sees their private score on their phone screen.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              <button className="btn" onClick={handleDownloadCsv}>
                📥 Download Results (CSV)
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  sessionStorage.removeItem('host_room_code');
                  sessionStorage.removeItem('host_token');
                  setRoomCode('');
                  setHostToken('');
                  setState(null);
                  handleCreateRoom(state.quizTitle);
                }}
              >
                🔄 Run Quiz Again (New Session)
              </button>
              <button className="btn btn-secondary" onClick={clearSessionAndExit}>
                ← Return to Home
              </button>
            </div>
          </div>

          {/* Right Card: Leaderboard & Questions Breakdown */}
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.4rem' }}>🏆 Classroom Leaderboard</h2>

            <ul className="leaderboard-list">
              {state.leaderboard.map((item, idx) => (
                <li
                  key={item.id}
                  className={`leaderboard-item ${idx === 0 ? 'rank-1' : ''}`}
                  style={{ fontSize: idx === 0 ? '1.25rem' : '1.05rem' }}
                >
                  <span>
                    {idx === 0 ? '🥇 #1 ' : idx === 1 ? '🥈 #2 ' : idx === 2 ? '🥉 #3 ' : `#${idx + 1} `}
                    <strong>{item.name}</strong>
                  </span>
                  <span className="badge badge-primary">{item.score} pts</span>
                </li>
              ))}
            </ul>

            {state.questionBreakdown && state.questionBreakdown.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Questions by % Correct</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {state.questionBreakdown.map((qb) => (
                    <div key={qb.questionIndex} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 36, fontWeight: 700, fontSize: '0.9rem' }}>Q{qb.questionIndex + 1}</span>
                      <div
                        style={{
                          flex: 1,
                          height: 12,
                          background: 'var(--surface-raised)',
                          borderRadius: 9999,
                          overflow: 'hidden',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div
                          style={{
                            width: `${qb.percent}%`,
                            height: '100%',
                            background: qb.percent >= 70 ? 'var(--success)' : qb.percent >= 40 ? '#f59e0b' : 'var(--danger)',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, width: 44, textAlign: 'right' }}>
                        {qb.percent}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
