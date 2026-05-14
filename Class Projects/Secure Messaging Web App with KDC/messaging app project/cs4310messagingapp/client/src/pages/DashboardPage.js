import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  logoutUser,
  getUsers,
  getConversations,
  openConversation,
  getConversationMessages,
  sendConversationMessage,
  resetData,
  getPersonalActivityLogs,
  updateDisplayName,
  getActiveUserKeyFromSession,
  ensureConversationSessionKey,
  getPendingSessionTicketB,
  clearPendingSessionTicketB,
  cacheConversationKeyFromTicketB,
  getKeyFingerprintBase64,
  isDevBuild,
  encryptChatMessage,
  decryptChatMessage
} from '../services/api';
import '../App.css';

function DashboardPage({ username, displayName, isAdmin, onLogout }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [startChatUserId, setStartChatUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState(displayName || '');
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [currentDisplayName, setCurrentDisplayName] = useState(displayName || username || '');
  const [resetLoading, setResetLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [userSymmetricKey, setUserSymmetricKey] = useState('');
  const devLogStateRef = useRef({});
  const navigate = useNavigate();

  useEffect(() => {
    const resolvedDisplayName = displayName || username || '';
    setCurrentDisplayName(resolvedDisplayName);
    setDisplayNameInput(resolvedDisplayName);
  }, [displayName, username]);

  const logDevKeyInfo = useCallback(async (label, keyBase64) => {
    if (!isDevBuild() || !keyBase64) {
      return;
    }

    try {
      const fingerprint = await getKeyFingerprintBase64(keyBase64);
      const previousFingerprint = devLogStateRef.current[label];
      if (previousFingerprint === fingerprint) {
        return;
      }
      devLogStateRef.current[label] = fingerprint;
      console.info(`[kdc-dev] ${label}`, {
        keyBase64,
        keyFingerprintBase64: fingerprint
      });
    } catch (error) {
      console.warn(`[kdc-dev] ${label} fingerprint failed`, error.message || error);
    }
  }, []);

  const ensureSessionKey = useCallback(async (conversation, options = {}) => {
    if (!conversation || !userSymmetricKey) {
      return null;
    }

    return ensureConversationSessionKey({
      requesterUserId: username,
      peerUserId: conversation.otherUserId || conversation.otherUsername,
      conversationId: conversation.id,
      userKeyBase64: userSymmetricKey,
      allowCreate: options.allowCreate !== false
    });
  }, [userSymmetricKey, username]);

  const handleAuthFailure = useCallback(async () => {
    setError('Session expired. Please log in again.');
    if (onLogout) {
      await onLogout();
    }
    navigate('/');
  }, [navigate, onLogout]);

  const loadDirectory = useCallback(async () => {
    try {
      const [usersList, conversationList] = await Promise.all([
        getUsers(),
        getConversations()
      ]);

      setUsers(usersList);
      setConversations(conversationList);
      if (!startChatUserId && usersList.length > 0) {
        setStartChatUserId(usersList[0].userId);
      }

      if (conversationList.length > 0 && !activeConversation) {
        setActiveConversation(conversationList[0]);
      }

      setError('');
    } catch (err) {
      if (err.status === 401) {
        await handleAuthFailure();
        return;
      }
      setError(err.message || 'Failed to load users and conversations');
    }
  }, [activeConversation, handleAuthFailure, startChatUserId]);

  const loadMessages = useCallback(async (conversationRef) => {
    const resolvedConversation = typeof conversationRef === 'string'
      ? conversations.find((conversation) => conversation.id === conversationRef) || null
      : conversationRef;
    const conversationId = resolvedConversation && resolvedConversation.id;

    if (!conversationId) {
      setMessages([]);
      return;
    }

    try {
      const data = await getConversationMessages(conversationId);
      let sessionKeyBase64 = await ensureSessionKey(resolvedConversation, { allowCreate: false });

      if (isDevBuild()) {
        console.info('[kdc-dev] loadMessages summary', {
          username,
          conversationId,
          messageCount: data.length,
          hasTicketBInThread: data.some((msg) => Boolean(msg && msg.kdcTicketB)),
          hasCachedSessionKey: Boolean(sessionKeyBase64)
        });
      }

      if (!sessionKeyBase64) {
        const ticketCarrier = data.find((msg) => msg && msg.kdcTicketB);
        if (ticketCarrier && ticketCarrier.kdcTicketB) {
          try {
            sessionKeyBase64 = await cacheConversationKeyFromTicketB({
              requesterUserId: username,
              conversationId,
              userKeyBase64: userSymmetricKey,
              ticketBEnvelope: ticketCarrier.kdcTicketB
            });
            await logDevKeyInfo(`loadMessages ticketB key for ${username}:${conversationId}`, sessionKeyBase64);
          } catch (ticketError) {
            if (isDevBuild()) {
              console.warn('[kdc-dev] ticketB decrypt failed in loadMessages', {
                username,
                conversationId,
                messageId: ticketCarrier.id,
                error: ticketError && (ticketError.message || String(ticketError))
              });
            }
            sessionKeyBase64 = null;
          }
        }
      }

      await logDevKeyInfo(`loadMessages key for ${username}:${conversationId}`, sessionKeyBase64);

      if (!sessionKeyBase64 && data.length > 0 && isDevBuild()) {
        console.warn('[kdc-dev] no session key available for encrypted thread', {
          username,
          conversationId,
          messageCount: data.length
        });
      }

      const decryptedMessages = await Promise.all(data.map(async (msg) => {
        const sessionKeyUsed = sessionKeyBase64 || null;
        
        if (!msg.encrypted || !sessionKeyBase64) {
          return {
            ...msg,
            text: msg.text || '[Encrypted message unavailable]',
            sessionKeyUsed
          };
        }

        try {
          const plaintext = await decryptChatMessage(msg.encrypted, sessionKeyBase64);
          return { ...msg, text: plaintext, sessionKeyUsed };
        } catch (decryptError) {
          if (isDevBuild()) {
            console.warn('[kdc-dev] decrypt failed', {
              conversationId,
              messageId: msg.id,
              hasTicketB: Boolean(msg.kdcTicketB),
              error: decryptError && (decryptError.message || String(decryptError))
            });
          }
          return {
            ...msg,
            text: '[Unable to decrypt message]',
            sessionKeyUsed
          };
        }
      }));

      setMessages(decryptedMessages);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        await handleAuthFailure();
        return;
      }

      if (err.status === 404) {
        setMessages([]);
        setActiveConversation(null);
        await loadDirectory();
        return;
      }

      setError(err.message || 'Failed to load messages');
    }
  }, [conversations, ensureSessionKey, handleAuthFailure, loadDirectory, logDevKeyInfo, userSymmetricKey, username]);

  useEffect(() => {
    if (!username) {
      return;
    }

    const key = getActiveUserKeyFromSession(username);
    if (!key) {
      setError('Missing local user key material. Please log out and log in again.');
      return;
    }

    setUserSymmetricKey(key);
    logDevKeyInfo(`active user key for ${username}`, key);
  }, [logDevKeyInfo, username]);

  // Load users and conversation list on component mount
  useEffect(() => {
    loadDirectory();
    const interval = setInterval(loadDirectory, 5000);
    return () => clearInterval(interval);
  }, [loadDirectory]);

  // Load currently selected conversation messages
  useEffect(() => {
    if (!activeConversation) {
      setMessages([]);
      return;
    }

    const refreshMessages = () => loadMessages(activeConversation);
    refreshMessages();
    const interval = setInterval(refreshMessages, 2000);
    return () => clearInterval(interval);
  }, [activeConversation, loadMessages]);

  const handleOpenConversation = async (targetUserId) => {
    if (!targetUserId) {
      return;
    }

    setError('');
    try {
      const conversation = await openConversation(targetUserId);
      setActiveConversation(conversation);

      const conversationList = await getConversations();
      setConversations(conversationList);
      await loadMessages(conversation);
    } catch (err) {
      if (err.status === 401) {
        await handleAuthFailure();
        return;
      }
      setError(err.message || 'Failed to open conversation');
    }
  };

  const handleStartChatSubmit = async (e) => {
    e.preventDefault();
    await handleOpenConversation(startChatUserId);
  };

  const handleDisplayNameSubmit = async (e) => {
    e.preventDefault();
    const trimmed = String(displayNameInput || '').trim();

    if (!trimmed) {
      setError('Display name is required');
      return;
    }

    if (trimmed === currentDisplayName) {
      return;
    }

    setDisplayNameSaving(true);
    setError('');

    try {
      const result = await updateDisplayName(trimmed);
      const nextDisplayName = result.displayName || trimmed;
      setCurrentDisplayName(nextDisplayName);
      setDisplayNameInput(nextDisplayName);
      setSuccessMessage('Display name updated');
      setTimeout(() => setSuccessMessage(''), 3000);
      await loadDirectory();
      await loadMessages(activeConversation);
    } catch (err) {
      if (err.status === 401) {
        await handleAuthFailure();
        return;
      }
      setError(err.message || 'Failed to update display name');
    } finally {
      setDisplayNameSaving(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!activeConversation || !messageText.trim()) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      let sessionKeyBase64 = await ensureSessionKey(activeConversation, { allowCreate: false });

      if (isDevBuild()) {
        console.info('[kdc-dev] sendMessage start', {
          username,
          conversationId: activeConversation.id,
          hasCachedSessionKey: Boolean(sessionKeyBase64)
        });
      }

      if (!sessionKeyBase64) {
        const existingMessages = await getConversationMessages(activeConversation.id);
        const ticketCarrier = existingMessages.find((msg) => msg && msg.kdcTicketB);
        if (ticketCarrier && ticketCarrier.kdcTicketB) {
          sessionKeyBase64 = await cacheConversationKeyFromTicketB({
            requesterUserId: username,
            conversationId: activeConversation.id,
            userKeyBase64: userSymmetricKey,
            ticketBEnvelope: ticketCarrier.kdcTicketB
          });
          await logDevKeyInfo(`sendMessage ticketB key for ${username}:${activeConversation.id}`, sessionKeyBase64);
        } else if (isDevBuild()) {
          console.info('[kdc-dev] sendMessage no ticketB found in existing thread', {
            username,
            conversationId: activeConversation.id,
            messageCount: existingMessages.length
          });
        }
      }

      if (!sessionKeyBase64) {
        const existingMessages = await getConversationMessages(activeConversation.id);
        if (!existingMessages || existingMessages.length === 0) {
          sessionKeyBase64 = await ensureSessionKey(activeConversation, { allowCreate: true });
          await logDevKeyInfo(`sendMessage created key for ${username}:${activeConversation.id}`, sessionKeyBase64);
        }
      }

      if (!sessionKeyBase64) {
        throw new Error('Missing conversation session key for this thread. Ask the other user to send a fresh message, or start a new conversation.');
      }

      const pendingTicketB = getPendingSessionTicketB(username, activeConversation.id);
      if (isDevBuild()) {
        console.info('[kdc-dev] sendMessage ticketB attached', {
          conversationId: activeConversation.id,
          attached: Boolean(pendingTicketB)
        });
      }

      const encrypted = await encryptChatMessage(messageText.trim(), sessionKeyBase64);
      await sendConversationMessage(activeConversation.id, {
        encrypted,
        keySource: 'kdc-session',
        kdcTicketB: pendingTicketB || undefined
      });
      if (pendingTicketB) {
        clearPendingSessionTicketB(username, activeConversation.id);
      }
      setMessageText('');
      await Promise.all([
        loadMessages(activeConversation.id),
        loadDirectory()
      ]);
    } catch (err) {
      if (err.status === 401) {
        await handleAuthFailure();
        return;
      }
      setError(err.message || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchAuditLogs = async () => {
    if (showAuditLogs) {
      setShowAuditLogs(false);
      return;
    }
    try {
      const logs = await getPersonalActivityLogs();
      setAuditLogs(logs);
      setShowAuditLogs(true);
    } catch (err) {
      setError(err.message || 'Failed to fetch logs');
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      // Call callback to refresh session state in parent
      if (onLogout) {
        await onLogout();
      }
      navigate('/');
    } catch (err) {
      setError(err.message || 'Logout failed');
    }
  };

  const handleResetData = async () => {
    if (!window.confirm('Are you sure you want to reset all data? This action cannot be undone.')) {
      return;
    }

    setResetLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      await resetData();
      setSuccessMessage('All data has been reset!');
      setConversations([]);
      setActiveConversation(null);
      setMessages([]);
      // Clear messages after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000);
      await loadDirectory();
    } catch (err) {
      setError(err.message || 'Reset failed');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Messaging App</h1>
        <div className="user-info">
          <span>Welcome, {currentDisplayName} {isAdmin && <span className="admin-badge">(Admin)</span>}</span>
          <form onSubmit={handleDisplayNameSubmit} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="Display name"
              disabled={displayNameSaving}
              maxLength={64}
            />
            <button type="submit" disabled={displayNameSaving || !displayNameInput.trim() || displayNameInput.trim() === currentDisplayName}>
              {displayNameSaving ? 'Saving...' : 'Save Name'}
            </button>
          </form>
          {isAdmin && (
            <button onClick={handleResetData} disabled={resetLoading} className="reset-btn">
              {resetLoading ? 'Resetting...' : 'Reset Data'}
            </button>
          )}
          <button onClick={handleFetchAuditLogs} className="audit-btn" style={{ marginLeft: '8px' }}>
            {showAuditLogs ? 'Hide Activity' : 'Activity Log'}
          </button>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {showAuditLogs && (
        <div className="audit-logs-section" style={{ margin: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h3>Your Account Activity</h3>
          <div style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '0.85rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                  <th>Time</th>
                  <th>Event</th>
                  <th>User</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px 0' }}>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.eventType}</td>
                    <td>{log.userId || 'system'}</td>
                    <td>
                      <span style={{ color: log.status === 'success' ? 'green' : log.status === 'failure' ? 'red' : 'orange' }}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="dm-layout">
        <aside className="dm-sidebar">
          <form onSubmit={handleStartChatSubmit} className="start-chat-form">
            <label htmlFor="startChatUser">Start a conversation</label>
            <div className="start-chat-controls">
              <select
                id="startChatUser"
                value={startChatUserId}
                onChange={(e) => setStartChatUserId(e.target.value)}
              >
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.userId} value={user.userId}>{user.displayName}</option>
                ))}
              </select>
              <button type="submit" disabled={!startChatUserId}>Open</button>
            </div>
          </form>

          <div className="conversations-list">
            {conversations.length === 0 ? (
              <p className="no-messages">No direct conversations yet.</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item ${activeConversation && activeConversation.id === conversation.id ? 'active' : ''}`}
                  onClick={() => setActiveConversation(conversation)}
                >
                  <strong>{conversation.otherDisplayName || conversation.otherUserId || conversation.otherUsername}</strong>
                  <small>{new Date(conversation.lastMessageAt).toLocaleString()}</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="messages-panel">
          <div className="messages-container">
            <div className="messages-list">
              {!activeConversation ? (
                <p className="no-messages">Select a user and open a direct conversation.</p>
              ) : messages.length === 0 ? (
                <p className="no-messages">No messages yet. Send the first one.</p>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`message ${(msg.senderUserId || msg.senderUsername) === username ? 'own-message' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '15px', alignItems: 'flex-start' }}>
                      <div className="message-body" style={{ flex: 1 }}>
                        <strong style={{ display: 'block', marginBottom: '4px' }}>{msg.senderDisplayName || msg.senderUserId || msg.senderUsername}</strong>
                        <p style={{ margin: '0', fontSize: '1rem' }}>{msg.text}</p>
                        <small style={{ display: 'block', marginTop: '8px', opacity: 0.6 }}>{new Date(msg.timestamp).toLocaleString()}</small>
                      </div>

                      <div className="crypto-debug-info" style={{ 
                        fontSize: '0.6rem', 
                        minWidth: '160px', 
                        maxWidth: '220px', 
                        backgroundColor: 'rgba(0,0,0,0.04)', 
                        padding: '6px', 
                        borderRadius: '4px', 
                        border: '1px solid rgba(0,0,0,0.1)',
                        opacity: 0.7
                      }}>
                        {msg.encrypted && (
                          <div style={{ marginBottom: '4px' }}>
                            <div style={{ fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '2px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>Encrypted Payload</div>
                            <div style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                              <strong>IV:</strong> {msg.encrypted.iv || 'N/A'}<br/>
                              <strong>Tag:</strong> {msg.encrypted.authTag || 'N/A'}<br/>
                              <strong>Cipher:</strong> {msg.encrypted.ciphertext|| 'N/A'}
                            </div>
                          </div>
                        )}
                        {msg.sessionKeyUsed && (
                          <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '2px' }}>
                            <strong>Session Key:</strong> <code style={{ wordBreak: 'break-all', color: '#555' }}>{msg.sessionKeyUsed}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <form onSubmit={handleSendMessage} className="message-form">
        <input
          type="text"
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          placeholder={activeConversation ? `Message ${activeConversation.otherDisplayName || activeConversation.otherUserId || activeConversation.otherUsername}...` : 'Open a conversation to start messaging'}
          disabled={loading || !activeConversation}
        />
        <button type="submit" disabled={loading || !messageText.trim() || !activeConversation}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export default DashboardPage;
