package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"livewiki/auth"
	dbpkg "livewiki/db"
	"livewiki/drive"
	"livewiki/mdf"
)

var uploadsDir string
var pool *pgxpool.Pool
var driveClient *drive.Client
var activeRedirectURI string
var authStore *auth.Store
var googleAuthConf *oauth2.Config
var githubOAuthConf *oauth2.Config
var githubRedirectURI string
var gitlabOAuthConf *oauth2.Config
var gitlabRedirectURI string

func init() {
	uploadsDir = os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "./uploads"
	}
	os.MkdirAll(uploadsDir, 0755)

	var err error
	pool, err = dbpkg.Connect(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	authStore, err = auth.NewStore(pool)
	if err != nil {
		log.Fatalf("failed to init auth store: %v", err)
	}

	migrateWikisFromDisk()

	activeRedirectURI = os.Getenv("GOOGLE_REDIRECT_URI")
	if activeRedirectURI == "" {
		if domain := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); domain != "" {
			activeRedirectURI = "https://" + domain + "/api/drive/callback"
		} else {
			activeRedirectURI = "http://localhost:8080/api/drive/callback"
		}
	}

	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")

	// GitHub OAuth
	githubClientID := os.Getenv("GITHUB_CLIENT_ID")
	githubClientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	githubRedirectURI = os.Getenv("GITHUB_REDIRECT_URI")
	if githubRedirectURI == "" {
		if domain := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); domain != "" {
			githubRedirectURI = "https://" + domain + "/api/github/callback"
		} else {
			githubRedirectURI = "http://localhost:8080/api/github/callback"
		}
	}
	if githubClientID != "" && githubClientSecret != "" {
		githubOAuthConf = &oauth2.Config{
			ClientID:     githubClientID,
			ClientSecret: githubClientSecret,
			RedirectURL:  githubRedirectURI,
			Scopes:       []string{"repo"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://github.com/login/oauth/authorize",
				TokenURL: "https://github.com/login/oauth/access_token",
			},
		}
	}

	// GitLab OAuth
	gitlabClientID := os.Getenv("GITLAB_CLIENT_ID")
	gitlabClientSecret := os.Getenv("GITLAB_CLIENT_SECRET")
	gitlabRedirectURI = os.Getenv("GITLAB_REDIRECT_URI")
	if gitlabRedirectURI == "" {
		if domain := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); domain != "" {
			gitlabRedirectURI = "https://" + domain + "/api/gitlab/callback"
		} else {
			gitlabRedirectURI = "http://localhost:8080/api/gitlab/callback"
		}
	}
	if gitlabClientID != "" && gitlabClientSecret != "" {
		gitlabOAuthConf = &oauth2.Config{
			ClientID:     gitlabClientID,
			ClientSecret: gitlabClientSecret,
			RedirectURL:  gitlabRedirectURI,
			Scopes:       []string{"read_api"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://gitlab.com/oauth/authorize",
				TokenURL: "https://gitlab.com/oauth/token",
			},
		}
	}

	if clientID != "" && clientSecret != "" {
		driveClient = drive.NewClient(clientID, clientSecret, activeRedirectURI, uploadsDir)

		authRedirectURI := os.Getenv("GOOGLE_AUTH_REDIRECT_URI")
		if authRedirectURI == "" {
			if domain := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); domain != "" {
				authRedirectURI = "https://" + domain + "/api/auth/google/callback"
			} else {
				authRedirectURI = "http://localhost:8080/api/auth/google/callback"
			}
		}
		googleAuthConf = &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  authRedirectURI,
			Scopes: []string{
				"openid",
				"https://www.googleapis.com/auth/userinfo.profile",
				"https://www.googleapis.com/auth/userinfo.email",
			},
			Endpoint: google.Endpoint,
		}
	}
}

// ── UserSettings ──────────────────────────────────────────────────────────────

type UserSettings struct {
	AnthropicAPIKey string `json:"anthropic_api_key"`
	Model           string `json:"model"`
	OpenAIAPIKey    string `json:"openai_api_key"`
	OpenAIModel     string `json:"openai_model"`
	AIProvider      string `json:"ai_provider"` // "anthropic" | "openai"
}

var validModels = map[string]bool{
	"claude-sonnet-4-6":          true,
	"claude-haiku-4-5-20251001":  true,
	"claude-opus-4-6":            true,
}

var validOpenAIModels = map[string]bool{
	"gpt-4o":           true,
	"gpt-4o-mini":      true,
	"gpt-4-turbo":      true,
	"gpt-4":            true,
	"gpt-3.5-turbo":    true,
}

func loadSettings(uid string) UserSettings {
	var s UserSettings
	err := pool.QueryRow(context.Background(),
		`SELECT anthropic_api_key, model, openai_api_key, openai_model, ai_provider
		 FROM user_settings WHERE user_id = $1`, uid,
	).Scan(&s.AnthropicAPIKey, &s.Model, &s.OpenAIAPIKey, &s.OpenAIModel, &s.AIProvider)
	if err != nil {
		return UserSettings{Model: "claude-sonnet-4-6", AIProvider: "anthropic", OpenAIModel: "gpt-4o"}
	}
	if s.Model == "" {
		s.Model = "claude-sonnet-4-6"
	}
	if s.AIProvider == "" {
		s.AIProvider = "anthropic"
	}
	if s.OpenAIModel == "" {
		s.OpenAIModel = "gpt-4o"
	}
	return s
}

func saveSettings(uid string, s UserSettings) error {
	_, err := pool.Exec(context.Background(),
		`INSERT INTO user_settings (user_id, anthropic_api_key, model, openai_api_key, openai_model, ai_provider)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id) DO UPDATE SET
		   anthropic_api_key = EXCLUDED.anthropic_api_key,
		   model             = EXCLUDED.model,
		   openai_api_key    = EXCLUDED.openai_api_key,
		   openai_model      = EXCLUDED.openai_model,
		   ai_provider       = EXCLUDED.ai_provider`,
		uid, s.AnthropicAPIKey, s.Model, s.OpenAIAPIKey, s.OpenAIModel, s.AIProvider,
	)
	return err
}

// ── Wiki storage ──────────────────────────────────────────────────────────────

type WikiPageMeta struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Slug     string `json:"slug"`
	ParentID string `json:"parent_id,omitempty"`
	Order    int    `json:"order"`
}

type WikiMeta struct {
	ID               string         `json:"id"`
	Repo             string         `json:"repo"`
	RepoSlug         string         `json:"repo_slug"` // owner-repo (safe for filenames)
	Branch           string         `json:"branch"`
	CommitSHA        string         `json:"commit_sha"`
	GeneratedAt      time.Time      `json:"generated_at"`
	Pages            []WikiPageMeta `json:"pages"`
	Stack            []string       `json:"stack"`
	Description      string         `json:"description"`
	RegeneratedPages []string       `json:"regenerated_pages,omitempty"`
	ShareToken       string         `json:"share_token,omitempty"`
	HasCustomConfig  bool           `json:"has_custom_config,omitempty"`
	TemplateID       string         `json:"template_id,omitempty"`
	Source           string         `json:"source,omitempty"` // "github" | "gitlab"
}

// ── Shares index (token → uid+slug, no auth required for reads) ───────────────
type shareEntry struct {
	UID  string `json:"uid"`
	Slug string `json:"slug"`
}

// ── Wiki templates ─────────────────────────────────────────────────────────────
type TemplatePageSpec struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Slug   string `json:"slug,omitempty"`
	Prompt string `json:"prompt"`
}

type WikiTemplate struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Pages     []TemplatePageSpec `json:"pages"`
	CreatedAt time.Time          `json:"created_at"`
	UpdatedAt time.Time          `json:"updated_at"`
}

func loadTemplates(uid string) []WikiTemplate {
	rows, err := pool.Query(context.Background(),
		`SELECT id, name, pages, created_at, updated_at FROM wiki_templates WHERE user_id = $1 ORDER BY created_at`, uid)
	if err != nil {
		return []WikiTemplate{}
	}
	defer rows.Close()
	var ts []WikiTemplate
	for rows.Next() {
		var t WikiTemplate
		var pagesJSON []byte
		if err := rows.Scan(&t.ID, &t.Name, &pagesJSON, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		json.Unmarshal(pagesJSON, &t.Pages)
		ts = append(ts, t)
	}
	if ts == nil {
		return []WikiTemplate{}
	}
	return ts
}

func saveTemplate(uid string, t WikiTemplate) error {
	pagesJSON, _ := json.Marshal(t.Pages)
	_, err := pool.Exec(context.Background(),
		`INSERT INTO wiki_templates (id, user_id, name, pages, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pages = EXCLUDED.pages, updated_at = EXCLUDED.updated_at`,
		t.ID, uid, t.Name, pagesJSON, t.CreatedAt, t.UpdatedAt,
	)
	return err
}

func deleteTemplate(uid, id string) error {
	_, err := pool.Exec(context.Background(),
		`DELETE FROM wiki_templates WHERE id = $1 AND user_id = $2`, id, uid)
	return err
}

func findTemplate(uid, id string) *WikiTemplate {
	var t WikiTemplate
	var pagesJSON []byte
	err := pool.QueryRow(context.Background(),
		`SELECT id, name, pages, created_at, updated_at FROM wiki_templates WHERE id = $1 AND user_id = $2`, id, uid,
	).Scan(&t.ID, &t.Name, &pagesJSON, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil
	}
	json.Unmarshal(pagesJSON, &t.Pages)
	return &t
}

// ── Organizations ─────────────────────────────────────────────────────────────
type Organization struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	OwnerID    string    `json:"owner_id"`
	IsPersonal bool      `json:"is_personal"`
	CreatedAt  time.Time `json:"created_at"`
}

type OrgMember struct {
	UserID   string    `json:"user_id"`
	Role     string    `json:"role"` // "admin" | "user"
	JoinedAt time.Time `json:"joined_at"`
}

type OrgInvite struct {
	ID        string    `json:"id"`
	OrgID     string    `json:"org_id"`
	Email     string    `json:"email"`
	InvitedBy string    `json:"invited_by"`
	Token     string    `json:"token"`
	Status    string    `json:"status"` // "pending" | "accepted"
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

func loadOrg(id string) *Organization {
	var o Organization
	err := pool.QueryRow(context.Background(),
		`SELECT id, name, owner_id, is_personal, created_at FROM organizations WHERE id = $1`, id,
	).Scan(&o.ID, &o.Name, &o.OwnerID, &o.IsPersonal, &o.CreatedAt)
	if err != nil {
		return nil
	}
	return &o
}

func saveOrg(o Organization) {
	pool.Exec(context.Background(),
		`INSERT INTO organizations (id, name, owner_id, is_personal, created_at)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
		o.ID, o.Name, o.OwnerID, o.IsPersonal, o.CreatedAt,
	)
}

func loadOrgMembers(orgID string) []OrgMember {
	rows, err := pool.Query(context.Background(),
		`SELECT user_id, role, joined_at FROM org_members WHERE org_id = $1`, orgID)
	if err != nil {
		return []OrgMember{}
	}
	defer rows.Close()
	var members []OrgMember
	for rows.Next() {
		var m OrgMember
		if err := rows.Scan(&m.UserID, &m.Role, &m.JoinedAt); err != nil {
			continue
		}
		members = append(members, m)
	}
	if members == nil {
		return []OrgMember{}
	}
	return members
}

func saveOrgMembers(orgID string, members []OrgMember) {
	ctx := context.Background()
	pool.Exec(ctx, `DELETE FROM org_members WHERE org_id = $1`, orgID)
	for _, m := range members {
		pool.Exec(ctx,
			`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
			orgID, m.UserID, m.Role, m.JoinedAt,
		)
	}
}

func loadOrgInvites(orgID string) []OrgInvite {
	rows, err := pool.Query(context.Background(),
		`SELECT id, org_id, email, invited_by, token, status, created_at, expires_at FROM org_invites WHERE org_id = $1`, orgID)
	if err != nil {
		return []OrgInvite{}
	}
	defer rows.Close()
	var invites []OrgInvite
	for rows.Next() {
		var inv OrgInvite
		if err := rows.Scan(&inv.ID, &inv.OrgID, &inv.Email, &inv.InvitedBy, &inv.Token, &inv.Status, &inv.CreatedAt, &inv.ExpiresAt); err != nil {
			continue
		}
		invites = append(invites, inv)
	}
	if invites == nil {
		return []OrgInvite{}
	}
	return invites
}

