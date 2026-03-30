package main

import (
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

// ── FileMeta ──────────────────────────────────────────────────────────────────

type FileMeta struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	Ext        string    `json:"ext"`
	UploadedAt time.Time `json:"uploaded_at"`
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
	if !map[string]bool{".mf4": true, ".mdf": true, ".md": true}[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .mf4, .mdf, and .md files are supported"})
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

		// Protected file routes
		f := api.Group("/files", authMiddleware)
		f.GET("", listFiles)
		f.POST("/upload", uploadFile)
		f.DELETE("/:id", deleteFile)
		f.GET("/:id/info", getFileInfo)
		f.GET("/:id/content", getFileContent)
		f.PUT("/:id/content", saveFileContent)
		f.GET("/:id/channel", getChannelData)

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
