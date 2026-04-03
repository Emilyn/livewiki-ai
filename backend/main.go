package main

import (
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
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"mdf-viewer/auth"
	"mdf-viewer/drive"
	"mdf-viewer/mdf"
)

var uploadsDir string
var driveClient *drive.Client
var activeRedirectURI string
var authStore *auth.Store
var googleAuthConf *oauth2.Config
var githubOAuthConf *oauth2.Config
var githubRedirectURI string

func init() {
	uploadsDir = os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "./uploads"
	}
	os.MkdirAll(uploadsDir, 0755)

	var err error
	authStore, err = auth.NewStore(uploadsDir)
	if err != nil {
		log.Fatalf("failed to init auth store: %v", err)
	}

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
	path := filepath.Join(userDir(uid), "settings.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return UserSettings{Model: "claude-sonnet-4-6", AIProvider: "anthropic", OpenAIModel: "gpt-4o"}
	}
	var s UserSettings
	json.Unmarshal(data, &s)
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

func templatesPath(uid string) string {
	return filepath.Join(userDir(uid), "wiki_templates.json")
}

func loadTemplates(uid string) []WikiTemplate {
	data, err := os.ReadFile(templatesPath(uid))
	if err != nil { return []WikiTemplate{} }
	var ts []WikiTemplate
	json.Unmarshal(data, &ts)
	if ts == nil { return []WikiTemplate{} }
	return ts
}

func saveTemplates(uid string, ts []WikiTemplate) {
	data, _ := json.MarshalIndent(ts, "", "  ")
	os.WriteFile(templatesPath(uid), data, 0644)
}

func findTemplate(uid, id string) *WikiTemplate {
	for _, t := range loadTemplates(uid) {
		if t.ID == id {
			cp := t
			return &cp
		}
	}
	return nil
}

func sharesIndexPath() string { return filepath.Join(uploadsDir, "shares.json") }

func loadSharesIndex() map[string]shareEntry {
	data, err := os.ReadFile(sharesIndexPath())
	if err != nil { return map[string]shareEntry{} }
	var idx map[string]shareEntry
	json.Unmarshal(data, &idx)
	if idx == nil { return map[string]shareEntry{} }
	return idx
}

func saveSharesIndex(idx map[string]shareEntry) {
	data, _ := json.MarshalIndent(idx, "", "  ")
	os.WriteFile(sharesIndexPath(), data, 0644)
}

type wikiCtx struct {
	dir string
}

func newWikiCtx(uid, repoSlug string) wikiCtx {
	d := filepath.Join(userDir(uid), "wikis", repoSlug)
	os.MkdirAll(d, 0755)
	return wikiCtx{dir: d}
}

func (wc wikiCtx) metaPath() string { return filepath.Join(wc.dir, "meta.json") }
func (wc wikiCtx) pagePath(id string) string { return filepath.Join(wc.dir, "page_"+id+".md") }

func (wc wikiCtx) loadMeta() *WikiMeta {
	data, err := os.ReadFile(wc.metaPath())
	if err != nil { return nil }
	var m WikiMeta
	json.Unmarshal(data, &m)
	return &m
}

func (wc wikiCtx) saveMeta(m WikiMeta) error {
	data, _ := json.MarshalIndent(m, "", "  ")
	return os.WriteFile(wc.metaPath(), data, 0644)
}

func (wc wikiCtx) savePageContent(id, content string) error {
	return os.WriteFile(wc.pagePath(id), []byte(content), 0644)
}

func (wc wikiCtx) loadPageContent(id string) (string, error) {
	data, err := os.ReadFile(wc.pagePath(id))
	return string(data), err
}

func repoToSlug(repo string) string {
	return strings.ReplaceAll(repo, "/", "-")
}