func saveOrgInvites(orgID string, invites []OrgInvite) {
	ctx := context.Background()
	pool.Exec(ctx, `DELETE FROM org_invites WHERE org_id = $1`, orgID)
	for _, inv := range invites {
		pool.Exec(ctx,
			`INSERT INTO org_invites (id, org_id, email, invited_by, token, status, created_at, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
			inv.ID, inv.OrgID, inv.Email, inv.InvitedBy, inv.Token, inv.Status, inv.CreatedAt, inv.ExpiresAt,
		)
	}
}

func listAllOrgs() []Organization {
	rows, err := pool.Query(context.Background(),
		`SELECT id, name, owner_id, is_personal, created_at FROM organizations ORDER BY created_at`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var orgs []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.OwnerID, &o.IsPersonal, &o.CreatedAt); err != nil {
			continue
		}
		orgs = append(orgs, o)
	}
	return orgs
}

func userOrgs(uid string) []Organization {
	rows, err := pool.Query(context.Background(),
		`SELECT o.id, o.name, o.owner_id, o.is_personal, o.created_at
		 FROM organizations o JOIN org_members m ON o.id = m.org_id
		 WHERE m.user_id = $1 ORDER BY o.created_at`, uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.OwnerID, &o.IsPersonal, &o.CreatedAt); err != nil {
			continue
		}
		out = append(out, o)
	}
	return out
}

func orgMemberRole(orgID, uid string) string {
	var role string
	err := pool.QueryRow(context.Background(),
		`SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`, orgID, uid,
	).Scan(&role)
	if err != nil {
		return ""
	}
	return role
}

func loadSuperAdminIDs() []string {
	rows, err := pool.Query(context.Background(), `SELECT user_id FROM super_admins`)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	if ids == nil {
		return []string{}
	}
	return ids
}

func addSuperAdmin(uid string) {
	pool.Exec(context.Background(),
		`INSERT INTO super_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, uid)
}

func removeSuperAdmin(uid string) {
	pool.Exec(context.Background(), `DELETE FROM super_admins WHERE user_id = $1`, uid)
}

func isSuperAdmin(user *auth.User) bool {
	sa := os.Getenv("SUPER_ADMIN_EMAIL")
	if sa != "" && strings.EqualFold(user.Email, sa) {
		return true
	}
	var exists bool
	pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM super_admins WHERE user_id = $1)`, user.ID,
	).Scan(&exists)
	return exists
}

func ensurePersonalOrg(uid, name string) {
	for _, o := range userOrgs(uid) {
		if o.OwnerID == uid {
			return
		}
	}
	orgID := uuid.New().String()
	org := Organization{ID: orgID, Name: name + "'s Workspace", OwnerID: uid, IsPersonal: true, CreatedAt: time.Now()}
	saveOrg(org)
	saveOrgMembers(orgID, []OrgMember{{UserID: uid, Role: "admin", JoinedAt: time.Now()}})
}

func loadSharesIndex() map[string]shareEntry {
	rows, err := pool.Query(context.Background(), `SELECT token, user_id, wiki_slug FROM shares`)
	if err != nil {
		return map[string]shareEntry{}
	}
	defer rows.Close()
	idx := map[string]shareEntry{}
	for rows.Next() {
		var token string
		var e shareEntry
		if err := rows.Scan(&token, &e.UID, &e.Slug); err == nil {
			idx[token] = e
		}
	}
	return idx
}

func saveSharesIndex(idx map[string]shareEntry) {
	ctx := context.Background()
	pool.Exec(ctx, `DELETE FROM shares`)
	for token, e := range idx {
		pool.Exec(ctx,
			`INSERT INTO shares (token, user_id, wiki_slug) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, wiki_slug = EXCLUDED.wiki_slug`,
			token, e.UID, e.Slug,
		)
	}
}

// migrateWikisFromDisk reads any wiki data written by the old filesystem-based
// storage and inserts it into the database. Safe to call on every startup:
// ON CONFLICT DO NOTHING means it will never overwrite data already in the DB.
func migrateWikisFromDisk() {
	usersDir := filepath.Join(uploadsDir, "users")
	userEntries, err := os.ReadDir(usersDir)
	if err != nil {
		return
	}
	migrated := 0
	for _, userEntry := range userEntries {
		if !userEntry.IsDir() {
			continue
		}
		uid := userEntry.Name()
		wikisDir := filepath.Join(usersDir, uid, "wikis")
		wikiEntries, err := os.ReadDir(wikisDir)
		if err != nil {
			continue
		}
		for _, wikiEntry := range wikiEntries {
			if !wikiEntry.IsDir() {
				continue
			}
			slug := wikiEntry.Name()
			metaData, err := os.ReadFile(filepath.Join(wikisDir, slug, "meta.json"))
			if err != nil {
				continue
			}
			var m WikiMeta
			if err := json.Unmarshal(metaData, &m); err != nil {
				continue
			}
			if m.ID == "" {
				m.ID = slug
			}
			if m.RepoSlug == "" {
				m.RepoSlug = slug
			}
			if m.Source == "" {
				m.Source = "github"
			}
			pagesJSON, _ := json.Marshal(m.Pages)
			var shareToken *string
			if m.ShareToken != "" {
				shareToken = &m.ShareToken
			}
			regenPages := m.RegeneratedPages
			if regenPages == nil {
				regenPages = []string{}
			}
			_, err = pool.Exec(context.Background(),
				`INSERT INTO wikis (id, user_id, repo, repo_slug, branch, commit_sha, generated_at, stack,
				                    description, pages, share_token, has_custom_config, template_id, source, regenerated_pages)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
				 ON CONFLICT (user_id, repo_slug) DO NOTHING`,
				m.ID, uid, m.Repo, m.RepoSlug, m.Branch, m.CommitSHA, m.GeneratedAt, m.Stack,
				m.Description, pagesJSON, shareToken, m.HasCustomConfig, m.TemplateID, m.Source, regenPages,
			)
			if err != nil {
				log.Printf("wiki disk migration: insert wiki %s: %v", slug, err)
				continue
			}
			// Migrate share token
			if m.ShareToken != "" {
				pool.Exec(context.Background(),
					`INSERT INTO shares (token, user_id, wiki_slug) VALUES ($1,$2,$3)
					 ON CONFLICT (token) DO NOTHING`,
					m.ShareToken, uid, slug,
				)
			}
			// Migrate page content
			var wikiID string
			if scanErr := pool.QueryRow(context.Background(),
				`SELECT id FROM wikis WHERE user_id = $1 AND repo_slug = $2`, uid, slug,
			).Scan(&wikiID); scanErr != nil {
				continue
			}
			for _, page := range m.Pages {
				content, err := os.ReadFile(filepath.Join(wikisDir, slug, "page_"+page.ID+".md"))
				if err != nil {
					continue
				}
				pool.Exec(context.Background(),
					`INSERT INTO wiki_pages (wiki_id, page_id, content) VALUES ($1, $2, $3)
					 ON CONFLICT (wiki_id, page_id) DO NOTHING`,
					wikiID, page.ID, string(content),
				)
			}
			migrated++
		}
	}
	if migrated > 0 {
		log.Printf("wiki disk migration: migrated %d wiki(s) from disk to database", migrated)
	}
}

// ── Wiki DB context ───────────────────────────────────────────────────────────

type wikiCtx struct {
	uid      string
	repoSlug string
}

func newWikiCtx(uid, repoSlug string) wikiCtx {
	return wikiCtx{uid: uid, repoSlug: repoSlug}
}

func (wc wikiCtx) loadMeta() *WikiMeta {
	var m WikiMeta
	var pagesJSON []byte
	var stack []string
	var regenPages []string
	var shareToken *string
	err := pool.QueryRow(context.Background(),
		`SELECT id, repo, repo_slug, branch, commit_sha, generated_at, stack, description, pages,
		        share_token, has_custom_config, template_id, source, regenerated_pages
		 FROM wikis WHERE user_id = $1 AND repo_slug = $2`,
		wc.uid, wc.repoSlug,
	).Scan(&m.ID, &m.Repo, &m.RepoSlug, &m.Branch, &m.CommitSHA, &m.GeneratedAt,
		&stack, &m.Description, &pagesJSON,
		&shareToken, &m.HasCustomConfig, &m.TemplateID, &m.Source, &regenPages)
	if err != nil {
		return nil
	}
	m.Stack = stack
	m.RegeneratedPages = regenPages
	if shareToken != nil {
		m.ShareToken = *shareToken
	}
	json.Unmarshal(pagesJSON, &m.Pages)
	return &m
}

func (wc wikiCtx) saveMeta(m WikiMeta) error {
	pagesJSON, _ := json.Marshal(m.Pages)
	var shareToken *string
	if m.ShareToken != "" {
		shareToken = &m.ShareToken
	}
	_, err := pool.Exec(context.Background(),
		`INSERT INTO wikis (id, user_id, repo, repo_slug, branch, commit_sha, generated_at, stack,
		                    description, pages, share_token, has_custom_config, template_id, source, regenerated_pages)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		 ON CONFLICT (user_id, repo_slug) DO UPDATE SET
		   id = EXCLUDED.id,
		   repo = EXCLUDED.repo,
		   branch = EXCLUDED.branch,
		   commit_sha = EXCLUDED.commit_sha,
		   generated_at = EXCLUDED.generated_at,
		   stack = EXCLUDED.stack,
		   description = EXCLUDED.description,
		   pages = EXCLUDED.pages,
		   share_token = EXCLUDED.share_token,
		   has_custom_config = EXCLUDED.has_custom_config,
		   template_id = EXCLUDED.template_id,
		   source = EXCLUDED.source,
		   regenerated_pages = EXCLUDED.regenerated_pages`,
		m.ID, wc.uid, m.Repo, m.RepoSlug, m.Branch, m.CommitSHA, m.GeneratedAt, m.Stack,
		m.Description, pagesJSON, shareToken, m.HasCustomConfig, m.TemplateID, m.Source, m.RegeneratedPages,
	)
	return err
}

func (wc wikiCtx) savePageContent(pageID, content string) error {
	var wikiID string
	err := pool.QueryRow(context.Background(),
		`SELECT id FROM wikis WHERE user_id = $1 AND repo_slug = $2`,
		wc.uid, wc.repoSlug,
	).Scan(&wikiID)
	if err != nil {
		return fmt.Errorf("wiki row not found for %s/%s: %w", wc.uid, wc.repoSlug, err)
	}
	_, err = pool.Exec(context.Background(),
		`INSERT INTO wiki_pages (wiki_id, page_id, content) VALUES ($1, $2, $3)
		 ON CONFLICT (wiki_id, page_id) DO UPDATE SET content = EXCLUDED.content`,
		wikiID, pageID, content,
	)
	return err
}

func (wc wikiCtx) loadPageContent(pageID string) (string, error) {
	var content string
	err := pool.QueryRow(context.Background(),
		`SELECT wp.content FROM wiki_pages wp
		 JOIN wikis w ON wp.wiki_id = w.id
		 WHERE w.user_id = $1 AND w.repo_slug = $2 AND wp.page_id = $3`,
		wc.uid, wc.repoSlug, pageID,
	).Scan(&content)
	return content, err
}

func (wc wikiCtx) countPages() int {
	var count int
	pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM wiki_pages wp
		 JOIN wikis w ON wp.wiki_id = w.id
		 WHERE w.user_id = $1 AND w.repo_slug = $2`,
		wc.uid, wc.repoSlug,
	).Scan(&count)
	return count
}

func repoToSlug(repo string) string {
	return strings.ReplaceAll(repo, "/", "-")
}

func listUserWikis(uid string) []WikiMeta {
	rows, err := pool.Query(context.Background(),
		`SELECT id, repo, repo_slug, branch, commit_sha, generated_at, stack, description, pages,
		        share_token, has_custom_config, template_id, source, regenerated_pages
		 FROM wikis WHERE user_id = $1 ORDER BY generated_at DESC`, uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var result []WikiMeta
	for rows.Next() {
		var m WikiMeta
		var pagesJSON []byte
		var stack []string
		var regenPages []string
		var shareToken *string
		if err := rows.Scan(&m.ID, &m.Repo, &m.RepoSlug, &m.Branch, &m.CommitSHA, &m.GeneratedAt,
			&stack, &m.Description, &pagesJSON,
			&shareToken, &m.HasCustomConfig, &m.TemplateID, &m.Source, &regenPages); err != nil {
			continue
		}
		m.Stack = stack
		m.RegeneratedPages = regenPages
		if shareToken != nil {
			m.ShareToken = *shareToken
		}
		json.Unmarshal(pagesJSON, &m.Pages)
		result = append(result, m)
	}
	return result
}

// ── Wiki file filtering ───────────────────────────────────────────────────────

var excludedDirs = map[string]bool{
	"node_modules": true, "vendor": true, ".git": true, "dist": true,
	"build": true, ".next": true, "__pycache__": true, ".cache": true,
	"coverage": true, ".nyc_output": true, "target": true, "out": true,
	".idea": true, ".vscode": true, "bin": true, "obj": true,
	"generated": true, "gen": true, ".gradle": true,
}

var excludedFiles = map[string]bool{
	"package-lock.json": true, "yarn.lock": true, "go.sum": true,
	"poetry.lock": true, "pnpm-lock.yaml": true, "composer.lock": true,
	"Gemfile.lock": true, "Cargo.lock": true,
}

var excludedExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".ico": true,
	".webp": true, ".bmp": true, ".tiff": true,
	".woff": true, ".woff2": true, ".ttf": true, ".eot": true, ".otf": true,
	".pdf": true, ".zip": true, ".tar": true, ".gz": true, ".rar": true,
	".exe": true, ".dll": true, ".so": true, ".dylib": true, ".class": true,
	".jar": true, ".war": true, ".pyc": true, ".pyo": true,
	".mp3": true, ".mp4": true, ".avi": true, ".mov": true, ".wav": true,
	".svg": true, // often large/generated
}

var priorityFiles = []string{
	"README.md", "README.txt", "README",
	"main.go", "main.py", "index.js", "index.ts", "app.js", "app.ts",
	"App.jsx", "App.tsx", "server.js", "server.ts",
	"package.json", "go.mod", "requirements.txt", "pyproject.toml",
	"Cargo.toml", "pom.xml", "build.gradle", "Gemfile", "composer.json",
}

type RepoFile struct {
	Path string
	Size int
}

type treeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	Size int    `json:"size"`
}

func filterRepoFiles(tree []treeEntry) []RepoFile {
	var result []RepoFile
	seen := map[string]bool{}

	// Priority files first
	for _, pf := range priorityFiles {
		for _, item := range tree {
			if item.Type != "blob" { continue }
			base := filepath.Base(item.Path)
			if base == pf && !seen[item.Path] {
				seen[item.Path] = true
				result = append(result, RepoFile{Path: item.Path, Size: item.Size})
			}
		}
	}

	// Then remaining source files
	for _, item := range tree {
		if item.Type != "blob" || seen[item.Path] { continue }
		if item.Size > 150000 { continue } // skip files > 150KB

		// Check excluded dirs
		parts := strings.Split(item.Path, "/")
		excluded := false
		for _, part := range parts[:len(parts)-1] {
			if excludedDirs[part] { excluded = true; break }
			if strings.HasPrefix(part, ".") { excluded = true; break }
		}
		if excluded { continue }

		// Check excluded filenames and extensions
		base := filepath.Base(item.Path)
		ext := strings.ToLower(filepath.Ext(base))
		if excludedFiles[base] || excludedExts[ext] { continue }

		// Skip minified files
		if strings.Contains(base, ".min.") { continue }

		seen[item.Path] = true
		result = append(result, RepoFile{Path: item.Path, Size: item.Size})
	}

	return result
}

