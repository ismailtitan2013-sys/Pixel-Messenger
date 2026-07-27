import {StrictMode, useState, useEffect, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function AppWithContainer({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleErr = (event: ErrorEvent) => {
      console.error('Global error caught:', event.error);
      setError(event.error?.message || event.message || 'Ошибка выполнения');
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled rejection caught:', event.reason);
    };

    window.addEventListener('error', handleErr);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleErr);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (error) {
    return (
      <div style={{
        padding: '40px',
        color: '#f8fafc',
        backgroundColor: '#0f172a',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontFamily: 'sans-serif'
      }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '16px', color: '#ef4444' }}>⚠️ Ошибка при загрузке приложения</h1>
        <p style={{ color: '#cbd5e1', maxWidth: '500px', marginBottom: '24px' }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          Обновить страницу
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWithContainer>
      <App />
    </AppWithContainer>
  </StrictMode>,
);
