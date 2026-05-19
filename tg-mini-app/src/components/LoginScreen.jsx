// ═════════════════════════════════════════════════════════════════════
// ЭКРАН ВХОДА — STAGE V (ВИЗУАЛЬНОЕ ОФОРМЛЕНИЕ) — ИСПРАВЛЕННАЯ ВЕРСИЯ
// Master Coffee Procurement OS
// ═════════════════════════════════════════════════════════════════════

function LoginScreen({ onLoginClick, loading = false, error = null }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #3BA5B8 0%, #2E8A9C 100%)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      fontFamily: '"Anthropic Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Полоса сверху с повторяющимся текстом */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.15)',
        padding: '8px 0',
        fontSize: '12px',
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.5)',
        textTransform: 'uppercase',
        letterSpacing: '2px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <span>MASTER COFFEE  •  MASTER COFFEE  •  MASTER COFFEE  •  MASTER COFFEE  •  MASTER</span>
      </div>

      {/* Центральное содержимое */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        textAlign: 'center',
      }}>
        {/* Облачко с кофейными зёрнышками - улучшенный SVG */}
        <svg width="100" height="70" viewBox="0 0 100 70" style={{ marginBottom: 32 }} xmlns="http://www.w3.org/2000/svg">
          {/* Облако - белое с градиентом */}
          <defs>
            <linearGradient id="cloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: '#FFFFFF', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: '#F5F5F5', stopOpacity: 1 }} />
            </linearGradient>
          </defs>
          
          {/* Основное облако - три выпуклости */}
          <path d="M 20 40 Q 15 40 15 35 Q 15 25 25 25 Q 30 15 40 15 Q 50 15 55 25 Q 65 25 65 35 Q 65 40 60 40 Z" 
                fill="url(#cloudGrad)" stroke="#E0E0E0" strokeWidth="0.5" />
          
          {/* Нижние выпуклости */}
          <ellipse cx="25" cy="42" rx="12" ry="10" fill="url(#cloudGrad)" stroke="#E0E0E0" strokeWidth="0.5" />
          <ellipse cx="50" cy="42" rx="12" ry="10" fill="url(#cloudGrad)" stroke="#E0E0E0" strokeWidth="0.5" />
          
          {/* Кофейные зёрнышки внутри облака - коричневые овалы */}
          {/* Верхний ряд */}
          <ellipse cx="28" cy="28" rx="3.5" ry="5.5" fill="#8B6F47" opacity="0.9" transform="rotate(-25 28 28)" />
          <ellipse cx="42" cy="24" rx="3.5" ry="5.5" fill="#9B7F57" opacity="0.9" transform="rotate(20 42 24)" />
          <ellipse cx="56" cy="28" rx="3.5" ry="5.5" fill="#8B6F47" opacity="0.9" transform="rotate(-25 56 28)" />
          
          {/* Средний ряд */}
          <ellipse cx="20" cy="38" rx="3.5" ry="5.5" fill="#7B5F37" opacity="0.85" transform="rotate(15 20 38)" />
          <ellipse cx="40" cy="35" rx="3.5" ry="5.5" fill="#9B7F57" opacity="0.9" transform="rotate(-20 40 35)" />
          <ellipse cx="62" cy="38" rx="3.5" ry="5.5" fill="#8B6F47" opacity="0.85" transform="rotate(15 62 38)" />
          
          {/* Нижний ряд */}
          <ellipse cx="32" cy="46" rx="3.5" ry="5.5" fill="#6B5435" opacity="0.8" transform="rotate(25 32 46)" />
          <ellipse cx="50" cy="48" rx="3.5" ry="5.5" fill="#7B5F37" opacity="0.8" transform="rotate(-20 50 48)" />
        </svg>

        {/* Текст логотипа */}
        <h1 style={{
          fontSize: '52px',
          fontWeight: 700,
          color: '#FFFFFF',
          margin: '0 0 8px 0',
          lineHeight: 1.2,
          letterSpacing: '-0.5px',
        }}>
          MASTER<br />COFFEE
        </h1>

        {/* Подзаголовок */}
        <p style={{
          fontSize: '12px',
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.75)',
          margin: '0 0 48px 0',
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}>
          PROCUREMENT OS
        </p>

        {/* Сообщение об ошибке */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#FFFFFF',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            marginBottom: '24px',
            maxWidth: '300px',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Нижняя часть с кнопкой */}
      <div style={{
        padding: '32px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}>
        <button
          onClick={onLoginClick}
          disabled={loading}
          style={{
            width: '100%',
            maxWidth: '320px',
            padding: '16px 24px',
            background: 'rgba(255, 255, 255, 0.95)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: 600,
            color: '#1A1814',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            transition: 'all 200ms ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          onMouseEnter={(e) => !loading && (e.target.style.background = 'rgba(255, 255, 255, 1)')}
          onMouseLeave={(e) => (e.target.style.background = 'rgba(255, 255, 255, 0.95)')}
        >
          {loading ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Загрузка...
            </>
          ) : (
            <>
              <span style={{ fontSize: '18px' }}>✈️</span>
              Войти через Telegram
            </>
          )}
        </button>

        <p style={{
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.6)',
          margin: '4px 0 0 0',
          textAlign: 'center',
        }}>
          Доступ выдаётся администратором
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default LoginScreen;