func detectStack(files []RepoFile, fetchContent func(path string) (string, error)) []string {
	var stack []string
	fileMap := map[string]bool{}
	for _, f := range files { fileMap[f.Path] = true }

	// Check presence of key files
	if fileMap["package.json"] {
		content, err := fetchContent("package.json")
		if err == nil {
			if strings.Contains(content, `"react"`) { stack = append(stack, "React") }
			if strings.Contains(content, `"vue"`) { stack = append(stack, "Vue.js") }
			if strings.Contains(content, `"next"`) { stack = append(stack, "Next.js") }
			if strings.Contains(content, `"express"`) { stack = append(stack, "Express") }
			if strings.Contains(content, `"typescript"`) || strings.Contains(content, `"ts-node"`) { stack = append(stack, "TypeScript") }
			if len(stack) == 0 { stack = append(stack, "Node.js") }
		}
	}
	for _, f := range files {
		if f.Path == "go.mod" || strings.HasSuffix(f.Path, "/go.mod") { stack = append(stack, "Go"); break }
	}
	for _, f := range files {
		base := filepath.Base(f.Path)
		if base == "requirements.txt" || base == "pyproject.toml" || base == "setup.py" {
			stack = append(stack, "Python"); break
		}
	}
	for _, f := range files {
		if filepath.Base(f.Path) == "Cargo.toml" { stack = append(stack, "Rust"); break }
	}
	for _, f := range files {
		if filepath.Base(f.Path) == "pom.xml" || filepath.Base(f.Path) == "build.gradle" {
			stack = append(stack, "Java"); break
		}
	}
	if len(stack) == 0 { stack = append(stack, "Unknown") }
	return stack
}

// ── AI call helper ────────────────────────────────────────────────────────────

func callAI(ctx interface{ Done() <-chan struct{} }, settings UserSettings, systemPrompt, userMsg string) (string, error) {
	if settings.AIProvider == "openai" {
		reqBody, _ := json.Marshal(map[string]interface{}{
			"model":      settings.OpenAIModel,
			"max_tokens": 8192,
			"messages": []map[string]string{
				{"role": "system", "content": systemPrompt},
				{"role": "user", "content": userMsg},
			},
		})
		req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", strings.NewReader(string(reqBody)))
		if err != nil { return "", err }
		req.Header.Set("Authorization", "Bearer "+settings.OpenAIAPIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil { return "", fmt.Errorf("failed to call OpenAI: %w", err) }
		defer resp.Body.Close()
		var r struct {
			Choices []struct { Message struct { Content string `json:"content"` } `json:"message"` } `json:"choices"`
			Error *struct { Message string `json:"message"` } `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&r)
		if r.Error != nil { return "", fmt.Errorf("%s", r.Error.Message) }
		if len(r.Choices) == 0 { return "", fmt.Errorf("empty response from OpenAI") }
		return r.Choices[0].Message.Content, nil
	}
	// Anthropic
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model": settings.Model, "max_tokens": 8192, "system": systemPrompt,
		"messages": []map[string]string{{"role": "user", "content": userMsg}},
	})
	req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", strings.NewReader(string(reqBody)))
	if err != nil { return "", err }
	req.Header.Set("x-api-key", settings.AnthropicAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return "", fmt.Errorf("failed to call Anthropic: %w", err) }
	defer resp.Body.Close()
	var r struct {
		Content []struct { Text string `json:"text"` } `json:"content"`
		Error *struct { Message string `json:"message"` } `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&r)
	if r.Error != nil { return "", fmt.Errorf("%s", r.Error.Message) }
	if len(r.Content) == 0 { return "", fmt.Errorf("empty response from Claude") }
	return r.Content[0].Text, nil
}

// ── AI inline edit ────────────────────────────────────────────────────────────

func aiInlineEdit(c *gin.Context) {
	var body struct {
		Text        string `json:"text"`
		Instruction string `json:"instruction"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Text == "" || body.Instruction == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text and instruction are required"})
		return
	}
	settings := loadSettings(me(c).ID)
	if settings.AnthropicAPIKey == "" && settings.OpenAIAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no AI API key configured"})
		return
	}
	system := `You are a markdown editor assistant. The user will provide a piece of markdown text and an instruction. Return ONLY the rewritten markdown — no explanation, no preamble, no code fences wrapping the whole result. Preserve markdown formatting conventions.`
	userMsg := "Instruction: " + body.Instruction + "\n\nText:\n" + body.Text
	result, err := callAI(c.Request.Context(), settings, system, userMsg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": result})
}

// ── FileMeta ──────────────────────────────────────────────────────────────────

type FileMeta struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	Ext        string    `json:"ext"`
	UploadedAt time.Time `json:"uploaded_at"`
	FolderID   string    `json:"folder_id,omitempty"`
}

// ── Folder ────────────────────────────────────────────────────────────────────

type Folder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type folderCtx struct{ uid string }

func newFolderCtx(uid string) folderCtx {
	return folderCtx{uid: uid}
}

func (fc folderCtx) load() []Folder {
	rows, err := pool.Query(context.Background(),
		`SELECT id, name FROM folders WHERE user_id = $1 ORDER BY name`, fc.uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var folders []Folder
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name); err == nil {
			folders = append(folders, f)
		}
	}
	return folders
}

func (fc folderCtx) save(folders []Folder) {
	ctx := context.Background()
	pool.Exec(ctx, `DELETE FROM folders WHERE user_id = $1`, fc.uid)
	for _, f := range folders {
		pool.Exec(ctx,
			`INSERT INTO folders (id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
			f.ID, fc.uid, f.Name,
		)
	}
}

// ── Per-user file context ─────────────────────────────────────────────────────

func userDir(uid string) string {
	return filepath.Join(uploadsDir, "users", uid)
}

type fileCtx struct {
	uid string
	dir string
}

func newFileCtx(uid string) fileCtx {
	d := userDir(uid)
	os.MkdirAll(d, 0755)
	return fileCtx{uid: uid, dir: d}
}

func (fc fileCtx) loadMeta() []FileMeta {
	rows, err := pool.Query(context.Background(),
		`SELECT id, name, size, ext, folder_id, uploaded_at FROM files WHERE user_id = $1 ORDER BY uploaded_at DESC`, fc.uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var files []FileMeta
	for rows.Next() {
		var f FileMeta
		if err := rows.Scan(&f.ID, &f.Name, &f.Size, &f.Ext, &f.FolderID, &f.UploadedAt); err == nil {
			files = append(files, f)
		}
	}
	return files
}

func (fc fileCtx) saveMeta(files []FileMeta) {
	ctx := context.Background()
	for _, f := range files {
		pool.Exec(ctx,
			`INSERT INTO files (id, user_id, name, size, ext, folder_id, uploaded_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, size = EXCLUDED.size, folder_id = EXCLUDED.folder_id`,
			f.ID, fc.uid, f.Name, f.Size, f.Ext, f.FolderID, f.UploadedAt,
		)
	}
}

func (fc fileCtx) filePath(id, ext string) string {
	return filepath.Join(fc.dir, id+ext)
}

func (fc fileCtx) filePathFor(id string) string {
	for _, f := range fc.loadMeta() {
		if f.ID == id {
			return fc.filePath(id, f.Ext)
		}
	}
	return fc.filePath(id, ".mf4")
}

// ── Auth middleware ────────────────────────────────────────────────────────────

func authMiddleware(c *gin.Context) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	userID, err := authStore.ValidateToken(strings.TrimPrefix(header, "Bearer "))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
		return
	}
	user := authStore.FindByID(userID)
	if user == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	c.Set("user", user)
	c.Next()
}

func me(c *gin.Context) *auth.User {
	u, _ := c.Get("user")
	return u.(*auth.User)
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

func authConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"google_enabled": googleAuthConf != nil})
}

func authRegister(c *gin.Context) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	user, err := authStore.Register(body.Email, body.Name, body.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	token, err := authStore.GenerateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}
	ensurePersonalOrg(user.ID, user.Name)
	c.JSON(http.StatusCreated, gin.H{
		"token": token,
		"user":  gin.H{"id": user.ID, "email": user.Email, "name": user.Name, "avatar_url": user.AvatarURL},
	})
}

func authLogin(c *gin.Context) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	user, err := authStore.Login(body.Email, body.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	token, err := authStore.GenerateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}
	ensurePersonalOrg(user.ID, user.Name)
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  gin.H{"id": user.ID, "email": user.Email, "name": user.Name, "avatar_url": user.AvatarURL},
	})
}

func authMe(c *gin.Context) {
	user := me(c)
	c.JSON(http.StatusOK, gin.H{
		"id": user.ID, "email": user.Email, "name": user.Name,
		"avatar_url": user.AvatarURL, "is_super_admin": isSuperAdmin(user),
	})
}

// ── OAuth security helpers ────────────────────────────────────────────────────

// oauthEntry holds a short-lived value (origin or token) with an expiry.
type oauthEntry struct {
	value   string
	expires time.Time
}

var (
	oauthNonces   sync.Map // nonce  → origin  (10-min TTL; prevents CSRF + open-redirect)
	exchangeCodes sync.Map // code   → secret  (60-sec TTL; keeps tokens out of URLs)
)

func init() {
	// Background goroutine sweeps expired entries every minute.
	go func() {
		for range time.Tick(time.Minute) {
			now := time.Now()
			oauthNonces.Range(func(k, v any) bool {
				if v.(oauthEntry).expires.Before(now) {
					oauthNonces.Delete(k)
				}
				return true
			})
			exchangeCodes.Range(func(k, v any) bool {
				if v.(oauthEntry).expires.Before(now) {
					exchangeCodes.Delete(k)
				}
				return true
			})
		}
	}()
}

// allowedOrigins returns the set of origins that OAuth flows may redirect back to.
func allowedOrigins() map[string]bool {
	allowed := map[string]bool{
		"http://localhost:5173": true,
		"http://localhost:8080": true,
	}
	if domain := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); domain != "" {
		allowed["https://"+domain] = true
	}
	// Space-separated extra origins, e.g. ALLOWED_ORIGINS="https://app.example.com"
	for _, o := range strings.Fields(os.Getenv("ALLOWED_ORIGINS")) {
		allowed[o] = true
	}
	return allowed
}

// oauthStartState validates origin, stores a nonce→origin mapping and returns
// the opaque state string to embed in the OAuth authorization URL.
func oauthStartState(origin string) (string, bool) {
	if !allowedOrigins()[origin] {
		return "", false
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", false
	}
	state := base64.RawURLEncoding.EncodeToString(b)
	oauthNonces.Store(state, oauthEntry{value: origin, expires: time.Now().Add(10 * time.Minute)})
	return state, true
}

// oauthCallbackOrigin validates the state nonce and returns the stored origin.
// The nonce is consumed (deleted) so it cannot be replayed.
func oauthCallbackOrigin(state string) (string, bool) {
	v, ok := oauthNonces.LoadAndDelete(state)
	if !ok {
		return "", false
	}
	e := v.(oauthEntry)
	if time.Now().After(e.expires) {
		return "", false
	}
	return e.value, true
}

// newExchangeCode stores a secret under a one-time code with a 60-second TTL.
// The code is safe to pass in a redirect URL; the actual secret never touches URLs.
func newExchangeCode(secret string) string {
	b := make([]byte, 24)
	rand.Read(b)
	code := base64.RawURLEncoding.EncodeToString(b)
	exchangeCodes.Store(code, oauthEntry{value: secret, expires: time.Now().Add(60 * time.Second)})
	return code
}

// consumeExchangeCode atomically retrieves and deletes a one-time code.
func consumeExchangeCode(code string) (string, bool) {
	v, ok := exchangeCodes.LoadAndDelete(code)
	if !ok {
		return "", false
	}
	e := v.(oauthEntry)
	if time.Now().After(e.expires) {
		return "", false
	}
	return e.value, true
}

func googleAuthStart(c *gin.Context) {
	if googleAuthConf == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google auth not configured"})
		return
	}
	origin := c.DefaultQuery("origin", "http://localhost:5173")
	state, ok := oauthStartState(origin)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid origin"})
		return
	}
	c.Redirect(http.StatusFound, googleAuthConf.AuthCodeURL(state, oauth2.AccessTypeOnline))
}

