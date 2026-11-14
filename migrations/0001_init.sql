-- Firefly D1 初始化 schema
-- 内容以「写入时预渲染」为准：body_md 是源，body_html 是渲染结果。
-- 公开站只读 body_html，因此运行时不需要任何 markdown 插件。

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,          -- 对应原 entry.id（不含扩展名）
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  body_md       TEXT    NOT NULL DEFAULT '',      -- Markdown 源码
  body_html     TEXT    NOT NULL DEFAULT '',      -- 写入时渲染好的 HTML
  excerpt       TEXT    NOT NULL DEFAULT '',
  image         TEXT    NOT NULL DEFAULT '',
  category      TEXT,
  lang          TEXT    NOT NULL DEFAULT '',
  pinned        INTEGER NOT NULL DEFAULT 0,
  draft         INTEGER NOT NULL DEFAULT 0,
  comment       INTEGER NOT NULL DEFAULT 1,
  author        TEXT    NOT NULL DEFAULT '',
  source_link   TEXT    NOT NULL DEFAULT '',
  license_name  TEXT    NOT NULL DEFAULT '',
  license_url   TEXT    NOT NULL DEFAULT '',
  password      TEXT    NOT NULL DEFAULT '',
  password_hint TEXT    NOT NULL DEFAULT '',
  series        TEXT    NOT NULL DEFAULT '',
  series_order  INTEGER,
  word_count    INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT    NOT NULL,
  updated_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  modified_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (draft, pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category  ON posts (category);
CREATE INDEX IF NOT EXISTS idx_posts_series    ON posts (series);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags (tag_id);

CREATE TABLE IF NOT EXISTS dynamics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  body_md    TEXT NOT NULL DEFAULT '',
  body_html  TEXT NOT NULL DEFAULT '',
  location   TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dynamics_published ON dynamics (pinned DESC, published_at DESC);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body_md     TEXT NOT NULL DEFAULT '',
  body_html   TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '',
  lang        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER,
  draft       INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

-- 特殊页面（about / guestbook / friends），原 src/content/spec
CREATE TABLE IF NOT EXISTS pages (
  slug      TEXT PRIMARY KEY,
  body_md   TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  modified_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
