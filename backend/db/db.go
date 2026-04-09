package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a connection pool to the given DSN and runs schema migrations.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	if err := migrate(ctx, pool); err != nil {
		return nil, fmt.Errorf("db migrate: %w", err)
	}
	return pool, nil
}

func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    google_id     TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jwt_secret (
    id     SERIAL PRIMARY KEY,
    secret TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    anthropic_api_key TEXT NOT NULL DEFAULT '',
    model             TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    openai_api_key    TEXT NOT NULL DEFAULT '',
    openai_model      TEXT NOT NULL DEFAULT 'gpt-4o',
    ai_provider       TEXT NOT NULL DEFAULT 'anthropic'
);

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
    org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'user',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS org_invites (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    invited_by  TEXT NOT NULL REFERENCES users(id),
    token       TEXT UNIQUE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS super_admins (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wikis (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo              TEXT NOT NULL,
    repo_slug         TEXT NOT NULL,
    branch            TEXT NOT NULL DEFAULT '',
    commit_sha        TEXT NOT NULL DEFAULT '',
    generated_at      TIMESTAMPTZ,
    stack             TEXT[] NOT NULL DEFAULT '{}',
    description       TEXT NOT NULL DEFAULT '',
    pages             JSONB NOT NULL DEFAULT '[]',
    share_token       TEXT,
    has_custom_config BOOLEAN NOT NULL DEFAULT FALSE,
    template_id       TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL DEFAULT '',
    regenerated_pages TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (user_id, repo_slug)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    wiki_id TEXT NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (wiki_id, page_id)
);

CREATE TABLE IF NOT EXISTS wiki_templates (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    pages      JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shares (
    token     TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wiki_slug TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    size        BIGINT NOT NULL DEFAULT 0,
    ext         TEXT NOT NULL DEFAULT '',
    folder_id   TEXT NOT NULL DEFAULT '',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS folders (
    id      TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_accounts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login   TEXT NOT NULL,
    token   TEXT NOT NULL,
    PRIMARY KEY (user_id, login)
);

CREATE TABLE IF NOT EXISTS gitlab_accounts (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    token    TEXT NOT NULL,
    PRIMARY KEY (user_id, username)
);
`
