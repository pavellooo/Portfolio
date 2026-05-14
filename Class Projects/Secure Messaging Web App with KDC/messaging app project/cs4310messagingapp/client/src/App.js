import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { getSession } from './services/api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import './App.css';

function App() {
  const [loggedIn, setLoggedIn] = useState(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Check session status on app load
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const session = await getSession();
      if (session.loggedIn) {
        setLoggedIn(true);
        setUsername(session.username);
        setDisplayName(session.displayName || session.username || '');
        setIsAdmin(session.isAdmin || false);
      } else {
        setLoggedIn(false);
        setUsername('');
        setDisplayName('');
        setIsAdmin(false);
      }
    } catch (error) {
      console.error('Session check error:', error);
      setLoggedIn(false);
      setUsername('');
      setDisplayName('');
      setIsAdmin(false);
    }
  };

  // Show loading state while checking session
  if (loggedIn === null) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {loggedIn ? (
          <>
            <Route path="/dashboard" element={<DashboardPage username={username} displayName={displayName} isAdmin={isAdmin} onLogout={checkSession} />} />
            <Route path="/" element={<Navigate to="/dashboard" />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </>
        ) : (
          <>
            <Route path="/" element={<LoginPage onLoginSuccess={checkSession} />} />
            <Route path="/dashboard" element={<Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>
        )}
      </Routes>
    </Router>
  );
}

export default App;