func listUserWikis(uid string) []WikiMeta {
	wikisDir := filepath.Join(userDir(uid), "wikis")
	entries, err := os.ReadDir(wikisDir)
	if err != nil { return nil }
	var result []WikiMeta
	for _, e := range entries {
		if !e.IsDir() { continue }
		wc := wikiCtx{dir: filepath.Join(wikisDir, e.Name())}
		m := wc.loadMeta()
		if m != nil { result = append(result, *m) }
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

func filterRepoFiles(tree []struct {
	Path string `json:"path"`
	Type string `json:"type"`
	Size int    `json:"size"`
}) []RepoFile {
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

type folderCtx struct{ path string }

func newFolderCtx(uid string) folderCtx {
	return folderCtx{path: filepath.Join(userDir(uid), "folders.json")}
}

func (fc folderCtx) load() []Folder {
	data, err := os.ReadFile(fc.path)
	if err != nil {
		return nil
	}
	var folders []Folder
	json.Unmarshal(data, &folders)
	return folders
}

func (fc folderCtx) save(folders []Folder) {
	data, _ := json.MarshalIndent(folders, "", "  ")
	os.WriteFile(fc.path, data, 0644)
}

// ── Per-user file context ─────────────────────────────────────────────────────

func userDir(uid string) string {
	return filepath.Join(uploadsDir, "users", uid)
}

type fileCtx struct {
	dir  string
	meta string
}

func newFileCtx(uid string) fileCtx {
	d := userDir(uid)
	os.MkdirAll(d, 0755)
	return fileCtx{dir: d, meta: filepath.Join(d, "files.json")}
}

func (fc fileCtx) loadMeta() []FileMeta {
	data, err := os.ReadFile(fc.meta)
	if err != nil {
		return nil
	}
	var files []FileMeta
	json.Unmarshal(data, &files)
	return files
}

func (fc fileCtx) saveMeta(files []FileMeta) {
	data, _ := json.MarshalIndent(files, "", "  ")
	os.WriteFile(fc.meta, data, 0644)
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
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  gin.H{"id": user.ID, "email": user.Email, "name": user.Name, "avatar_url": user.AvatarURL},
	})
}

func authMe(c *gin.Context) {
	user := me(c)
	c.JSON(http.StatusOK, gin.H{
		"id": user.ID, "email": user.Email, "name": user.Name, "avatar_url": user.AvatarURL,
	})
}

func googleAuthStart(c *gin.Context) {
	if googleAuthConf == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google auth not configured"})
		return
	}
	origin := c.DefaultQuery("origin", "http://localhost:5173")
	c.Redirect(http.StatusFound, googleAuthConf.AuthCodeURL(origin, oauth2.AccessTypeOnline))
}

