import { useEffect, useState } from 'react';
import Host from './Host.jsx';
import Player from './Player.jsx';
import QuizEditor from './QuizEditor.jsx';
import { socket } from './socket.js';

function getRouteFromUrl() {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search;
  const hash = window.location.hash;
  if (path.startsWith('/host')) return 'host';
  if (path.startsWith('/editor')) return 'editor';
  if (path.startsWith('/join') || search.includes('join') || hash.startsWith('#join=')) return 'player';
  if (sessionStorage.getItem('host_room_code')) return 'host';
  if (localStorage.getItem('live_quiz_player')) return 'player';
  return 'home';
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app_theme') || 'dark';
  });

  const [route, setRoute] = useState(getRouteFromUrl);
  const [customQuizId, setCustomQuizId] = useState(null);

  const [connStatus, setConnStatus] = useState(
    socket.connected ? 'connected' : 'connecting'
  );
  const [connError, setConnError] = useState('');

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Synchronize route with browser history (popstate for Back/Forward)
  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setRoute(getRouteFromUrl());
  };

  useEffect(() => {
    const onPopState = () => {
      setRoute(getRouteFromUrl());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnStatus('connected');
      setConnError('');
    };
    const onDisconnect = () => {
      setConnStatus('disconnected');
      setConnError('Connection to quiz server was interrupted.');
    };
    const onConnectError = () => {
      setConnStatus('error');
      setConnError('Unable to connect to quiz server.');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  const handleRetryConnection = () => {
    setConnStatus('connecting');
    setConnError('');
    socket.disconnect();
    socket.connect();
  };

  const handlePlayCustomQuiz = (quizId) => {
    setCustomQuizId(quizId);
    navigate('/host');
  };

  const handleReturnHome = () => {
    navigate('/');
  };

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={handleReturnHome}
        >
          <span className="live-dot" title="Live System Connected"></span>
          <strong style={{ fontSize: '1.25rem', letterSpacing: '-0.02em', fontWeight: 900 }}>Live Classroom Quiz</strong>
        </div>

        {/* Action controls on the far right: Theme Toggle only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="top-bar-btn" onClick={toggleTheme} title="Toggle Dark/Light Mode">
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>

      {/* Rule 4: Connection banner with working Retry (shown when disconnected or error) */}
      {(connStatus === 'error' || connStatus === 'disconnected') && (
        <div className="banner banner-error">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span>
            <span>{connError || 'Unable to connect to quiz server.'}</span>
          </div>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={handleRetryConnection}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Page: Host Screen */}
      {route === 'host' && (
        <Host
          initialQuizId={customQuizId}
          onOpenEditor={() => navigate('/editor')}
          onExit={handleReturnHome}
        />
      )}

      {/* Page: Player Screen */}
      {route === 'player' && <Player onExit={handleReturnHome} />}

      {/* Page: Quiz Editor (Host Setup) */}
      {route === 'editor' && (
        <QuizEditor
          onExit={handleReturnHome}
          onPlayQuiz={handlePlayCustomQuiz}
        />
      )}

      {/* Page: Clean 2-Option Home Screen (1st: Host on Projector, 2nd: Join as Player) */}
      {route === 'home' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div
              style={{
                display: 'inline-flex',
                padding: '6px 16px',
                background: 'var(--primary-light)',
                borderRadius: '10px',
                color: 'var(--primary)',
                fontWeight: 800,
                fontSize: '0.85rem',
                marginBottom: 14,
                border: '2px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              ⚡ Live Classroom Quiz System
            </div>
            <h1
              style={{
                margin: '0 0 12px 0',
                fontSize: '2.5rem',
                fontWeight: 900,
                letterSpacing: '-0.03em',
              }}
            >
              Interactive Classroom Quiz
            </h1>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '1.05rem',
                margin: '0 auto',
                maxWidth: 480,
                lineHeight: 1.5,
              }}
            >
              Teachers host and project live questions with instant timers. Students join on mobile data with room codes and locked answers.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 20,
              maxWidth: 720,
              margin: '0 auto',
            }}
          >
            {/* Option 1: Host on Projector */}
            <div
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '32px 26px',
                marginBottom: 0,
              }}
            >
              <div>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🖥️</div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', fontWeight: 800 }}>
                  Host on Projector
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                  For teachers and mentors. Set up or review your quiz, then launch the live projector screen with PIN & QR code.
                </p>
              </div>
              <button
                className="btn"
                style={{ padding: '14px 20px', fontSize: '1.05rem' }}
                onClick={() => {
                  if (sessionStorage.getItem('host_room_code')) {
                    navigate('/host');
                  } else {
                    navigate('/editor');
                  }
                }}
              >
                Host & Set Up Quiz →
              </button>
            </div>

            {/* Option 2: Join as Player */}
            <div
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '32px 26px',
                marginBottom: 0,
              }}
            >
              <div>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📱</div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', fontWeight: 800 }}>
                  Join as Player
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                  Join on phone or tablet. Enter your nickname and the room code shown on the screen to submit answers in real time.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: '14px 20px', fontSize: '1.05rem' }}
                onClick={() => navigate('/join')}
              >
                Join as Student →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
