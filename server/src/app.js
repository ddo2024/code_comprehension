const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3001;
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'study.db');

fs.mkdirSync(dataDir, { recursive: true });

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schemaSql = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    study_condition TEXT NOT NULL CHECK (study_condition IN ('scaffolded', 'unscaffolded')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    app_version TEXT NOT NULL,
    study_protocol_version TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(student_id)
  );

  CREATE TABLE IF NOT EXISTS problem_attempts (
    attempt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    problem_id TEXT NOT NULL,
    problem_version TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    final_code TEXT,
    solved INTEGER NOT NULL DEFAULT 0 CHECK (solved IN (0, 1)),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  CREATE TABLE IF NOT EXISTS telemetry_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    attempt_id TEXT,
    event_type TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    client_timestamp TEXT NOT NULL,
    server_timestamp TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    FOREIGN KEY (attempt_id) REFERENCES problem_attempts(attempt_id)
  );

  CREATE TABLE IF NOT EXISTS responses (
    response_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    response_type TEXT NOT NULL,
    response_text TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES problem_attempts(attempt_id)
  );

  CREATE TABLE IF NOT EXISTS ai_interactions (
    ai_interaction_id TEXT PRIMARY KEY,
    attempt_id TEXT,
    event_id TEXT,
    provider_name TEXT,
    interaction_type TEXT,
    created_at TEXT NOT NULL,
    request_payload_json TEXT,
    response_payload_json TEXT,
    FOREIGN KEY (attempt_id) REFERENCES problem_attempts(attempt_id),
    FOREIGN KEY (event_id) REFERENCES telemetry_events(event_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id);
  CREATE INDEX IF NOT EXISTS idx_problem_attempts_session_id ON problem_attempts(session_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_session_event ON telemetry_events(session_id, event_type, sequence_number);
  CREATE INDEX IF NOT EXISTS idx_responses_attempt_id ON responses(attempt_id);
`;

db.exec(schemaSql);

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (
    session_id, student_id, started_at, app_version, study_protocol_version
  ) VALUES (?, ?, ?, ?, ?)
`);

const insertStudentStmt = db.prepare(`
  INSERT OR IGNORE INTO students (student_id, study_condition, created_at)
  VALUES (?, ?, ?)
`);

const insertTelemetryStmt = db.prepare(`
  INSERT INTO telemetry_events (
    event_id, session_id, attempt_id, event_type, sequence_number,
    client_timestamp, server_timestamp, raw_payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/session/start', (req, res) => {
  try {
    const studentId = req.body?.studentId;
    const studyCondition = req.body?.studyCondition ?? 'scaffolded';
    const appVersion = req.body?.appVersion ?? '0.1.0';
    const studyProtocolVersion = req.body?.studyProtocolVersion ?? '1.0';

    if (!studentId || typeof studentId !== 'string') {
      return res.status(400).json({ error: 'studentId is required' });
    }

    const startedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    db.exec('BEGIN IMMEDIATE;');
    try {
      insertStudentStmt.run(studentId, studyCondition, startedAt);
      insertSessionStmt.run(sessionId, studentId, startedAt, appVersion, studyProtocolVersion);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }

    return res.status(201).json({
      sessionId,
      studentId,
      startedAt,
      studyCondition,
      appVersion,
      studyProtocolVersion,
    });
  } catch (error) {
    console.error('session start failed', error);
    return res.status(500).json({ error: 'Failed to create session.' });
  }
});

app.post('/api/session/telemetry', (req, res) => {
  try {
    const body = req.body;
    if (!body || !Array.isArray(body.events)) {
      return res.status(400).json({ error: 'Expected body with events array' });
    }

    const events = body.events;
    if (events.length === 0) {
      return res.status(400).json({ error: 'No telemetry events provided.' });
    }

    const seen = new Set();

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const event of events) {
        const required = [
          'eventId',
          'studentId',
          'sessionId',
          'problemId',
          'problemVersion',
          'studyCondition',
          'eventType',
          'sequenceNumber',
          'clientTimestamp',
          'payload',
        ];

        for (const field of required) {
          if (!(field in event)) {
            throw new Error(`Missing field: ${field}`);
          }
        }

        if (seen.has(event.eventId)) {
          throw new Error(`Duplicate eventId: ${event.eventId}`);
        }
        seen.add(event.eventId);

        const serverTimestamp = new Date().toISOString();
        insertTelemetryStmt.run(
          event.eventId,
          event.sessionId,
          null,
          event.eventType,
          event.sequenceNumber,
          event.clientTimestamp,
          serverTimestamp,
          JSON.stringify(event.payload)
        );
      }
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }

    return res.status(202).json({ accepted: events.length });
  } catch (error) {
    console.error('telemetry insert failed', error);
    return res.status(400).json({
      error: 'Invalid telemetry batch',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Study server running at http://localhost:${PORT}`);
});