func googleAuthCallback(c *gin.Context) {
	if googleAuthConf == nil {
		c.String(http.StatusServiceUnavailable, "Google auth not configured")
		return
	}
	code := c.Query("code")
	origin, ok := oauthCallbackOrigin(c.Query("state"))
	if !ok {
		c.String(http.StatusBadRequest, "invalid or expired OAuth state")
		return
	}
	if code == "" {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	token, err := googleAuthConf.Exchange(c.Request.Context(), code)
	if err != nil {
		log.Printf("google auth exchange: %v", err)
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	resp, err := googleAuthConf.Client(c.Request.Context(), token).Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil || resp.StatusCode != 200 {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	defer resp.Body.Close()
	var profile struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	user, err := authStore.UpsertGoogle(profile.ID, profile.Email, profile.Name, profile.Picture)
	if err != nil {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	ensurePersonalOrg(user.ID, user.Name)
	authToken, err := authStore.GenerateToken(user.ID)
	if err != nil {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	// Issue a short-lived exchange code instead of putting the JWT in the URL.
	exchangeCode := newExchangeCode(authToken)
	c.Redirect(http.StatusFound, origin+"?auth_code="+url.QueryEscape(exchangeCode))
}

// ── File handlers ─────────────────────────────────────────────────────────────

func listFiles(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	files := fc.loadMeta()
	if files == nil {
		files = []FileMeta{}
	}
	c.JSON(http.StatusOK, files)
}

func uploadFile(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if !map[string]bool{".mf4": true, ".mdf": true, ".md": true, ".json": true}[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .mf4, .mdf, .md, and .json files are supported"})
		return
	}
	id := uuid.New().String()
	if err := c.SaveUploadedFile(fh, fc.filePath(id, ext)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}
	meta := FileMeta{ID: id, Name: fh.Filename, Size: fh.Size, Ext: ext, UploadedAt: time.Now()}
	files := fc.loadMeta()
	files = append(files, meta)
	fc.saveMeta(files)
	c.JSON(http.StatusCreated, meta)
}

func deleteFile(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	id := c.Param("id")
	files := fc.loadMeta()
	idx := -1
	for i, f := range files {
		if f.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	os.Remove(fc.filePath(id, files[idx].Ext))
	pool.Exec(context.Background(), `DELETE FROM files WHERE id = $1 AND user_id = $2`, id, fc.uid)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func getFileInfo(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	path := fc.filePathFor(c.Param("id"))
	p, err := mdf.Open(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("failed to parse MDF: %v", err)})
		return
	}
	defer p.Close()
	info, err := p.GetFileInfo()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, info)
}

func getFileContent(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	data, err := os.ReadFile(fc.filePathFor(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
}

func saveFileContent(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	id := c.Param("id")
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	if err := os.WriteFile(fc.filePathFor(id), body, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}
	files := fc.loadMeta()
	for i, f := range files {
		if f.ID == id {
			files[i].Size = int64(len(body))
			break
		}
	}
	fc.saveMeta(files)
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

func getChannelData(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	name := c.Query("name")
	group, _ := strconv.Atoi(c.DefaultQuery("group", "0"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name query param required"})
		return
	}
	p, err := mdf.Open(fc.filePathFor(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer p.Close()
	sig, err := p.GetChannelData(group, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sig)
}

// ── Settings handlers ─────────────────────────────────────────────────────────

func getSettings(c *gin.Context) {
	s := loadSettings(me(c).ID)
	c.JSON(http.StatusOK, s)
}

func putSettings(c *gin.Context) {
	var body UserSettings
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if body.Model == "" {
		body.Model = "claude-sonnet-4-6"
	}
	if !validModels[body.Model] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid model"})
		return
	}
	if body.AIProvider == "" {
		body.AIProvider = "anthropic"
	}
	if body.AIProvider != "anthropic" && body.AIProvider != "openai" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ai_provider"})
		return
	}
	if body.OpenAIModel == "" {
		body.OpenAIModel = "gpt-4o"
	}
	if !validOpenAIModels[body.OpenAIModel] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid openai_model"})
		return
	}
	if err := saveSettings(me(c).ID, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

// ── Folder handlers ───────────────────────────────────────────────────────────

func listFolders(c *gin.Context) {
	fc := newFolderCtx(me(c).ID)
	folders := fc.load()
	if folders == nil {
		folders = []Folder{}
	}
	c.JSON(http.StatusOK, folders)
}

func createFolder(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}
	fc := newFolderCtx(me(c).ID)
	folder := Folder{ID: uuid.New().String(), Name: strings.TrimSpace(body.Name)}
	folders := fc.load()
	folders = append(folders, folder)
	fc.save(folders)
	c.JSON(http.StatusCreated, folder)
}

func deleteFolder(c *gin.Context) {
	fid := c.Param("folderid")
	fc := newFolderCtx(me(c).ID)
	folders := fc.load()
	idx := -1
	for i, f := range folders {
		if f.ID == fid {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		return
	}
	folders = append(folders[:idx], folders[idx+1:]...)
	fc.save(folders)
	// Unassign files in this folder
	fileCtx := newFileCtx(me(c).ID)
	files := fileCtx.loadMeta()
	for i := range files {
		if files[i].FolderID == fid {
			files[i].FolderID = ""
		}
	}
	fileCtx.saveMeta(files)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func assignFileFolder(c *gin.Context) {
	fc := newFileCtx(me(c).ID)
	id := c.Param("id")
	var body struct {
		FolderID string `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	files := fc.loadMeta()
	for i, f := range files {
		if f.ID == id {
			files[i].FolderID = body.FolderID
			fc.saveMeta(files)
			c.JSON(http.StatusOK, files[i])
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
}

// ── Drive handlers (unchanged from original) ──────────────────────────────────

func driveRequired(c *gin.Context) {
	if driveClient == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable,
			gin.H{"error": "Google Drive is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"})
	}
}

func driveStatus(c *gin.Context) {
	if driveClient == nil {
		c.JSON(http.StatusOK, gin.H{
			"configured": false, "connected": false, "folder": nil,
			"redirect_uri": activeRedirectURI,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"configured":   true,
		"connected":    driveClient.Connected(),
		"folder":       driveClient.GetFolder(),
		"redirect_uri": activeRedirectURI,
	})
}

func driveAuth(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	origin := c.DefaultQuery("origin", "http://localhost:5173")
	state, ok := oauthStartState(origin)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid origin"})
		return
	}
	c.Redirect(http.StatusFound, driveClient.AuthURL(state))
}

func driveCallback(c *gin.Context) {
	if driveClient == nil {
		c.String(http.StatusServiceUnavailable, "Drive not configured")
		return
	}
	code := c.Query("code")
	origin, ok := oauthCallbackOrigin(c.Query("state"))
	if !ok {
		c.String(http.StatusBadRequest, "invalid or expired OAuth state")
		return
	}
	if code == "" {
		c.Redirect(http.StatusFound, origin+"?drive=error")
		return
	}
	if err := driveClient.Exchange(c.Request.Context(), code); err != nil {
		log.Printf("Drive OAuth exchange error: %v", err)
		c.Redirect(http.StatusFound, origin+"?drive=error")
		return
	}
	c.Redirect(http.StatusFound, origin+"?drive=connected")
}

func driveDisconnect(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	driveClient.Disconnect()
	c.JSON(http.StatusOK, gin.H{"message": "disconnected"})
}

func driveListFolders(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	folders, err := driveClient.ListFolders(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, folders)
}

func driveSetFolder(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id and name required"})
		return
	}
	if err := driveClient.SetFolder(body.ID, body.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": body.ID, "name": body.Name})
}

func driveListFiles(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	files, err := driveClient.ListFiles(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if files == nil {
		files = []drive.DriveFile{}
	}
	c.JSON(http.StatusOK, files)
}

func driveUploadFile(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if ext != ".mf4" && ext != ".mdf" && ext != ".md" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .mf4, .mdf, and .md files are supported"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open file"})
		return
	}
	defer f.Close()
	df, err := driveClient.UploadFile(c.Request.Context(), fh.Filename, f)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, df)
}

func driveDeleteFile(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	if err := driveClient.DeleteFile(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func driveFileInfo(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	localPath, err := driveClient.DownloadToTemp(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	p, err := mdf.Open(localPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("failed to parse MDF: %v", err)})
		return
	}
	defer p.Close()
	info, err := p.GetFileInfo()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, info)
}

func driveFileContent(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	data, err := driveClient.GetContent(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
}

func driveSaveContent(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	if err := driveClient.UpdateContent(c.Request.Context(), c.Param("id"), body); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

func driveChannelData(c *gin.Context) {
	driveRequired(c)
	if c.IsAborted() {
		return
	}
	name := c.Query("name")
	group, _ := strconv.Atoi(c.DefaultQuery("group", "0"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name query param required"})
		return
	}
	localPath, err := driveClient.DownloadToTemp(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	p, err := mdf.Open(localPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer p.Close()
	sig, err := p.GetChannelData(group, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sig)
}

// ── GitHub handlers ───────────────────────────────────────────────────────────

type GitHubAccount struct {
	Login string `json:"login"`
	Token string `json:"token"`
}

func loadGitHubAccounts(uid string) []GitHubAccount {
	rows, err := pool.Query(context.Background(),
		`SELECT login, token FROM github_accounts WHERE user_id = $1 ORDER BY login`, uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var accounts []GitHubAccount
	for rows.Next() {
		var a GitHubAccount
		if err := rows.Scan(&a.Login, &a.Token); err == nil {
			accounts = append(accounts, a)
		}
	}
	return accounts
}

func saveGitHubAccounts(uid string, accounts []GitHubAccount) error {
	ctx := context.Background()
	_, err := pool.Exec(ctx, `DELETE FROM github_accounts WHERE user_id = $1`, uid)
	if err != nil {
		return err
	}
	for _, a := range accounts {
		_, err = pool.Exec(ctx,
			`INSERT INTO github_accounts (user_id, login, token) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, login) DO UPDATE SET token = EXCLUDED.token`,
			uid, a.Login, a.Token,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func githubTokenForLogin(uid, login string) string {
	for _, a := range loadGitHubAccounts(uid) {
		if a.Login == login {
			return a.Token
		}
	}
	return ""
}

// tokenForRepo picks the first account token that can access the given repo owner.
// If owner matches a connected login exactly use that; otherwise fall back to first token.
func githubTokenForRepo(uid, repoFullName string) string {
	accounts := loadGitHubAccounts(uid)
	if len(accounts) == 0 {
		return ""
	}
	owner := repoFullName
	if idx := strings.Index(repoFullName, "/"); idx >= 0 {
		owner = repoFullName[:idx]
	}
	for _, a := range accounts {
		if strings.EqualFold(a.Login, owner) {
			return a.Token
		}
	}
	return accounts[0].Token
}

func doGitHubRequest(ctx interface{ Done() <-chan struct{} }, token, method, url string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

func githubAuthStart(c *gin.Context) {
	if githubOAuthConf == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitHub auth not configured"})
		return
	}
	origin := c.DefaultQuery("origin", "http://localhost:5173")
	state, ok := oauthStartState(origin)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid origin"})
		return
	}
	c.Redirect(http.StatusFound, githubOAuthConf.AuthCodeURL(state, oauth2.AccessTypeOnline))
}

func githubAuthCallback(c *gin.Context) {
	if githubOAuthConf == nil {
		c.String(http.StatusServiceUnavailable, "GitHub auth not configured")
		return
	}
	code := c.Query("code")
	origin, ok := oauthCallbackOrigin(c.Query("state"))
	if !ok {
		c.String(http.StatusBadRequest, "invalid or expired OAuth state")
		return
	}
	if code == "" {
		c.Redirect(http.StatusFound, origin+"?github=error")
		return
	}
	token, err := githubOAuthConf.Exchange(c.Request.Context(), code)
	if err != nil {
		log.Printf("github auth exchange: %v", err)
		c.Redirect(http.StatusFound, origin+"?github=error")
		return
	}
	exchangeCode := newExchangeCode(token.AccessToken)
	c.Redirect(http.StatusFound, origin+"?github_code="+url.QueryEscape(exchangeCode))
}

func githubSaveToken(c *gin.Context) {
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AccessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "access_token required"})
		return
	}
	uid := me(c).ID
	os.MkdirAll(userDir(uid), 0755)

	// Look up the login for this token
	resp, err := doGitHubRequest(c.Request.Context(), body.AccessToken, "GET", "https://api.github.com/user", nil)
	if err != nil || resp.StatusCode != 200 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not verify GitHub token"})
		if resp != nil {
			resp.Body.Close()
		}
		return
	}
	defer resp.Body.Close()
	var profile struct {
		Login string `json:"login"`
	}
	json.NewDecoder(resp.Body).Decode(&profile)

	// Upsert into accounts list (replace if same login)
	accounts := loadGitHubAccounts(uid)
	found := false
	for i, a := range accounts {
		if a.Login == profile.Login {
			accounts[i].Token = body.AccessToken
			found = true
			break
		}
	}
	if !found {
		accounts = append(accounts, GitHubAccount{Login: profile.Login, Token: body.AccessToken})
	}
	if err := saveGitHubAccounts(uid, accounts); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"login": profile.Login})
}

// githubStatus returns all connected accounts (not just one)
func githubStatus(c *gin.Context) {
	accounts := loadGitHubAccounts(me(c).ID)
	logins := make([]string, 0, len(accounts))
	for _, a := range accounts {
		logins = append(logins, a.Login)
	}
	c.JSON(http.StatusOK, gin.H{
		"connected":  len(accounts) > 0,
		"configured": githubOAuthConf != nil,
		"accounts":   logins,
	})
}

// githubDisconnect removes a specific account by login (?login=xxx), or all if not specified
func githubDisconnect(c *gin.Context) {
	uid := me(c).ID
	login := c.Query("login")
	if login == "" {
		// Remove all
		pool.Exec(context.Background(), `DELETE FROM github_accounts WHERE user_id = $1`, uid)
		c.JSON(http.StatusOK, gin.H{"message": "disconnected"})
		return
	}
	accounts := loadGitHubAccounts(uid)
	filtered := accounts[:0]
	for _, a := range accounts {
		if a.Login != login {
			filtered = append(filtered, a)
		}
	}
	saveGitHubAccounts(uid, filtered)
	c.JSON(http.StatusOK, gin.H{"message": "disconnected"})
}

func githubListRepos(c *gin.Context) {
	uid := me(c).ID
	accounts := loadGitHubAccounts(uid)
	if len(accounts) == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitHub"})
		return
	}

	type RepoInfo struct {
		ID            int    `json:"id"`
		FullName      string `json:"full_name"`
		DefaultBranch string `json:"default_branch"`
		Private       bool   `json:"private"`
		Description   string `json:"description"`
		Account       string `json:"account"`
	}

	seen := map[int]bool{}
	out := make([]RepoInfo, 0)

	for _, acct := range accounts {
		resp, err := doGitHubRequest(c.Request.Context(), acct.Token, "GET",
			"https://api.github.com/user/repos?per_page=100&sort=updated&type=all", nil)
		if err != nil {
			continue
		}
		var repos []map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&repos)
		resp.Body.Close()
		for _, r := range repos {
			ri := RepoInfo{Account: acct.Login}
			if v, ok := r["id"].(float64); ok {
				ri.ID = int(v)
			}
			if seen[ri.ID] {
				continue
			}
			seen[ri.ID] = true
			if v, ok := r["full_name"].(string); ok {
				ri.FullName = v
			}
			if v, ok := r["default_branch"].(string); ok {
				ri.DefaultBranch = v
			}
			if v, ok := r["private"].(bool); ok {
				ri.Private = v
			}
			if v, ok := r["description"].(string); ok {
				ri.Description = v
			}
			out = append(out, ri)
		}
	}
	c.JSON(http.StatusOK, out)
}

func githubGetTree(c *gin.Context) {
	uid := me(c).ID
	repo := c.Query("repo")
	branch := c.DefaultQuery("branch", "main")
	if repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo required"})
		return
	}
	token := githubTokenForRepo(uid, repo)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitHub"})
		return
	}
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", repo, branch)
	resp, err := doGitHubRequest(c.Request.Context(), token, "GET", apiURL, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	var result struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
			Size int    `json:"size"`
		} `json:"tree"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to parse tree"})
		return
	}
	c.JSON(http.StatusOK, result.Tree)
}

func githubGetContent(c *gin.Context) {
	uid := me(c).ID
	repo := c.Query("repo")
	path := c.Query("path")
	branch := c.DefaultQuery("branch", "main")
	if repo == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo and path required"})
		return
	}
	token := githubTokenForRepo(uid, repo)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitHub"})
		return
	}
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s", repo, path, branch)
	resp, err := doGitHubRequest(c.Request.Context(), token, "GET", apiURL, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	var result struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to parse content"})
		return
	}
	if result.Encoding != "base64" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "unexpected encoding"})
		return
	}
	cleaned := strings.ReplaceAll(result.Content, "\n", "")
	decoded, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to decode content"})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", decoded)
}

// ── GitLab handlers ───────────────────────────────────────────────────────────

type GitLabAccount struct {
	Username string `json:"username"`
	Token    string `json:"token"`
}

func loadGitLabAccounts(uid string) []GitLabAccount {
	rows, err := pool.Query(context.Background(),
		`SELECT username, token FROM gitlab_accounts WHERE user_id = $1 ORDER BY username`, uid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var accounts []GitLabAccount
	for rows.Next() {
		var a GitLabAccount
		if err := rows.Scan(&a.Username, &a.Token); err == nil {
			accounts = append(accounts, a)
		}
	}
	return accounts
}

func saveGitLabAccounts(uid string, accounts []GitLabAccount) error {
	ctx := context.Background()
	_, err := pool.Exec(ctx, `DELETE FROM gitlab_accounts WHERE user_id = $1`, uid)
	if err != nil {
		return err
	}
	for _, a := range accounts {
		_, err = pool.Exec(ctx,
			`INSERT INTO gitlab_accounts (user_id, username, token) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, username) DO UPDATE SET token = EXCLUDED.token`,
			uid, a.Username, a.Token,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func gitlabTokenForUser(uid string) string {
	accounts := loadGitLabAccounts(uid)
	if len(accounts) == 0 {
		return ""
	}
	return accounts[0].Token
}

func doGitLabRequest(ctx interface{ Done() <-chan struct{} }, token, method, apiURL string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, apiURL, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

func gitlabAuthStart(c *gin.Context) {
	if gitlabOAuthConf == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitLab auth not configured"})
		return
	}
	origin := c.DefaultQuery("origin", "http://localhost:5173")
	state, ok := oauthStartState(origin)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid origin"})
		return
	}
	c.Redirect(http.StatusFound, gitlabOAuthConf.AuthCodeURL(state, oauth2.AccessTypeOnline))
}

func gitlabAuthCallback(c *gin.Context) {
	if gitlabOAuthConf == nil {
		c.String(http.StatusServiceUnavailable, "GitLab auth not configured")
		return
	}
	code := c.Query("code")
	origin, ok := oauthCallbackOrigin(c.Query("state"))
	if !ok {
		c.String(http.StatusBadRequest, "invalid or expired OAuth state")
		return
	}
	if code == "" {
		c.Redirect(http.StatusFound, origin+"?gitlab=error")
		return
	}
	token, err := gitlabOAuthConf.Exchange(c.Request.Context(), code)
	if err != nil {
		log.Printf("gitlab auth exchange: %v", err)
		c.Redirect(http.StatusFound, origin+"?gitlab=error")
		return
	}
	exchangeCode := newExchangeCode(token.AccessToken)
	c.Redirect(http.StatusFound, origin+"?gitlab_code="+url.QueryEscape(exchangeCode))
}

// ── Exchange-code endpoints ───────────────────────────────────────────────────
// These let the frontend convert a short-lived one-time code (safe in URLs)
// into the actual secret without ever putting the secret in a URL.

func authExchange(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
		return
	}
	token, ok := consumeExchangeCode(code)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

func githubExchange(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
		return
	}
	token, ok := consumeExchangeCode(code)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

func gitlabExchange(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
		return
	}
	token, ok := consumeExchangeCode(code)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

func gitlabSaveToken(c *gin.Context) {
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AccessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "access_token required"})
		return
	}
	uid := me(c).ID
	os.MkdirAll(userDir(uid), 0755)

	resp, err := doGitLabRequest(c.Request.Context(), body.AccessToken, "GET", "https://gitlab.com/api/v4/user", nil)
	if err != nil || resp.StatusCode != 200 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not verify GitLab token"})
		if resp != nil {
			resp.Body.Close()
		}
		return
	}
	defer resp.Body.Close()
	var profile struct {
		Username string `json:"username"`
	}
	json.NewDecoder(resp.Body).Decode(&profile)

	accounts := loadGitLabAccounts(uid)
	found := false
	for i, a := range accounts {
		if a.Username == profile.Username {
			accounts[i].Token = body.AccessToken
			found = true
			break
		}
	}
	if !found {
		accounts = append(accounts, GitLabAccount{Username: profile.Username, Token: body.AccessToken})
	}
	if err := saveGitLabAccounts(uid, accounts); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": profile.Username})
}

func gitlabStatus(c *gin.Context) {
	accounts := loadGitLabAccounts(me(c).ID)
	usernames := make([]string, 0, len(accounts))
	for _, a := range accounts {
		usernames = append(usernames, a.Username)
	}
	c.JSON(http.StatusOK, gin.H{
		"connected":  len(accounts) > 0,
		"configured": gitlabOAuthConf != nil,
		"accounts":   usernames,
	})
}

func gitlabDisconnect(c *gin.Context) {
	uid := me(c).ID
	username := c.Query("username")
	if username == "" {
		pool.Exec(context.Background(), `DELETE FROM gitlab_accounts WHERE user_id = $1`, uid)
		c.JSON(http.StatusOK, gin.H{"message": "disconnected"})
		return
	}
	accounts := loadGitLabAccounts(uid)
	filtered := accounts[:0]
	for _, a := range accounts {
		if a.Username != username {
			filtered = append(filtered, a)
		}
	}
	saveGitLabAccounts(uid, filtered)
	c.JSON(http.StatusOK, gin.H{"message": "disconnected"})
}

func gitlabListRepos(c *gin.Context) {
	uid := me(c).ID
	accounts := loadGitLabAccounts(uid)
	if len(accounts) == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitLab"})
		return
	}

	type RepoInfo struct {
		ID            int    `json:"id"`
		FullName      string `json:"full_name"`
		DefaultBranch string `json:"default_branch"`
		Private       bool   `json:"private"`
		Description   string `json:"description"`
		Account       string `json:"account"`
		Source        string `json:"source"`
	}

	seen := map[int]bool{}
	out := make([]RepoInfo, 0)

	for _, acct := range accounts {
		page := 1
		for {
			apiURL := fmt.Sprintf("https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&sort=desc&page=%d", page)
			resp, err := doGitLabRequest(c.Request.Context(), acct.Token, "GET", apiURL, nil)
			if err != nil {
				break
			}
			var projects []map[string]interface{}
			json.NewDecoder(resp.Body).Decode(&projects)
			resp.Body.Close()
			if len(projects) == 0 {
				break
			}
			for _, p := range projects {
				ri := RepoInfo{Account: acct.Username, Source: "gitlab"}
				if v, ok := p["id"].(float64); ok {
					ri.ID = int(v)
				}
				if seen[ri.ID] {
					continue
				}
				seen[ri.ID] = true
				if v, ok := p["path_with_namespace"].(string); ok {
					ri.FullName = v
				}
				if v, ok := p["default_branch"].(string); ok {
					ri.DefaultBranch = v
				}
				if v, ok := p["visibility"].(string); ok {
					ri.Private = v == "private"
				}
				if v, ok := p["description"].(string); ok {
					ri.Description = v
				}
				out = append(out, ri)
			}
			if len(projects) < 100 {
				break
			}
			page++
		}
	}
	c.JSON(http.StatusOK, out)
}

func gitlabGetTree(c *gin.Context) {
	uid := me(c).ID
	repo := c.Query("repo")
	branch := c.DefaultQuery("branch", "main")
	if repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo required"})
		return
	}
	token := gitlabTokenForUser(uid)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitLab"})
		return
	}
	encodedRepo := url.PathEscape(repo)
	var allItems []treeEntry
	page := 1
	for {
		apiURL := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/tree?recursive=true&ref=%s&per_page=100&page=%d", encodedRepo, url.QueryEscape(branch), page)
		resp, err := doGitLabRequest(c.Request.Context(), token, "GET", apiURL, nil)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		var items []treeEntry
		json.NewDecoder(resp.Body).Decode(&items)
		resp.Body.Close()
		allItems = append(allItems, items...)
		if len(items) < 100 {
			break
		}
		page++
	}
	c.JSON(http.StatusOK, allItems)
}