func googleAuthCallback(c *gin.Context) {
	if googleAuthConf == nil {
		c.String(http.StatusServiceUnavailable, "Google auth not configured")
		return
	}
	code := c.Query("code")
	origin := c.DefaultQuery("state", "http://localhost:5173")
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
	authToken, err := authStore.GenerateToken(user.ID)
	if err != nil {
		c.Redirect(http.StatusFound, origin+"?auth=error")
		return
	}
	c.Redirect(http.StatusFound, origin+"?auth_token="+url.QueryEscape(authToken))
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
	files = append(files[:idx], files[idx+1:]...)
	fc.saveMeta(files)
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
	path := filepath.Join(userDir(me(c).ID), "settings.json")
	data, _ := json.MarshalIndent(body, "", "  ")
	if err := os.WriteFile(path, data, 0600); err != nil {
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
	state := c.DefaultQuery("origin", "http://localhost:5173")
	c.Redirect(http.StatusFound, driveClient.AuthURL(state))
}

func driveCallback(c *gin.Context) {
	if driveClient == nil {
		c.String(http.StatusServiceUnavailable, "Drive not configured")
		return
	}
	code := c.Query("code")
	origin := c.DefaultQuery("state", "http://localhost:5173")
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

func githubAccountsPath(uid string) string {
	return filepath.Join(userDir(uid), "github_accounts.json")
}

func loadGitHubAccounts(uid string) []GitHubAccount {
	data, err := os.ReadFile(githubAccountsPath(uid))
	if err != nil {
		return nil
	}
	var accounts []GitHubAccount
	json.Unmarshal(data, &accounts)
	return accounts
}

func saveGitHubAccounts(uid string, accounts []GitHubAccount) error {
	data, _ := json.MarshalIndent(accounts, "", "  ")
	return os.WriteFile(githubAccountsPath(uid), data, 0600)
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
	c.Redirect(http.StatusFound, githubOAuthConf.AuthCodeURL(origin, oauth2.AccessTypeOnline))
}

func githubAuthCallback(c *gin.Context) {
	if githubOAuthConf == nil {
		c.String(http.StatusServiceUnavailable, "GitHub auth not configured")
		return
	}
	code := c.Query("code")
	origin := c.DefaultQuery("state", "http://localhost:5173")
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
	c.Redirect(http.StatusFound, origin+"?github_token="+url.QueryEscape(token.AccessToken))
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
		os.Remove(githubAccountsPath(uid))
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
	wc := wikiCtx{dir: filepath.Join(userDir(me(c).ID), "wikis", slug)}
	m := wc.loadMeta()
	if m == nil { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	c.JSON(http.StatusOK, m)
}

func getWikiPage(c *gin.Context) {
	slug := c.Param("slug")
	pageID := c.Param("pageid")
	wc := wikiCtx{dir: filepath.Join(userDir(me(c).ID), "wikis", slug)}
	content, err := wc.loadPageContent(pageID)
	if err != nil { c.JSON(http.StatusNotFound, gin.H{"error": "page not found"}); return }
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

func deleteWiki(c *gin.Context) {
	slug := c.Param("slug")
	uid := me(c).ID
	// Remove share token from index before deleting
	wc := wikiCtx{dir: filepath.Join(userDir(uid), "wikis", slug)}
	if m := wc.loadMeta(); m != nil && m.ShareToken != "" {
		idx := loadSharesIndex()
		delete(idx, m.ShareToken)
		saveSharesIndex(idx)
	}
	dir := filepath.Join(userDir(uid), "wikis", slug)
	if err := os.RemoveAll(dir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete wiki"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func wikiShareGet(c *gin.Context) {
	token := c.Param("token")
	idx := loadSharesIndex()
	entry, ok := idx[token]
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "wiki not found"}); return }
	wc := wikiCtx{dir: filepath.Join(userDir(entry.UID), "wikis", entry.Slug)}
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
	wc := wikiCtx{dir: filepath.Join(userDir(entry.UID), "wikis", entry.Slug)}
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
	ts := loadTemplates(uid)
	now := time.Now()
	tpl := WikiTemplate{
		ID: uuid.New().String(), Name: strings.TrimSpace(body.Name),
		Pages: body.Pages, CreatedAt: now, UpdatedAt: now,
	}
	ts = append(ts, tpl)
	saveTemplates(uid, ts)
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
	ts := loadTemplates(uid)
	for i, t := range ts {
		if t.ID == id {
			if strings.TrimSpace(body.Name) != "" { ts[i].Name = strings.TrimSpace(body.Name) }
			if body.Pages != nil { ts[i].Pages = body.Pages }
			ts[i].UpdatedAt = time.Now()
			saveTemplates(uid, ts)
			c.JSON(http.StatusOK, ts[i])
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
}

func deleteWikiTemplate(c *gin.Context) {
	id := c.Param("tid")
	uid := me(c).ID
	ts := loadTemplates(uid)
	for i, t := range ts {
		if t.ID == id {
			ts = append(ts[:i], ts[i+1:]...)
			saveTemplates(uid, ts)
			c.JSON(http.StatusOK, gin.H{"message": "deleted"})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
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

	wc := wikiCtx{dir: filepath.Join(userDir(uid), "wikis", slug)}
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

// fetchChangedFiles calls GitHub compare API and returns the list of changed file paths.
// Returns nil if comparison is not possible (no base SHA, API error, >300 files).
func fetchChangedFiles(ctx interface{ Done() <-chan struct{} }, token, repo, baseSHA, headSHA string) []string {
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
		TotalCommits int `json:"total_commits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	// GitHub caps compare at 300 files; if we hit the cap, fall back to full regen
	if len(result.Files) >= 300 {
		return nil
	}
	out := make([]string, len(result.Files))
	for i, f := range result.Files {
		out[i] = f.Filename
	}
	return out
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

func wikiGenerate(c *gin.Context) {
	var body struct {
		Repo       string `json:"repo"`
		Branch     string `json:"branch"`
		TemplateID string `json:"template_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo is required"})
		return
	}
	if body.Branch == "" { body.Branch = "main" }

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

	token := githubTokenForRepo(uid, body.Repo)
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not connected to GitHub"})
		return
	}

	// Fetch repo tree
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", body.Repo, body.Branch)
	resp, err := doGitHubRequest(c.Request.Context(), token, "GET", apiURL, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch repo tree"})
		return
	}
	var treeResult struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
			Size int    `json:"size"`
		} `json:"tree"`
	}
	json.NewDecoder(resp.Body).Decode(&treeResult)
	resp.Body.Close()

	// Get commit SHA for staleness detection
	commitSHA := ""
	branchURL := fmt.Sprintf("https://api.github.com/repos/%s/branches/%s", body.Repo, body.Branch)
	if br, err2 := doGitHubRequest(c.Request.Context(), token, "GET", branchURL, nil); err2 == nil {
		var branchInfo struct{ Commit struct{ SHA string `json:"sha"` } `json:"commit"` }
		json.NewDecoder(br.Body).Decode(&branchInfo)
		br.Body.Close()
		commitSHA = branchInfo.Commit.SHA
	}

	// Load existing wiki for incremental regeneration
	repoSlug := repoToSlug(body.Repo)
	wc := newWikiCtx(uid, repoSlug)
	existingMeta := wc.loadMeta()

	// If nothing changed, return the cached wiki immediately
	if existingMeta != nil && existingMeta.CommitSHA != "" && existingMeta.CommitSHA == commitSHA {
		existingMeta.RegeneratedPages = []string{}
		c.JSON(http.StatusOK, existingMeta)
		return
	}

	// Determine which pages need regeneration
	pagesToRegen := map[string]bool{
		"overview": true, "architecture": true, "structure": true,
		"modules": true, "dataflow": true,
	}
	if existingMeta != nil && existingMeta.CommitSHA != "" && commitSHA != "" {
		changed := fetchChangedFiles(c.Request.Context(), token, body.Repo, existingMeta.CommitSHA, commitSHA)
		if changed != nil {
			pagesToRegen = pagesForChangedFiles(changed)
		}
	}

	// Filter files
	filteredFiles := filterRepoFiles(treeResult.Tree)

	// Helper to fetch file content
	fetchFile := func(path string) (string, error) {
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

	// Detect tech stack (needed for system prompt and default page prompts)
	stack := detectStack(filteredFiles, fetchFile)

	// Build repo context (cap at ~60k chars total)
	var repoContext strings.Builder
	charBudget := 60000
	for _, f := range filteredFiles {
		if charBudget <= 0 { break }
		content, err := fetchFile(f.Path)
		if err != nil { continue }
		if len(content) > charBudget { content = content[:charBudget] }
		ext := strings.TrimPrefix(filepath.Ext(f.Path), ".")
		repoContext.WriteString(fmt.Sprintf("\n\n### %s\n\n```%s\n%s\n```", f.Path, ext, content))
		charBudget -= len(content)
	}

	repoCtxStr := repoContext.String()
	stackStr := strings.Join(stack, ", ")
	systemPrompt := fmt.Sprintf(`You are a technical documentation expert. You are analyzing the repository "%s" which uses: %s.
Generate clear, well-structured markdown documentation. Use headers, code blocks, tables, and Mermaid diagrams where appropriate.
Always use fenced code blocks with language identifiers. Be specific and accurate based on the actual code provided.`, body.Repo, stackStr)

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

	// Generate each page (skipping pages that haven't changed)
	var generatedPages []WikiPageMeta
	var regenPageIDs []string
	for _, spec := range pages {
		pageMeta := WikiPageMeta{ID: spec.id, Title: spec.title, Slug: spec.slug, Order: spec.order}
		if !pagesToRegen[spec.id] {
			// Page unchanged — keep existing content on disk, just record the meta
			generatedPages = append(generatedPages, pageMeta)
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
		generatedPages = append(generatedPages, pageMeta)
		regenPageIDs = append(regenPageIDs, spec.title)
	}

	wikiID := uuid.New().String()
	if existingMeta != nil { wikiID = existingMeta.ID }
	shareToken := strings.ReplaceAll(uuid.New().String(), "-", "")[:20]
	if existingMeta != nil && existingMeta.ShareToken != "" { shareToken = existingMeta.ShareToken }
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
		RegeneratedPages: regenPageIDs,
		ShareToken:       shareToken,
		HasCustomConfig:  hasCustomConfig,
		TemplateID:       body.TemplateID,
	}
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()

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

		// Settings routes
		s := api.Group("/settings", authMiddleware)
		s.GET("", getSettings)
		s.PUT("", putSettings)

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

		// GitHub OAuth (auth + callback are public browser-redirect endpoints)
		api.GET("/github/auth", githubAuthStart)
		api.GET("/github/callback", githubAuthCallback)
		gh := api.Group("/github", authMiddleware)
		gh.GET("/status", githubStatus)
		gh.PUT("/token", githubSaveToken)
		gh.DELETE("/disconnect", githubDisconnect)
		gh.GET("/repos", githubListRepos)
		gh.GET("/tree", githubGetTree)
		gh.GET("/content", githubGetContent)

		// Wiki templates
		wt := api.Group("/wiki-templates", authMiddleware)
		wt.GET("", listWikiTemplates)
		wt.POST("", createWikiTemplate)
		wt.PUT("/:tid", updateWikiTemplate)
		wt.DELETE("/:tid", deleteWikiTemplate)

		// Wiki (public share endpoints — no auth)
		api.GET("/wiki/share/:token", wikiShareGet)
		api.GET("/wiki/share/:token/page/:pageid", wikiSharePage)
		// Wiki (authenticated)
		w := api.Group("/wiki", authMiddleware)
		w.GET("", listWikis)
		w.POST("/generate", wikiGenerate)
		w.GET("/:slug", getWiki)
		w.GET("/:slug/page/:pageid", getWikiPage)
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
