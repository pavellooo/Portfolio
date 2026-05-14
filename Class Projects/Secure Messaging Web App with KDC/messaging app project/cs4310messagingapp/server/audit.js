const path = require('path');

const AUDIT_LOG_TTL_DAYS = Number(process.env.AUDIT_LOG_TTL_DAYS || '90');

const eventTypes = {
  LOGIN_ATTEMPT: 'login_attempt',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  USER_REGISTRATION: 'user_registration',
  KDC_LOGIN_ATTEMPT: 'kdc_login_attempt',
  KDC_LOGIN_SUCCESS: 'kdc_login_success',
  KDC_LOGIN_FAILURE: 'kdc_login_failure',
  LOGOUT: 'logout',
  DISPLAY_NAME_CHANGE: 'display_name_change',
  ADMIN_RESET_ATTEMPT: 'admin_reset_attempt',
  ADMIN_RESET_SUCCESS: 'admin_reset_success',
  ADMIN_RESET_FAILURE: 'admin_reset_failure',
  MESSAGE_RATE_LIMITED: 'message_send_rate_limited'
};

let AuditLogModel = null;
const auditLogs = [];

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }

  return 'unknown';
}

function getAuditLogRequestContext(req) {
  return {
    ipAddress: getClientIp(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
    path: req.originalUrl || req.url || '',
    method: req.method || ''
  };
}

function scrubMetadata(metadata = {}) {
  if (metadata == null || typeof metadata !== 'object') {
    return {};
  }

  const safeMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('proof')) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
      safeMetadata[key] = value;
      continue;
    }

    try {
      safeMetadata[key] = JSON.parse(JSON.stringify(value));
    } catch {
      safeMetadata[key] = String(value);
    }
  }

  return safeMetadata;
}

function getAuditEventBase({ eventType, userId, actorUserId, targetUserId, status, reason, metadata }) {
  return {
    eventType,
    userId: userId || null,
    actorUserId: actorUserId || null,
    targetUserId: targetUserId || null,
    status: status || 'unknown',
    reason: typeof reason === 'string' ? reason : '',
    metadata: scrubMetadata(metadata),
    createdAt: new Date()
  };
}

function initAuditLogModel(mongoose) {
  if (!mongoose || !mongoose.Schema) {
    throw new Error('Mongoose instance is required to initialize audit logging model');
  }

  const auditSchema = new mongoose.Schema({
    eventType: { type: String, required: true, trim: true },
    userId: { type: String, default: null, trim: true },
    actorUserId: { type: String, default: null, trim: true },
    targetUserId: { type: String, default: null, trim: true },
    status: { type: String, default: 'unknown', trim: true },
    reason: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
  });

  if (AUDIT_LOG_TTL_DAYS > 0) {
    auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_LOG_TTL_DAYS * 24 * 60 * 60 });
  }

  AuditLogModel = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
  return AuditLogModel;
}

async function recordAuditEvent(event) {
  const entry = getAuditEventBase(event);

  if (AuditLogModel) {
    try {
      await AuditLogModel.create(entry);
      return entry;
    } catch (err) {
      // Do not fail main request when audit logging fails.
      console.warn('Audit log write failed:', err && err.message ? err.message : err);
      return entry;
    }
  }

  auditLogs.push(entry);
  return entry;
}

async function getAuditLogs(filter = {}, limit = 100) {
  if (AuditLogModel) {
    return await AuditLogModel.find(filter).sort({ createdAt: -1 }).limit(limit);
  }
  
  const filtered = filter.userId 
    ? auditLogs.filter(log => log.userId === filter.userId)
    : auditLogs;

  return filtered.slice().reverse().slice(0, limit);
}

module.exports = {
  eventTypes,
  initAuditLogModel,
  recordAuditEvent,
  getAuditLogRequestContext,
  getAuditLogs
};