func gitlabGetContent(c *gin.Context) {
	uid := me(c).ID
	repo := c.Query("repo")
	path := c.Query("path")
	branch := c.DefaultQuery("branch", "main")
	if repo == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo and path required"})
		return
	}
	token := gitlabTokenForUser(uid)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not connected to GitLab"})
		return
	}
	encodedRepo := url.PathEscape(repo)
	encodedPath := url.PathEscape(path)
	apiURL := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/files/%s/raw?ref=%s", encodedRepo, encodedPath, url.QueryEscape(branch))
	resp, err := doGitLabRequest(c.Request.Context(), token, "GET", apiURL, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read content"})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
}

// compareGitLab calls GitLab compare API and returns changed files and commit messages.
func compareGitLab(ctx interface{ Done() <-chan struct{} }, token, repo, baseSHA, headSHA string) *repoCompare {
	encodedRepo := url.PathEscape(repo)
	compareURL := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/compare?from=%s&to=%s", encodedRepo, baseSHA, headSHA)
	resp, err := doGitLabRequest(ctx, token, "GET", compareURL, nil)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return nil
	}
	defer resp.Body.Close()
	var result struct {
		Diffs []struct {
			NewPath string `json:"new_path"`
		} `json:"diffs"`
		Commits []struct {
			Message string `json:"message"`
		} `json:"commits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	if len(result.Diffs) >= 1000 {
		return nil
	}
	out := &repoCompare{}
	for _, d := range result.Diffs {
		out.Files = append(out.Files, d.NewPath)
	}
	for _, c := range result.Commits {
		msg := c.Message
		if idx := strings.Index(msg, "\n"); idx >= 0 {
			msg = msg[:idx]
		}
		msg = strings.TrimSpace(msg)
		if msg != "" {
			out.Commits = append(out.Commits, msg)
		}
	}
	return out
}

// fetchChangedFilesGitLab is kept for backward compatibility.
func fetchChangedFilesGitLab(ctx interface{ Done() <-chan struct{} }, token, repo, baseSHA, headSHA string) []string {
	r := compareGitLab(ctx, token, repo, baseSHA, headSHA)
	if r == nil {
		return nil
	}
	return r.Files
}

// callAIWithHistory calls the configured AI provider with a full message history.
func callAIWithHistory(settings UserSettings, systemPrompt string, messages []map[string]string) (string, error) {
	if settings.AIProvider == "openai" {
		msgs := []map[string]string{{"role": "system", "content": systemPrompt}}
		msgs = append(msgs, messages...)
		reqBody, _ := json.Marshal(map[string]interface{}{
			"model": settings.OpenAIModel, "max_tokens": 4096, "messages": msgs,
		})
		req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", strings.NewReader(string(reqBody)))
		if err != nil { return "", err }
		req.Header.Set("Authorization", "Bearer "+settings.OpenAIAPIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil { return "", fmt.Errorf("failed to call OpenAI: %w", err) }
		defer resp.Body.Close()
		var r struct {
			Choices []struct { Message struct { Content string `json:"content"` } `json:"message"` } `json:"choices"`
			Error   *struct{ Message string `json:"message"` } `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&r)
		if r.Error != nil { return "", fmt.Errorf("%s", r.Error.Message) }
		if len(r.Choices) == 0 { return "", fmt.Errorf("empty response from OpenAI") }
		return r.Choices[0].Message.Content, nil
	}
	// Anthropic
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model": settings.Model, "max_tokens": 4096, "system": systemPrompt, "messages": messages,
	})
	req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", strings.NewReader(string(reqBody)))
	if err != nil { return "", err }
	req.Header.Set("x-api-key", settings.AnthropicAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return "", fmt.Errorf("failed to call Anthropic: %w", err) }
	defer resp.Body.Close()
	var r struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
		Error   *struct{ Message string `json:"message"` } `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&r)
	if r.Error != nil { return "", fmt.Errorf("%s", r.Error.Message) }
	if len(r.Content) == 0 { return "", fmt.Errorf("empty response from Claude") }
	return r.Content[0].Text, nil
}

// ── Wiki handlers ─────────────────────────────────────────────────────────────

func listWikis(c *gin.Context) {
	wikis := listUserWikis(me(c).ID)
	if wikis == nil { wikis = []WikiMeta{} }
	c.JSON(http.StatusOK, wikis)
}

func getWiki(c *gin.Context) {
	slug := c.Param("slug")
	wc := newWikiCtx(me(c).ID, slug)
	m := wc.loadMeta()
	if m == nil { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	c.JSON(http.StatusOK, m)
}

func getWikiPage(c *gin.Context) {
	slug := c.Param("slug")
	pageID := c.Param("pageid")
	wc := newWikiCtx(me(c).ID, slug)
	content, err := wc.loadPageContent(pageID)
	if err != nil { c.JSON(http.StatusNotFound, gin.H{"error": "page not found"}); return }
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

func updateWikiPage(c *gin.Context) {
	slug := c.Param("slug")
	pageID := c.Param("pageid")
	uid := me(c).ID
	wc := newWikiCtx(uid, slug)
	m := wc.loadMeta()
	if m == nil { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	// Verify page exists in meta
	found := false
	for _, p := range m.Pages {
		if p.ID == pageID { found = true; break }
	}
	if !found { c.JSON(http.StatusNotFound, gin.H{"error": "page not found"}); return }
	body, err := io.ReadAll(c.Request.Body)
	if err != nil { c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"}); return }
	if err := wc.savePageContent(pageID, string(body)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save page"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

func deleteWiki(c *gin.Context) {
	slug := c.Param("slug")
	uid := me(c).ID
	wc := newWikiCtx(uid, slug)
	if m := wc.loadMeta(); m != nil {
		pool.Exec(context.Background(), `DELETE FROM wikis WHERE id = $1`, m.ID)
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func wikiShareGet(c *gin.Context) {
	token := c.Param("token")
	idx := loadSharesIndex()
	entry, ok := idx[token]
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	wc := newWikiCtx(entry.UID, entry.Slug)
	m := wc.loadMeta()
	if m == nil { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	c.JSON(http.StatusOK, m)
}

func wikiSharePage(c *gin.Context) {
	token := c.Param("token")
	pageID := c.Param("pageid")
	idx := loadSharesIndex()
	entry, ok := idx[token]
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	wc := newWikiCtx(entry.UID, entry.Slug)
	content, err := wc.loadPageContent(pageID)
	if err != nil { c.JSON(http.StatusNotFound, gin.H{"error": "page not found"}); return }
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

func listWikiTemplates(c *gin.Context) {
	ts := loadTemplates(me(c).ID)
	c.JSON(http.StatusOK, ts)
}

func createWikiTemplate(c *gin.Context) {
	var body struct {
		Name  string             `json:"name"`
		Pages []TemplatePageSpec `json:"pages"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	uid := me(c).ID
	now := time.Now()
	tpl := WikiTemplate{
		ID: uuid.New().String(), Name: strings.TrimSpace(body.Name),
		Pages: body.Pages, CreatedAt: now, UpdatedAt: now,
	}
	if err := saveTemplate(uid, tpl); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save template"})
		return
	}
	c.JSON(http.StatusCreated, tpl)
}

