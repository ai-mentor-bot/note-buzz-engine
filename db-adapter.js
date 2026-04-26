/**
 * SQLite（ローカル）または PostgreSQL（Render の DATABASE_URL 等）を統一介面で使う
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const usePg = () => !!process.env.DATABASE_URL;

let pool;
let sqliteDb;
let _sqlitePath;

function toPgParams(sql, params) {
  let n = 0;
  const text = sql.replace(/\?/g, () => `$${++n}`);
  return { text, values: params || [] };
}

async function init() {
  if (usePg()) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5
    });
    await migratePg();
    console.log('[db] PostgreSQL (DATABASE_URL)');
    return;
  }

  _sqlitePath = process.env.DB_PATH
    || (process.env.RENDER === 'true' ? path.join('/tmp', 'nbe-data.sqlite') : path.join(__dirname, 'data.sqlite'));
  if (_sqlitePath && _sqlitePath !== ':memory:') {
    fs.mkdirSync(path.dirname(_sqlitePath), { recursive: true });
  }
  sqliteDb = new Database(_sqlitePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(SQLITE_DDL);
  console.log('[db] SQLite', _sqlitePath);
}

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  day INTEGER,
  level INTEGER,
  plan TEXT,
  keyword TEXT,
  title TEXT,
  article TEXT,
  x_posts TEXT,
  hashtags TEXT,
  image_url TEXT,
  embedding TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_account ON articles(account);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  in_tokens INTEGER DEFAULT 0,
  out_tokens INTEGER DEFAULT 0,
  units REAL DEFAULT 0,
  usd REAL NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_costs_ts ON costs(ts DESC);

CREATE TABLE IF NOT EXISTS x_metrics (
  article_id INTEGER,
  tweet_id TEXT PRIMARY KEY,
  impressions INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  fetched_at INTEGER NOT NULL
);
`;

async function migratePg() {
  await pool.query(`
CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  account TEXT NOT NULL,
  day INTEGER,
  level INTEGER,
  plan TEXT,
  keyword TEXT,
  title TEXT,
  article TEXT,
  x_posts TEXT,
  hashtags TEXT,
  image_url TEXT,
  embedding TEXT,
  meta TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_account ON articles(account);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

CREATE TABLE IF NOT EXISTS costs (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  in_tokens BIGINT DEFAULT 0,
  out_tokens BIGINT DEFAULT 0,
  units DOUBLE PRECISION DEFAULT 0,
  usd DOUBLE PRECISION NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_costs_ts ON costs(ts DESC);

CREATE TABLE IF NOT EXISTS x_metrics (
  article_id BIGINT,
  tweet_id TEXT PRIMARY KEY,
  impressions BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  retweets BIGINT DEFAULT 0,
  replies BIGINT DEFAULT 0,
  fetched_at BIGINT NOT NULL
);
`);
}

/**
 * @param {string} sql
 * @param {any[]} [params]
 */
async function run(sql, params = []) {
  if (usePg()) {
    const { text, values } = toPgParams(sql, params);
    await pool.query(text, values);
  } else {
    await Promise.resolve(sqliteDb.prepare(sql).run(...params));
  }
}

/**
 * @param {string} sql
 * @param {any[]} [params]
 */
async function get(sql, params = []) {
  if (usePg()) {
    const { text, values } = toPgParams(sql, params);
    const r = await pool.query(text, values);
    return r.rows[0] || null;
  }
  return sqliteDb.prepare(sql).get(...params);
}

/**
 * @param {string} sql
 * @param {any[]} [params]
 */
async function all(sql, params = []) {
  if (usePg()) {
    const { text, values } = toPgParams(sql, params);
    const r = await pool.query(text, values);
    return r.rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

async function insertArticleRow(values) {
  const sqlIns = `INSERT INTO articles(
    account, day, level, plan, keyword, title, article, x_posts, hashtags, image_url, embedding, meta, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  if (usePg()) {
    const { text, values: val } = toPgParams(
      sqlIns + ' RETURNING id',
      values
    );
    const r = await pool.query(text, val);
    return r.rows[0] ? Number(r.rows[0].id) : null;
  }
  sqliteDb.prepare(sqlIns).run(...values);
  const r = sqliteDb.prepare('SELECT last_insert_rowid() AS id').get();
  return r ? Number(r.id) : null;
}

async function insertXMetricOrIgnore(articleId, tweetId, ts) {
  if (usePg()) {
    await run(
      `INSERT INTO x_metrics(article_id, tweet_id, impressions, likes, retweets, replies, fetched_at)
       VALUES (?, ?, 0, 0, 0, 0, ?)
       ON CONFLICT (tweet_id) DO NOTHING`,
      [articleId, tweetId, ts]
    );
  } else {
    await run(
      'INSERT OR IGNORE INTO x_metrics(article_id, tweet_id, fetched_at) VALUES (?, ?, ?)',
      [articleId, tweetId, ts]
    );
  }
}

function getDbInfo() {
  if (usePg()) return { kind: 'postgres', path: 'DATABASE_URL' };
  return { kind: 'sqlite', path: _sqlitePath || 'sqlite' };
}

function isPostgres() {
  return usePg();
}

module.exports = {
  init,
  run,
  get,
  all,
  insertArticleRow,
  insertXMetricOrIgnore,
  getDbInfo,
  isPostgres
};
