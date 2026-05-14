import React, { useState } from 'react';
import { loginUser, initializeUserKeyMaterial } from '../services/api';
import '../App.css';

function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await loginUser(username, password);
      if (result.success) {
        await initializeUserKeyMaterial(result.username, password, result.isNewUser);
        // Call callback to refresh session state in parent
        // App.js will update 'loggedIn' to true and handle the redirect automatically
        if (onLoginSuccess) {
          await onLoginSuccess();
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Messaging App</h1>
        <p>Login or create an account</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username:</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password:</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Login'}
          </button>
        </form>

        <p className="info-text">
          New accounts require 8+ characters and at least 3 of: uppercase, lowercase, number, symbol.
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