func updateWikiTemplate(c *gin.Context) {
	id := c.Param("tid")
	var body struct {
		Name  string             `json:"name"`
		Pages []TemplatePageSpec `json:"pages"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	uid := me(c).ID
	tpl := findTemplate(uid, id)
	if tpl == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
		return
	}
	if strings.TrimSpace(body.Name) != "" {
		tpl.Name = strings.TrimSpace(body.Name)
	}
	if body.Pages != nil {
		tpl.Pages = body.Pages
	}
	tpl.UpdatedAt = time.Now()
	if err := saveTemplate(uid, *tpl); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update template"})
		return
	}
	c.JSON(http.StatusOK, tpl)
}

func deleteWikiTemplate(c *gin.Context) {
	id := c.Param("tid")
	uid := me(c).ID
	if findTemplate(uid, id) == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
		return
	}
	if err := deleteTemplate(uid, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete template"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func wikiChat(c *gin.Context) {
	slug := c.Param("slug")
	var body struct {
		Question string `json:"question"`
		History  []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"history"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Question) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question is required"})
		return
	}

	uid := me(c).ID
	settings := loadSettings(uid)
	if settings.AIProvider == "openai" && settings.OpenAIAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OpenAI API key not configured — go to Settings first"})
		return
	}
	if settings.AIProvider != "openai" && settings.AnthropicAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Anthropic API key not configured — go to Settings first"})
		return
	}

	wc := newWikiCtx(uid, slug)
	meta := wc.loadMeta()
	if meta == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"})
		return
	}

	// Build wiki context from all pages (cap at 40k chars)
	var wikiCtxBuf strings.Builder
	charBudget := 40000
	for _, page := range meta.Pages {
		if charBudget <= 0 { break }
		content, err := wc.loadPageContent(page.ID)
		if err != nil { continue }
		if len(content) > charBudget { content = content[:charBudget] }
		wikiCtxBuf.WriteString(fmt.Sprintf("\n\n## %s\n\n%s", page.Title, content))
		charBudget -= len(content)
	}

	systemPrompt := fmt.Sprintf(`You are a helpful Q&A assistant for the repository "%s" (%s).
Answer questions based on the wiki documentation below. Be concise, accurate, and specific.
Reference file names, functions, and modules by name when relevant. Use markdown formatting.

=== WIKI DOCUMENTATION ===
%s`, meta.Repo, strings.Join(meta.Stack, ", "), wikiCtxBuf.String())

	// Build message history
	var messages []map[string]string
	for _, h := range body.History {
		messages = append(messages, map[string]string{"role": h.Role, "content": h.Content})
	}
	messages = append(messages, map[string]string{"role": "user", "content": body.Question})

	answer, err := callAIWithHistory(settings, systemPrompt, messages)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"answer": answer})
}

// repoCompare holds the result of a compare between two commits.
type repoCompare struct {
	Files   []string // changed file paths
	Commits []string // first line of each commit message
}

// compareGitHub calls GitHub compare API and returns changed files and commit messages.
// Returns nil if comparison is not possible (API error, >300 files).
func compareGitHub(ctx interface{ Done() <-chan struct{} }, token, repo, baseSHA, headSHA string) *repoCompare {
	compareURL := fmt.Sprintf("https://api.github.com/repos/%s/compare/%s...%s", repo, baseSHA, headSHA)
	req, err := http.NewRequestWithContext(ctx.(interface {
		Done() <-chan struct{}
		Value(key any) any
		Err() error
		Deadline() (deadline time.Time, ok bool)
	}), "GET", compareURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil { resp.Body.Close() }
		return nil
	}
	defer resp.Body.Close()
	var result struct {
		Files []struct {
			Filename string `json:"filename"`
		} `json:"files"`
		Commits []struct {
			Commit struct {
				Message string `json:"message"`
			} `json:"commit"`
		} `json:"commits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	if len(result.Files) >= 300 {
		return nil
	}
	out := &repoCompare{}
	for _, f := range result.Files {
		out.Files = append(out.Files, f.Filename)
	}
	for _, c := range result.Commits {
		msg := c.Commit.Message
		if idx := strings.Index(msg, "\n"); idx >= 0 {
			msg = msg[:idx]
		}
		msg = strings.TrimSpace(msg)
		if msg != "" {
			out.Commits = append(out.Commits, msg)
		}
	}
	return out
}

// fetchChangedFiles is kept for backward compatibility.
func fetchChangedFiles(ctx interface{ Done() <-chan struct{} }, token, repo, baseSHA, headSHA string) []string {
	r := compareGitHub(ctx, token, repo, baseSHA, headSHA)
	if r == nil {
		return nil
	}
	return r.Files
}

// pagesForChangedFiles maps a list of changed file paths to the set of wiki page IDs
// that need to be regenerated. Returns a map of pageID -> true.
func pagesForChangedFiles(changedFiles []string) map[string]bool {
	pages := map[string]bool{}
	for _, path := range changedFiles {
		lower := strings.ToLower(path)
		base := strings.ToLower(filepath.Base(path))
		ext := strings.ToLower(filepath.Ext(path))

		// Overview: project-level manifests and docs
		if isOverviewFile(base) {
			pages["overview"] = true
		}

		// Architecture: entry points, server/app setup, config, middleware, routing
		if isArchitectureFile(base, lower) {
			pages["architecture"] = true
		}

		// Structure: any file change can shift the directory tree
		pages["structure"] = true

		// Modules: changes to actual source code
		if isSourceExt(ext) {
			pages["modules"] = true
		}

		// Data Flow: handlers, routes, services, models, DB layers
		if isDataFlowFile(base, lower) {
			pages["dataflow"] = true
		}
	}
	return pages
}

var overviewFiles = map[string]bool{
	"readme.md": true, "readme.rst": true, "readme.txt": true, "readme": true,
	"changelog.md": true, "changelog": true, "contributing.md": true,
	"license": true, "license.md": true, "license.txt": true,
	"package.json": true, "go.mod": true, "requirements.txt": true,
	"cargo.toml": true, "pom.xml": true, "pyproject.toml": true,
	"setup.py": true, "setup.cfg": true, "gemfile": true,
	"dockerfile": true, "docker-compose.yml": true, "docker-compose.yaml": true,
	"makefile": true, "justfile": true, ".env.example": true,
}

func isOverviewFile(base string) bool {
	if overviewFiles[base] { return true }
	if strings.HasPrefix(base, "readme") || strings.HasPrefix(base, "changelog") { return true }
	return false
}

var archKeywords = []string{"config", "middleware", "router", "routes", "server", "bootstrap", "init", "setup"}
var archEntries  = map[string]bool{
	"main.go": true, "main.py": true, "main.ts": true, "main.js": true,
	"app.go": true, "app.py": true, "app.ts": true, "app.js": true,
	"server.go": true, "server.py": true, "server.ts": true, "server.js": true,
	"index.ts": true, "index.js": true,
}

func isArchitectureFile(base, lower string) bool {
	if archEntries[base] { return true }
	for _, kw := range archKeywords {
		if strings.Contains(lower, kw) { return true }
	}
	return false
}

var sourceExts = map[string]bool{
	".go": true, ".js": true, ".ts": true, ".jsx": true, ".tsx": true,
	".py": true, ".rs": true, ".java": true, ".cs": true,
	".cpp": true, ".c": true, ".rb": true, ".swift": true, ".kt": true,
	".php": true, ".ex": true, ".exs": true,
}

func isSourceExt(ext string) bool { return sourceExts[ext] }

var dataFlowKeywords = []string{
	"handler", "controller", "route", "api", "endpoint",
	"service", "repository", "repo", "store", "model",
	"schema", "db", "database", "query", "migration",
	"resolver", "usecase",
}

func isDataFlowFile(base, lower string) bool {
	for _, kw := range dataFlowKeywords {
		if strings.Contains(lower, kw) { return true }
	}
	return false
}

// ── Org handlers ──────────────────────────────────────────────────────────────

