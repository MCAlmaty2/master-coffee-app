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
      {/* Полоса сверху */}
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
        <span>CRM PLATFORM  •  CRM PLATFORM  •  CRM PLATFORM  •  CRM PLATFORM  •  CRM</span>
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
        {/* Иконка */}
        <div style={{
          width: 90,
          height: 90,
          borderRadius: 24,
          background: 'rgba(255, 255, 255, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
            <path d="M9 22v-4h6v4" />
            <path d="M8 6h.01" />
            <path d="M16 6h.01" />
            <path d="M12 6h.01" />
            <path d="M12 10h.01" />
            <path d="M12 14h.01" />
            <path d="M16 10h.01" />
            <path d="M16 14h.01" />
            <path d="M8 10h.01" />
            <path d="M8 14h.01" />
          </svg>
        </div>

        <h1 style={{
          fontSize: '52px',
          fontWeight: 700,
          color: '#FFFFFF',
          margin: '0 0 8px 0',
          lineHeight: 1.2,
          letterSpacing: '-0.5px',
        }}>
          CRM
        </h1>

        <p style={{
          fontSize: '12px',
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.75)',
          margin: '0 0 48px 0',
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}>
          OPERATIONS PLATFORM
        </p>

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
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#x27F3;</span>
              Загрузка...
            </>
          ) : (
            <>
              <span style={{ fontSize: '18px' }}>&#x2708;&#xFE0F;</span>
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
