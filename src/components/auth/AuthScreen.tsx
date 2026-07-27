import React, { useState } from 'react';

interface AuthScreenProps {
  onLogin: (username: string, password?: string) => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleAuth = async () => {
    const u = loginUsername.trim();
    if (!u) return alert('Введите имя пользователя');
    await onLogin(u, loginPassword.trim());
  };

  return (
    <div id="auth-screen">
      <div className="auth-box">
        <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <i className="fas fa-bolt" style={{ color: '#3b82f6' }} /> Pixel Messenger
        </h2>
        <input
          type="text"
          placeholder="Имя пользователя (без пробелов)"
          value={loginUsername}
          onChange={(e) => setLoginUsername(e.target.value.replace(/\s/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
        />
        <input
          type="password"
          placeholder="Пароль (опционально, но рекомендуется)"
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
        />
        <button onClick={handleAuth}>
          <i className="fas fa-sign-in-alt" /> Войти / Зарегистрироваться
        </button>
        <p style={{ marginTop: '14px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Если аккаунта нет, он будет создан автоматически.
        </p>
      </div>
    </div>
  );
};