// Helper: enrich member list with user info
type OrgMemberDetail struct {
	UserID    string    `json:"user_id"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	AvatarURL string    `json:"avatar_url"`
}

func enrichMembers(members []OrgMember) []OrgMemberDetail {
	var out []OrgMemberDetail
	for _, m := range members {
		d := OrgMemberDetail{UserID: m.UserID, Role: m.Role, JoinedAt: m.JoinedAt}
		if u := authStore.FindByID(m.UserID); u != nil {
			d.Name = u.Name
			d.Email = u.Email
			d.AvatarURL = u.AvatarURL
		}
		out = append(out, d)
	}
	return out
}

func listOrgs(c *gin.Context) {
	uid := me(c).ID
	orgs := userOrgs(uid)
	type OrgWithRole struct {
		Organization
		Role        string `json:"role"`
		MemberCount int    `json:"member_count"`
	}
	var out []OrgWithRole
	for _, o := range orgs {
		members := loadOrgMembers(o.ID)
		role := ""
		for _, m := range members {
			if m.UserID == uid { role = m.Role; break }
		}
		out = append(out, OrgWithRole{Organization: o, Role: role, MemberCount: len(members)})
	}
	if out == nil { out = []OrgWithRole{} }
	c.JSON(http.StatusOK, out)
}

func getOrg(c *gin.Context) {
	orgID := c.Param("orgid")
	uid := me(c).ID
	role := orgMemberRole(orgID, uid)
	if role == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member"})
		return
	}
	org := loadOrg(orgID)
	if org == nil { c.JSON(http.StatusNotFound, gin.H{"error": "org not found"}); return }
	members := loadOrgMembers(orgID)
	var invites []OrgInvite
	if role == "admin" { invites = loadOrgInvites(orgID) }
	c.JSON(http.StatusOK, gin.H{
		"org": org, "role": role,
		"members": enrichMembers(members),
		"invites": invites,
	})
}

func orgInviteUser(c *gin.Context) {
	orgID := c.Param("orgid")
	uid := me(c).ID
	if orgMemberRole(orgID, uid) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	org := loadOrg(orgID)
	if org == nil { c.JSON(http.StatusNotFound, gin.H{"error": "org not found"}); return }

	var body struct{ Email string `json:"email"` }
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Email) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))

	// Check if already a member
	members := loadOrgMembers(orgID)
	if existing := authStore.FindByEmail(email); existing != nil {
		for _, m := range members {
			if m.UserID == existing.ID {
				c.JSON(http.StatusConflict, gin.H{"error": "user is already a member"})
				return
			}
		}
		// User exists — add directly
		members = append(members, OrgMember{UserID: existing.ID, Role: "user", JoinedAt: time.Now()})
		saveOrgMembers(orgID, members)
		c.JSON(http.StatusOK, gin.H{
			"status": "added",
			"user":   gin.H{"id": existing.ID, "name": existing.Name, "email": existing.Email, "avatar_url": existing.AvatarURL},
		})
		return
	}

	// User doesn't exist — create invite
	invites := loadOrgInvites(orgID)
	for _, inv := range invites {
		if inv.Email == email && inv.Status == "pending" && time.Now().Before(inv.ExpiresAt) {
			c.JSON(http.StatusOK, gin.H{"status": "pending", "token": inv.Token})
			return
		}
	}
	inviter := me(c)
	token := strings.ReplaceAll(uuid.New().String(), "-", "")
	invite := OrgInvite{
		ID: uuid.New().String(), OrgID: orgID, Email: email,
		InvitedBy: inviter.Name, Token: token, Status: "pending",
		CreatedAt: time.Now(), ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	invites = append(invites, invite)
	saveOrgInvites(orgID, invites)
	c.JSON(http.StatusCreated, gin.H{"status": "invited", "token": token})
}

func orgRemoveMember(c *gin.Context) {
	orgID := c.Param("orgid")
	targetUID := c.Param("uid")
	uid := me(c).ID
	role := orgMemberRole(orgID, uid)
	org := loadOrg(orgID)
	if org == nil { c.JSON(http.StatusNotFound, gin.H{"error": "org not found"}); return }
	// Admin can remove, or user can remove themselves
	if role != "admin" && uid != targetUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	// Can't remove the owner
	if targetUID == org.OwnerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove org owner"})
		return
	}
	members := loadOrgMembers(orgID)
	var next []OrgMember
	for _, m := range members {
		if m.UserID != targetUID { next = append(next, m) }
	}
	saveOrgMembers(orgID, next)
	c.JSON(http.StatusOK, gin.H{"message": "removed"})
}

func orgChangeMemberRole(c *gin.Context) {
	orgID := c.Param("orgid")
	targetUID := c.Param("uid")
	uid := me(c).ID
	org := loadOrg(orgID)
	if org == nil { c.JSON(http.StatusNotFound, gin.H{"error": "org not found"}); return }
	if orgMemberRole(orgID, uid) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	if targetUID == org.OwnerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change owner role"})
		return
	}
	var body struct{ Role string `json:"role"` }
	if err := c.ShouldBindJSON(&body); err != nil || (body.Role != "admin" && body.Role != "user") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be admin or user"})
		return
	}
	members := loadOrgMembers(orgID)
	for i, m := range members {
		if m.UserID == targetUID {
			members[i].Role = body.Role
			saveOrgMembers(orgID, members)
			c.JSON(http.StatusOK, gin.H{"message": "updated"})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
}

func orgCancelInvite(c *gin.Context) {
	orgID := c.Param("orgid")
	inviteID := c.Param("inviteid")
	uid := me(c).ID
	if orgMemberRole(orgID, uid) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	invites := loadOrgInvites(orgID)
	var next []OrgInvite
	for _, inv := range invites {
		if inv.ID != inviteID { next = append(next, inv) }
	}
	saveOrgInvites(orgID, next)
	c.JSON(http.StatusOK, gin.H{"message": "cancelled"})
}

func orgWikis(c *gin.Context) {
	orgID := c.Param("orgid")
	uid := me(c).ID
	if orgMemberRole(orgID, uid) == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member"})
		return
	}
	members := loadOrgMembers(orgID)
	type WikiWithOwner struct {
		WikiMeta
		OwnerID   string `json:"owner_id"`
		OwnerName string `json:"owner_name"`
	}
	var out []WikiWithOwner
	for _, m := range members {
		wikis := listUserWikis(m.UserID)
		u := authStore.FindByID(m.UserID)
		ownerName := ""
		if u != nil { ownerName = u.Name }
		for _, w := range wikis {
			out = append(out, WikiWithOwner{WikiMeta: w, OwnerID: m.UserID, OwnerName: ownerName})
		}
	}
	if out == nil { out = []WikiWithOwner{} }
	c.JSON(http.StatusOK, out)
}

// Public invite endpoints
func getInvite(c *gin.Context) {
	token := c.Param("token")
	orgs := listAllOrgs()
	for _, o := range orgs {
		for _, inv := range loadOrgInvites(o.ID) {
			if inv.Token == token {
				if inv.Status != "pending" || time.Now().After(inv.ExpiresAt) {
					c.JSON(http.StatusGone, gin.H{"error": "invite expired or already used"})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"org_id":     o.ID,
					"org_name":   o.Name,
					"invited_by": inv.InvitedBy,
					"email":      inv.Email,
				})
				return
			}
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "invite not found"})
}

func acceptInvite(c *gin.Context) {
	token := c.Param("token")
	uid := me(c).ID
	user := me(c)
	orgs := listAllOrgs()
	for _, o := range orgs {
		invites := loadOrgInvites(o.ID)
		for i, inv := range invites {
			if inv.Token != token { continue }
			if inv.Status != "pending" || time.Now().After(inv.ExpiresAt) {
				c.JSON(http.StatusGone, gin.H{"error": "invite expired or already used"})
				return
			}
			// Check not already a member
			if orgMemberRole(o.ID, uid) != "" {
				invites[i].Status = "accepted"
				saveOrgInvites(o.ID, invites)
				c.JSON(http.StatusOK, gin.H{"message": "already a member", "org_id": o.ID, "org_name": o.Name})
				return
			}
			// Verify email matches (if invite was for a specific email)
			if inv.Email != "" && !strings.EqualFold(inv.Email, user.Email) {
				c.JSON(http.StatusForbidden, gin.H{"error": "this invite was sent to a different email address"})
				return
			}
			members := loadOrgMembers(o.ID)
			members = append(members, OrgMember{UserID: uid, Role: "user", JoinedAt: time.Now()})
			saveOrgMembers(o.ID, members)
			invites[i].Status = "accepted"
			saveOrgInvites(o.ID, invites)
			c.JSON(http.StatusOK, gin.H{"message": "joined", "org_id": o.ID, "org_name": o.Name})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "invite not found"})
}

// Super admin handlers
func superAdminListOrgs(c *gin.Context) {
	if !isSuperAdmin(me(c)) { c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"}); return }
	orgs := listAllOrgs()
	type OrgSummary struct {
		Organization
		MemberCount int `json:"member_count"`
	}
	var out []OrgSummary
	for _, o := range orgs {
		out = append(out, OrgSummary{Organization: o, MemberCount: len(loadOrgMembers(o.ID))})
	}
	if out == nil { out = []OrgSummary{} }
	c.JSON(http.StatusOK, out)
}

func superAdminListUsers(c *gin.Context) {
	if !isSuperAdmin(me(c)) { c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"}); return }
	users := authStore.ListUsers()
	var out []gin.H
	for _, u := range users {
		cp := u
		out = append(out, gin.H{
			"id": u.ID, "email": u.Email, "name": u.Name,
			"avatar_url": u.AvatarURL, "created_at": u.CreatedAt,
			"is_super_admin": isSuperAdmin(&cp),
		})
	}
	if out == nil { out = []gin.H{} }
	c.JSON(http.StatusOK, out)
}

func superAdminPromoteUser(c *gin.Context) {
	if !isSuperAdmin(me(c)) { c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"}); return }
	targetUID := c.Param("uid")
	// Verify user exists
	if authStore.FindByID(targetUID) == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	addSuperAdmin(targetUID)
	c.JSON(http.StatusOK, gin.H{"message": "promoted"})
}

func superAdminDemoteUser(c *gin.Context) {
	if !isSuperAdmin(me(c)) { c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"}); return }
	targetUID := c.Param("uid")
	// Cannot demote yourself
	if me(c).ID == targetUID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot demote yourself"})
		return
	}
	// Cannot demote env-var super admin
	if u := authStore.FindByID(targetUID); u != nil {
		sa := os.Getenv("SUPER_ADMIN_EMAIL")
		if sa != "" && strings.EqualFold(u.Email, sa) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot demote the bootstrap super admin"})
			return
		}
	}
	removeSuperAdmin(targetUID)
	c.JSON(http.StatusOK, gin.H{"message": "demoted"})
}

func superAdminDeleteOrg(c *gin.Context) {
	if !isSuperAdmin(me(c)) { c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"}); return }
	orgID := c.Param("orgid")
	if _, err := pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete org"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func wikiGenerate(c *gin.Context) {
	var body struct {
		Repo       string `json:"repo"`
		Branch     string `json:"branch"`
		TemplateID string `json:"template_id"`
		Source     string `json:"source"` // "github" | "gitlab"
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo is required"})
		return
	}
	if body.Branch == "" { body.Branch = "main" }
	if body.Source == "" { body.Source = "github" }

	uid := me(c).ID
	settings := loadSettings(uid)
	if settings.AIProvider == "openai" && settings.OpenAIAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OpenAI API key not configured — go to Settings first"})
		return
	}
	if settings.AIProvider != "openai" && settings.AnthropicAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Anthropic API key not configured — go to Settings first"})
		return
	}

	// Get source-specific token
	var token string
	if body.Source == "gitlab" {
		token = gitlabTokenForUser(uid)
		if token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "not connected to GitLab"})
			return
		}
	} else {
		token = githubTokenForRepo(uid, body.Repo)
		if token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "not connected to GitHub"})
			return
		}
	}

	// Fetch repo tree and commit SHA
	var treeItems []treeEntry
	commitSHA := ""

	if body.Source == "gitlab" {
		encodedRepo := url.PathEscape(body.Repo)
		page := 1
		for {
			apiURL := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/tree?recursive=true&ref=%s&per_page=100&page=%d", encodedRepo, url.QueryEscape(body.Branch), page)
			resp, err := doGitLabRequest(c.Request.Context(), token, "GET", apiURL, nil)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch repo tree"})
				return
			}
			var items []treeEntry
			json.NewDecoder(resp.Body).Decode(&items)
			resp.Body.Close()
			treeItems = append(treeItems, items...)
			if len(items) < 100 { break }
			page++
		}
		branchURL := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/branches/%s", encodedRepo, url.PathEscape(body.Branch))
		if br, err2 := doGitLabRequest(c.Request.Context(), token, "GET", branchURL, nil); err2 == nil {
			var branchInfo struct{ Commit struct{ ID string `json:"id"` } `json:"commit"` }
			json.NewDecoder(br.Body).Decode(&branchInfo)
			br.Body.Close()
			commitSHA = branchInfo.Commit.ID
		}
	} else {
		apiURL := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", body.Repo, body.Branch)
		resp, err := doGitHubRequest(c.Request.Context(), token, "GET", apiURL, nil)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch repo tree"})
			return
		}
		var treeResult struct {
			Tree []treeEntry `json:"tree"`
		}
		json.NewDecoder(resp.Body).Decode(&treeResult)
		resp.Body.Close()
		treeItems = treeResult.Tree
		branchURL := fmt.Sprintf("https://api.github.com/repos/%s/branches/%s", body.Repo, body.Branch)
		if br, err2 := doGitHubRequest(c.Request.Context(), token, "GET", branchURL, nil); err2 == nil {
			var branchInfo struct{ Commit struct{ SHA string `json:"sha"` } `json:"commit"` }
			json.NewDecoder(br.Body).Decode(&branchInfo)
			br.Body.Close()
			commitSHA = branchInfo.Commit.SHA
		}
	}

	// Load existing wiki for incremental regeneration
	repoSlug := repoToSlug(body.Repo)
	if body.Source == "gitlab" { repoSlug = "gl-" + repoSlug }
	wc := newWikiCtx(uid, repoSlug)
	existingMeta := wc.loadMeta()

	// If nothing changed and all pages are present in the DB, return the cached wiki immediately
	if existingMeta != nil && existingMeta.CommitSHA != "" && existingMeta.CommitSHA == commitSHA &&
		wc.countPages() >= len(existingMeta.Pages) {
		existingMeta.RegeneratedPages = []string{}
		existingMeta.TemplateID = body.TemplateID // persist the newly selected template even when content is unchanged
		wc.saveMeta(*existingMeta)
		c.JSON(http.StatusOK, existingMeta)
		return
	}

	// Determine which pages need regeneration
	pagesToRegen := map[string]bool{
		"overview": true, "architecture": true, "structure": true,
		"modules": true, "dataflow": true,
	}
	var diffResult *repoCompare
	if existingMeta != nil && existingMeta.CommitSHA != "" && commitSHA != "" {
		if body.Source == "gitlab" {
			diffResult = compareGitLab(c.Request.Context(), token, body.Repo, existingMeta.CommitSHA, commitSHA)
		} else {
			diffResult = compareGitHub(c.Request.Context(), token, body.Repo, existingMeta.CommitSHA, commitSHA)
		}
		if diffResult != nil {
			pagesToRegen = pagesForChangedFiles(diffResult.Files)
		}
	}

	// Filter files
	filteredFiles := filterRepoFiles(treeItems)

	// Helper to fetch file content
	var fetchFile func(path string) (string, error)
	if body.Source == "gitlab" {
		encodedRepo := url.PathEscape(body.Repo)
		fetchFile = func(path string) (string, error) {
			encodedPath := url.PathEscape(path)
			u := fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/files/%s/raw?ref=%s", encodedRepo, encodedPath, url.QueryEscape(body.Branch))
			r, err := doGitLabRequest(c.Request.Context(), token, "GET", u, nil)
			if err != nil { return "", err }
			defer r.Body.Close()
			if r.StatusCode != 200 { return "", fmt.Errorf("status %d", r.StatusCode) }
			data, err := io.ReadAll(r.Body)
			if err != nil { return "", err }
			return string(data), nil
		}
	} else {
		fetchFile = func(path string) (string, error) {
			u := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s", body.Repo, path, body.Branch)
			r, err := doGitHubRequest(c.Request.Context(), token, "GET", u, nil)
			if err != nil { return "", err }
			defer r.Body.Close()
			var result struct {
				Content  string `json:"content"`
				Encoding string `json:"encoding"`
			}
			json.NewDecoder(r.Body).Decode(&result)
			if result.Encoding != "base64" { return "", fmt.Errorf("unexpected encoding") }
			cleaned := strings.ReplaceAll(result.Content, "\n", "")
			decoded, err := base64.StdEncoding.DecodeString(cleaned)
			if err != nil { return "", err }
			return string(decoded), nil
		}
	}

	// ── Determine page specs: user template > wiki.json > defaults ────────────
	type pageSpec struct {
		id, title, slug string
		order           int
		prompt          string
	}
	var pages []pageSpec
	hasCustomConfig := false

	// 1. User-selected template
	if body.TemplateID != "" {
		if tpl := findTemplate(uid, body.TemplateID); tpl != nil {
			for i, p := range tpl.Pages {
				id := p.ID
				if id == "" { id = fmt.Sprintf("page-%d", i) }
				slug := p.Slug
				if slug == "" { slug = strings.ReplaceAll(strings.ToLower(p.Title), " ", "-") }
				pages = append(pages, pageSpec{id: id, title: p.Title, slug: slug, order: i, prompt: p.Prompt})
			}
			hasCustomConfig = true
		}
	}

	// 2. Repo's wiki.json
	if len(pages) == 0 {
		if raw, err2 := fetchFile("wiki.json"); err2 == nil {
			var cfg struct {
				Pages []struct {
					ID     string `json:"id"`
					Title  string `json:"title"`
					Slug   string `json:"slug"`
					Prompt string `json:"prompt"`
				} `json:"pages"`
			}
			if json.Unmarshal([]byte(raw), &cfg) == nil && len(cfg.Pages) > 0 {
				for i, p := range cfg.Pages {
					id := p.ID
					if id == "" { id = fmt.Sprintf("page-%d", i) }
					slug := p.Slug
					if slug == "" { slug = strings.ReplaceAll(strings.ToLower(p.Title), " ", "-") }
					pages = append(pages, pageSpec{id: id, title: p.Title, slug: slug, order: i, prompt: p.Prompt})
				}
				hasCustomConfig = true
			}
		}
	}

	// Custom configs always regenerate all pages
	if hasCustomConfig {
		for _, s := range pages { pagesToRegen[s.id] = true }
	}

	// Add changelog page when this is an incremental update (not first generation)
	if diffResult != nil && (len(diffResult.Files) > 0 || len(diffResult.Commits) > 0) {
		shortBase := existingMeta.CommitSHA
		if len(shortBase) > 7 { shortBase = shortBase[:7] }
		shortHead := commitSHA
		if len(shortHead) > 7 { shortHead = shortHead[:7] }

		fileList := "none"
		if len(diffResult.Files) > 0 {
			fileList = "- " + strings.Join(diffResult.Files, "\n- ")
		}
		commitList := "none"
		if len(diffResult.Commits) > 0 {
			commitList = "- " + strings.Join(diffResult.Commits, "\n- ")
		}

		changelogPrompt := fmt.Sprintf(`Generate a Changelog entry for "%s" summarising what changed between commits %s and %s (date: %s).

Commit messages:
%s

Changed files:
%s

Write the entry in markdown with this structure:
## %s — %s → %s
A 1-2 sentence headline summarising the overall change.

### What changed
Group changes by area (e.g. API, UI, Database, Config, Tests). For each group, write 2-4 concise bullet points explaining what was added, changed, or fixed. Reference specific file names where relevant.

### Breaking changes
List any breaking changes, or write "None" if there are none.

Be factual and concise. Do not repeat the raw commit messages verbatim.`,
			body.Repo, shortBase, shortHead, time.Now().Format("2006-01-02"),
			commitList, fileList,
			time.Now().Format("2006-01-02"), shortBase, shortHead,
		)

		changelogSpec := pageSpec{
			id: "changelog", title: "Changelog", slug: "changelog", order: 99,
			prompt: changelogPrompt,
		}
		pages = append(pages, changelogSpec)
		pagesToRegen["changelog"] = true
	}

	// Detect tech stack (needed for system prompt and default page prompts)
	stack := detectStack(filteredFiles, fetchFile)

	// Build repo context (cap at ~60k chars total)
	var repoContext strings.Builder
	// Build base URL for linking to source files
	var blobBase string
	if body.Source == "gitlab" {
		blobBase = fmt.Sprintf("https://gitlab.com/%s/-/blob/%s", body.Repo, body.Branch)
	} else {
		blobBase = fmt.Sprintf("https://github.com/%s/blob/%s", body.Repo, body.Branch)
	}

	charBudget := 60000
	for _, f := range filteredFiles {
		if charBudget <= 0 { break }
		content, err := fetchFile(f.Path)
		if err != nil { continue }
		if len(content) > charBudget { content = content[:charBudget] }
		ext := strings.TrimPrefix(filepath.Ext(f.Path), ".")
		fileURL := blobBase + "/" + f.Path
		repoContext.WriteString(fmt.Sprintf("\n\n### [%s](%s)\n\n```%s\n%s\n```", f.Path, fileURL, ext, content))
		charBudget -= len(content)
	}

	repoCtxStr := repoContext.String()
	stackStr := strings.Join(stack, ", ")
	systemPrompt := fmt.Sprintf(`You are a technical documentation expert. You are analyzing the repository "%s" which uses: %s.
Generate clear, well-structured markdown documentation. Use headers, code blocks, tables, and Mermaid diagrams where appropriate.
Always use fenced code blocks with language identifiers. Be specific and accurate based on the actual code provided.
When referencing specific files or directories, link to them using markdown links. The source files are hosted at: %s/
Example: instead of writing ` + "`main.go`" + `, write [` + "`main.go`" + `](%s/main.go). Apply this to all file references throughout the documentation.`, body.Repo, stackStr, blobBase, blobBase)

	repoShort := body.Repo
	if idx := strings.Index(repoShort, "/"); idx >= 0 { repoShort = repoShort[idx+1:] }

	// 3. Default 5 pages (if no custom config)
	if len(pages) == 0 {
		pages = []pageSpec{
			{
				id: "overview", title: "Overview", slug: "overview", order: 0,
				prompt: fmt.Sprintf(`Write an Overview page for the repository "%s".
Include:
- What this project does (1-2 paragraph summary)
- Key features (bullet list)
- Tech stack: %s
- Prerequisites and how to get started (installation + first run commands)
- Any important configuration

Base everything on the actual code provided. Be concise but complete.`, body.Repo, stackStr),
			},
			{
				id: "architecture", title: "Architecture", slug: "architecture", order: 1,
				prompt: fmt.Sprintf(`Write an Architecture page for "%s".
Include:
- High-level architecture description (2-3 paragraphs)
- A Mermaid diagram showing the main components and their relationships. Use graph TD or flowchart TD syntax. Example:
  `+"```mermaid\ngraph TD\n    A[Client] --> B[API Server]\n    B --> C[Database]\n```"+`
- Component responsibilities table (component | responsibility | key files)
- Key design decisions and patterns used

Base everything on the actual code. Make the Mermaid diagram reflect the real architecture.`, body.Repo),
			},
			{
				id: "structure", title: "Project Structure", slug: "project-structure", order: 2,
				prompt: fmt.Sprintf(`Write a Project Structure page for "%s".
Include:
- Directory tree (use `+"`"+`tree`+"`"+` style formatting in a code block)
- Description of each major directory and what it contains
- Key files and their purposes (table: file | purpose)
- Conventions and patterns used in the codebase

Be specific about the actual files present.`, body.Repo),
			},
			{
				id: "modules", title: "Core Modules", slug: "core-modules", order: 3,
				prompt: fmt.Sprintf(`Write a Core Modules page for "%s".
For each major module/package/component in the codebase:
- Module name as a heading
- What it does
- Key functions/classes/types with brief descriptions
- Dependencies on other modules
- Example usage if applicable

Focus on the most important 4-6 modules. Use code snippets from the actual source where helpful.`, body.Repo),
			},
			{
				id: "dataflow", title: "Data Flow", slug: "data-flow", order: 4,
				prompt: fmt.Sprintf(`Write a Data Flow page for "%s".
Include:
- How data enters the system (inputs, API endpoints, user actions)
- How it's processed and transformed
- How it's stored/persisted
- How it's returned/displayed
- A Mermaid sequence diagram showing the main data flow. Example:
  `+"```mermaid\nsequenceDiagram\n    Client->>Server: Request\n    Server->>DB: Query\n    DB-->>Server: Result\n    Server-->>Client: Response\n```"+`
- Error handling and edge cases

Base this on the actual code flows you can see.`, body.Repo),
			},
		}
	}

	// Build page list (all specs, content generated below)
	var generatedPages []WikiPageMeta
	for _, spec := range pages {
		generatedPages = append(generatedPages, WikiPageMeta{ID: spec.id, Title: spec.title, Slug: spec.slug, Order: spec.order})
	}

	// Persist the wiki row first so savePageContent can reference it by wiki_id
	wikiID := uuid.New().String()
	if existingMeta != nil { wikiID = existingMeta.ID }
	shareToken := strings.ReplaceAll(uuid.New().String(), "-", "")[:20]
	if existingMeta != nil && existingMeta.ShareToken != "" { shareToken = existingMeta.ShareToken }
	if stack == nil { stack = []string{} }
	meta := WikiMeta{
		ID:               wikiID,
		Repo:             body.Repo,
		RepoSlug:         repoSlug,
		Branch:           body.Branch,
		CommitSHA:        commitSHA,
		GeneratedAt:      time.Now(),
		Pages:            generatedPages,
		Stack:            stack,
		Description:      fmt.Sprintf("%s — %s", repoShort, stackStr),
		ShareToken:       shareToken,
		HasCustomConfig:  hasCustomConfig,
		TemplateID:       body.TemplateID,
		Source:           body.Source,
		RegeneratedPages: []string{},
	}
	if err := wc.saveMeta(meta); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save wiki"})
		return
	}

	// Generate each page (skipping pages that haven't changed)
	var regenPageIDs []string
	for _, spec := range pages {
		if !pagesToRegen[spec.id] {
			continue
		}
		userMsg := fmt.Sprintf("Repository context for `%s`:\n%s\n\n---\n\n%s", body.Repo, repoCtxStr, spec.prompt)
		content, err := callAI(c.Request.Context(), settings, systemPrompt, userMsg)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to generate page '%s': %v", spec.title, err)})
			return
		}
		if saveErr := wc.savePageContent(spec.id, content); saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save page"})
			return
		}
		regenPageIDs = append(regenPageIDs, spec.title)
	}
	meta.RegeneratedPages = regenPageIDs
	if err := wc.saveMeta(meta); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save wiki"})
		return
	}
	sharesIdx := loadSharesIndex()
	sharesIdx[shareToken] = shareEntry{UID: uid, Slug: repoSlug}
	saveSharesIndex(sharesIdx)

	c.JSON(http.StatusCreated, meta)
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	// Warn loudly on startup about missing critical config so misconfigured
	// deployments fail obviously rather than silently.
	if os.Getenv("SUPER_ADMIN_EMAIL") == "" {
		log.Println("WARNING: SUPER_ADMIN_EMAIL is not set — no super-admin will be bootstrapped")
	}
	if os.Getenv("GIN_MODE") == "release" {
		missingOAuth := []string{}
		if os.Getenv("GITHUB_CLIENT_ID") == "" || os.Getenv("GITHUB_CLIENT_SECRET") == "" {
			missingOAuth = append(missingOAuth, "GitHub")
		}
		if os.Getenv("GITLAB_CLIENT_ID") == "" || os.Getenv("GITLAB_CLIENT_SECRET") == "" {
			missingOAuth = append(missingOAuth, "GitLab")
		}
		if os.Getenv("GOOGLE_CLIENT_ID") == "" || os.Getenv("GOOGLE_CLIENT_SECRET") == "" {
			missingOAuth = append(missingOAuth, "Google")
		}
		for _, provider := range missingOAuth {
			log.Printf("WARNING: %s OAuth credentials not set — %s login/integration will be disabled", provider, provider)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	if os.Getenv("GIN_MODE") != "release" {
		r.Use(cors.New(cors.Config{
			AllowOrigins:     []string{"http://localhost:5173"},
			AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
			AllowCredentials: true,
		}))
	}

	api := r.Group("/api")
	{
		// Public auth routes
		a := api.Group("/auth")
		a.GET("/config", authConfig)
		a.POST("/register", authRegister)
		a.POST("/login", authLogin)
		a.GET("/me", authMiddleware, authMe)
		a.GET("/google", googleAuthStart)
		a.GET("/google/callback", googleAuthCallback)
		a.GET("/exchange", authExchange) // one-time token exchange (never puts JWT in URL)

		// Settings routes
		s := api.Group("/settings", authMiddleware)
		s.GET("", getSettings)
		s.PUT("", putSettings)

		// AI inline edit
		api.POST("/ai/inline-edit", authMiddleware, aiInlineEdit)

		// Protected file routes
		f := api.Group("/files", authMiddleware)
		f.GET("", listFiles)
		f.POST("/upload", uploadFile)
		f.DELETE("/:id", deleteFile)
		f.GET("/:id/info", getFileInfo)
		f.GET("/:id/content", getFileContent)
		f.PUT("/:id/content", saveFileContent)
		f.GET("/:id/channel", getChannelData)
		f.GET("/folders", listFolders)
		f.POST("/folders", createFolder)
		f.DELETE("/folders/:folderid", deleteFolder)
		f.PUT("/:id/folder", assignFileFolder)

		// GitHub OAuth (auth + callback + exchange are public browser-redirect endpoints)
		api.GET("/github/auth", githubAuthStart)
		api.GET("/github/callback", githubAuthCallback)
		api.GET("/github/exchange", githubExchange)
		gh := api.Group("/github", authMiddleware)
		gh.GET("/status", githubStatus)
		gh.PUT("/token", githubSaveToken)
		gh.DELETE("/disconnect", githubDisconnect)
		gh.GET("/repos", githubListRepos)
		gh.GET("/tree", githubGetTree)
		gh.GET("/content", githubGetContent)

		// GitLab OAuth
		api.GET("/gitlab/auth", gitlabAuthStart)
		api.GET("/gitlab/callback", gitlabAuthCallback)
		api.GET("/gitlab/exchange", gitlabExchange)
		gl := api.Group("/gitlab", authMiddleware)
		gl.GET("/status", gitlabStatus)
		gl.PUT("/token", gitlabSaveToken)
		gl.DELETE("/disconnect", gitlabDisconnect)
		gl.GET("/repos", gitlabListRepos)
		gl.GET("/tree", gitlabGetTree)
		gl.GET("/content", gitlabGetContent)

		// Wiki templates
		wt := api.Group("/wiki-templates", authMiddleware)
		wt.GET("", listWikiTemplates)
		wt.POST("", createWikiTemplate)
		wt.PUT("/:tid", updateWikiTemplate)
		wt.DELETE("/:tid", deleteWikiTemplate)

		// Invite (public)
		api.GET("/invite/:token", getInvite)
		// Invite accept (requires auth)
		api.POST("/invite/:token/accept", authMiddleware, acceptInvite)

		// Orgs
		og := api.Group("/orgs", authMiddleware)
		og.GET("", listOrgs)
		og.GET("/:orgid", getOrg)
		og.GET("/:orgid/wikis", orgWikis)
		og.POST("/:orgid/invite", orgInviteUser)
		og.DELETE("/:orgid/members/:uid", orgRemoveMember)
		og.PUT("/:orgid/members/:uid/role", orgChangeMemberRole)
		og.DELETE("/:orgid/invites/:inviteid", orgCancelInvite)

		// Super admin
		sa := api.Group("/superadmin", authMiddleware)
		sa.GET("/orgs", superAdminListOrgs)
		sa.GET("/users", superAdminListUsers)
		sa.DELETE("/orgs/:orgid", superAdminDeleteOrg)
		sa.POST("/users/:uid/superadmin", superAdminPromoteUser)
		sa.DELETE("/users/:uid/superadmin", superAdminDemoteUser)

		// Wiki (public share endpoints — no auth)
		api.GET("/wiki/share/:token", wikiShareGet)
		api.GET("/wiki/share/:token/page/:pageid", wikiSharePage)
		// Wiki (authenticated)
		w := api.Group("/wiki", authMiddleware)
		w.GET("", listWikis)
		w.POST("/generate", wikiGenerate)
		w.GET("/:slug", getWiki)
		w.GET("/:slug/page/:pageid", getWikiPage)
		w.PUT("/:slug/page/:pageid", updateWikiPage)
		w.DELETE("/:slug", deleteWiki)
		w.POST("/:slug/chat", wikiChat)

		// Drive routes (browser-redirect endpoints are public, others protected)
		api.GET("/drive/auth", driveAuth)
		api.GET("/drive/callback", driveCallback)
		d := api.Group("/drive", authMiddleware)
		d.GET("/status", driveStatus)
		d.DELETE("/disconnect", driveDisconnect)
		d.GET("/folders", driveListFolders)
		d.PUT("/folder", driveSetFolder)
		d.GET("/files", driveListFiles)
		d.POST("/files/upload", driveUploadFile)
		d.DELETE("/files/:id", driveDeleteFile)
		d.GET("/files/:id/info", driveFileInfo)
		d.GET("/files/:id/content", driveFileContent)
		d.PUT("/files/:id/content", driveSaveContent)
		d.GET("/files/:id/channel", driveChannelData)
	}

	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./static"
	}
	if _, err := os.Stat(staticDir); err == nil {
		r.Static("/assets", filepath.Join(staticDir, "assets"))
		r.StaticFile("/favicon.svg", filepath.Join(staticDir, "favicon.svg"))
		r.StaticFile("/icons.svg", filepath.Join(staticDir, "icons.svg"))
		r.NoRoute(func(c *gin.Context) {
			if !strings.HasPrefix(c.Request.URL.Path, "/api") {
				c.File(filepath.Join(staticDir, "index.html"))
			}
		})
	}

	log.Printf("Server running on :%s\n", port)
	r.Run(":" + port)
}
