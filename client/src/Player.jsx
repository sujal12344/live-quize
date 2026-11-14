import { useCallback, useEffect, useState } from 'react';
import { socket } from './socket.js';

const STORAGE_KEY = 'live_quiz_player';

function loadSavedPlayer() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const fromQuery = urlParams.get('join')?.trim().toUpperCase();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (fromQuery && parsed?.roomCode && fromQuery !== parsed.roomCode) {
      // User tapped a link / scanned QR for a different room!
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getInitialRoomCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('join');
  if (fromQuery) return fromQuery.trim().toUpperCase();

  const hash = window.location.hash;
  if (hash.startsWith('#join=')) {
    return hash.slice(6).trim().toUpperCase();
  }
  return '';
}

export default function Player({ onExit }) {
  const [saved, setSaved] = useState(loadSavedPlayer);
  const [roomInput, setRoomInput] = useState(getInitialRoomCode);
  const [nameInput, setNameInput] = useState(() => localStorage.getItem('live_quiz_player_name') || '');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);

  const attemptRejoin = useCallback(() => {
    if (!saved?.roomCode || !saved?.playerToken) return;
    setBusy(true);
    socket.timeout(8000).emit(
      'player:rejoin',
      { roomCode: saved.roomCode, playerToken: saved.playerToken },
      (err, res) => {
        setBusy(false);
        if (err) {
          setError('Could not reach server to restore your session. Tap Retry.');
          return;
        }
        if (res?.ok) {
          setState(res.state);
          setError('');
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setSaved(null);
          setState(null);
          setError(res?.error || 'Game session ended. Please join again.');
        }
      }
    );
  }, [saved]);

  useEffect(() => {
    if (socket.connected) attemptRejoin();
    socket.on('connect', attemptRejoin);
    return () => socket.off('connect', attemptRejoin);
  }, [attemptRejoin]);

  useEffect(() => {
    const onPlayerState = (nextState) => {
      setState(nextState);
      setError('');
    };
    socket.on('player:state', onPlayerState);
    return () => socket.off('player:state', onPlayerState);
  }, []);

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

  const handleJoin = (e) => {
    e.preventDefault();
    const cleanCode = roomInput.trim().toUpperCase();
    const cleanName = nameInput.trim();
    if (!cleanCode || !cleanName) {
      setError('Please enter both the Room Code and your Name.');
      return;
    }

    setError('');
    setBusy(true);
    socket.timeout(8000).emit('player:join', { roomCode: cleanCode, name: cleanName }, (err, res) => {
      setBusy(false);
      if (err) {
        setError('Connection timed out. Tap Join again.');
        return;
      }
      if (!res?.ok) {
        setError(res?.error || 'Could not join room.');
        return;
      }
      const session = { roomCode: cleanCode, playerToken: res.playerToken };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      localStorage.setItem('live_quiz_player_name', cleanName);
      setSaved(session);
      setState(res.state);
    });
  };

  const handleAnswer = (optionIndex) => {
    if (!saved || state?.phase !== 'QUESTION' || timeLeft === 0) return;
    setError('');
    // Instant optimistic visual feedback (0ms)
    setState((prev) => (prev ? { ...prev, selectedOption: optionIndex } : prev));
    setBusy(true);
    socket.timeout(8000).emit(
      'player:answer',
      {
        roomCode: saved.roomCode,
        playerToken: saved.playerToken,
        optionIndex,
      },
      (err, res) => {
        setBusy(false);
        if (err) {
          setError('Failed to send answer. Tap your option again to retry.');
          return;
        }
        if (!res?.ok) {
          setError(res?.error || 'Answer was not accepted.');
          return;
        }
        setState(res.state);
      }
    );
  };

  const leaveGame = () => {
    localStorage.removeItem(STORAGE_KEY);
    if (window.location.search.includes('join')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setSaved(null);
    setState(null);
    setError('');
    onExit();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Rejoin loading state
  if (saved && !state) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <h2>Restoring Session...</h2>
        <p style={{ color: 'var(--text-muted)' }}>Reconnecting to Room {saved.roomCode}...</p>
        {error ? (
          <>
            <div className="banner banner-error">{error}</div>
            <button className="btn" onClick={attemptRejoin} disabled={busy}>
              {busy ? 'Retrying...' : 'Retry Rejoin'}
            </button>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={leaveGame}
            >
              Enter New Room Code
            </button>
          </>
        ) : (
          <button
            className="btn btn-secondary"
            style={{ marginTop: 16 }}
            onClick={leaveGame}
          >
            Cancel & Join Different Room
          </button>
        )}
      </div>
    );
  }

  // Join form
  if (!state) {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '7px 16px', fontSize: '0.85rem' }}
            onClick={() => {
              if (window.location.search.includes('join')) {
                window.history.replaceState({}, '', window.location.pathname);
              }
              onExit();
            }}
          >
            ← Back
          </button>
          <span className="badge badge-primary">Player / Phone Mode</span>
        </div>

        <h2 style={{ marginTop: 0 }}>Join Classroom Quiz</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          Enter the 4-letter room code shown on the screen, or join via scanned QR code.
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        <form onSubmit={handleJoin}>
          <label htmlFor="roomCode" style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            Room Code
          </label>
          <input
            id="roomCode"
            className="input-field"
            placeholder="e.g. ABCD"
            maxLength={6}
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
          />

          <label htmlFor="playerName" style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            Your Nickname
          </label>
          <input
            id="playerName"
            className="input-field"
            placeholder="e.g. Alex"
            maxLength={20}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            autoComplete="off"
          />

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Joining Room...' : 'Enter Game →'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      {/* Player Header */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{state.name}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: 6 }}>
              (Room {state.roomCode})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
              onClick={toggleFullscreen}
              title="Toggle Fullscreen Mode"
            >
              ⛶
            </button>
            <span className="badge badge-primary" style={{ fontSize: '1rem', padding: '6px 14px' }}>
              {state.score} pts
            </span>
          </div>
        </div>
        {error && (
          <div className="banner banner-error" style={{ marginTop: 10, marginBottom: 0 }}>
            <span>{error}</span>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem' }}
              onClick={attemptRejoin}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Lobby */}
      {state.phase === 'LOBBY' && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <span className="badge badge-primary" style={{ marginBottom: 12 }}>
            Connected
          </span>
          <h2 style={{ margin: '6px 0 12px 0' }}>You're In!</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', margin: 0 }}>
            Look at the projector screen. The teacher will start the quiz shortly.
          </p>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 28 }}
            onClick={leaveGame}
          >
            Leave Room
          </button>
        </div>
      )}

      {/* Question Open */}
      {state.phase === 'QUESTION' && state.question && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span className="badge badge-primary">
              Q{state.question.index + 1} of {state.question.total}
            </span>
            <span className="badge badge-timer">
              ⏱ {timeLeft ?? 20}s
            </span>
          </div>

          <h2 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', fontWeight: 800 }}>
            {state.question.prompt}
          </h2>

          <div>
            {state.question.options.map((opt, i) => {
              const isPicked = state.selectedOption === i;
              return (
                <button
                  key={i}
                  className={`btn-option ${isPicked ? 'selected' : ''}`}
                  disabled={busy || state.phase !== 'QUESTION' || timeLeft === 0}
                  onClick={() => handleAnswer(i)}
                  style={{ width: '100%' }}
                >
                  <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1, fontSize: '1.15rem' }}>{opt}</span>
                  {isPicked && <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>SELECTED ✓</span>}
                </button>
              );
            })}
          </div>

          {state.selectedOption !== null && (
            <p style={{ textAlign: 'center', fontWeight: 700, color: 'var(--primary)', margin: '14px 0 0 0' }}>
              ✓ Option {String.fromCharCode(65 + state.selectedOption)} selected! (You can switch your answer before time runs out: {timeLeft ?? 0}s)
            </p>
          )}
        </div>
      )}

      {/* Revealed */}
      {state.phase === 'REVEALED' && state.question && state.reveal && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div
            style={{
              padding: '16px',
              borderRadius: 12,
              background: state.reveal.isCorrect ? 'var(--success-light)' : 'var(--danger-light)',
              color: state.reveal.isCorrect ? 'var(--success-text)' : 'var(--danger-text)',
              border: `1.5px solid ${state.reveal.isCorrect ? 'var(--success)' : 'var(--danger)'}`,
              marginBottom: 18,
            }}
          >
            <h2 style={{ margin: 0 }}>
              {state.reveal.isCorrect
                ? `🎉 Correct! +${state.reveal.points || state.question.points || 100} pts`
                : state.reveal.closedEarly
                ? '🛑 Question Closed by Host'
                : state.selectedOption === null
                ? "⏰ Time's Up!"
                : '❌ Incorrect'}
            </h2>
          </div>

          <div style={{ textAlign: 'left', margin: '14px 0' }}>
            {state.question.options.map((opt, i) => {
              const isCorrect = i === state.reveal.correctIndex;
              const isWrongPick = i === state.selectedOption && !isCorrect;
              const cls = isCorrect ? 'correct' : isWrongPick ? 'wrong' : '';
              return (
                <div key={i} className={`btn-option ${cls}`} style={{ cursor: 'default' }}>
                  <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1 }}>{opt}</span>
                  {isCorrect && <span style={{ fontWeight: 700 }}>✔ Correct</span>}
                  {isWrongPick && <span style={{ fontWeight: 700 }}>✗ Your Choice</span>}
                </div>
              );
            })}
          </div>

          {state.reveal.explanation && (
            <div className="explain-box" style={{ textAlign: 'left' }}>
              <strong>Why:</strong> {state.reveal.explanation}
            </div>
          )}

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '16px 0 0 0' }}>
            Next question will begin on host's command.
          </p>
        </div>
      )}

      {/* Final */}
      {state.phase === 'FINAL' && (
        <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <span className="badge badge-primary" style={{ marginBottom: 12 }}>
            Game Over
          </span>
          <h2 style={{ margin: '6px 0' }}>Quiz Finished!</h2>
          <div
            style={{
              fontSize: '2.8rem',
              fontWeight: 800,
              color: 'var(--primary)',
              margin: '12px 0',
            }}
          >
            {state.score} pts
          </div>
          <p style={{ color: 'var(--text-muted)' }}>
            Look at the projector screen to see the final winner & rankings!
          </p>
          <button className="btn" style={{ marginTop: 20 }} onClick={leaveGame}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
