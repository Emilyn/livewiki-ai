package drive

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	gdrive "google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

var Scopes = []string{
	"https://www.googleapis.com/auth/drive",
}

// FolderMeta is persisted to disk.
type FolderMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// DriveFile is the unified file record returned to the frontend.
type DriveFile struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	Ext        string    `json:"ext"`
	UploadedAt time.Time `json:"uploaded_at"`
	Source     string    `json:"source"` // always "drive"
}

type Client struct {
	cfg        *oauth2.Config
	tokenFile  string
	folderFile string
	cacheDir   string // temp dir for downloaded files
}

func NewClient(clientID, clientSecret, redirectURI, dataDir string) *Client {
	return &Client{
		cfg: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURI,
			Scopes:       Scopes,
			Endpoint:     google.Endpoint,
		},
		tokenFile:  filepath.Join(dataDir, "drive_token.json"),
		folderFile: filepath.Join(dataDir, "drive_folder.json"),
		cacheDir:   filepath.Join(dataDir, "drive_cache"),
	}
}

// AuthURL returns the Google OAuth consent URL.
func (c *Client) AuthURL(state string) string {
	return c.cfg.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)
}

// Exchange converts an auth code into a stored token.
func (c *Client) Exchange(ctx context.Context, code string) error {
	tok, err := c.cfg.Exchange(ctx, code)
	if err != nil {
		return fmt.Errorf("token exchange: %w", err)
	}
	return c.saveToken(tok)
}

// Connected reports whether a valid token is stored.
func (c *Client) Connected() bool {
	tok, err := c.loadToken()
	return err == nil && tok != nil
}

// GetFolder returns the saved folder, or nil.
func (c *Client) GetFolder() *FolderMeta {
	data, err := os.ReadFile(c.folderFile)
	if err != nil {
		return nil
	}
	var f FolderMeta
	if json.Unmarshal(data, &f) != nil {
		return nil
	}
	return &f
}

// SetFolder saves the chosen folder.
func (c *Client) SetFolder(id, name string) error {
	data, err := json.MarshalIndent(FolderMeta{ID: id, Name: name}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.folderFile, data, 0644)
}

// Disconnect removes stored credentials and folder selection.
func (c *Client) Disconnect() {
	os.Remove(c.tokenFile)
	os.Remove(c.folderFile)
}

// service returns an authenticated Drive service.
func (c *Client) service(ctx context.Context) (*gdrive.Service, error) {
	tok, err := c.loadToken()
	if err != nil {
		return nil, fmt.Errorf("not connected to Google Drive")
	}
	ts := c.cfg.TokenSource(ctx, tok)
	// Persist refreshed token
	newTok, _ := ts.Token()
	if newTok != nil && newTok.AccessToken != tok.AccessToken {
		c.saveToken(newTok) //nolint:errcheck
	}
	return gdrive.NewService(ctx, option.WithTokenSource(ts))
}

// ListFolders returns all Drive folders (for the folder picker).
func (c *Client) ListFolders(ctx context.Context) ([]FolderMeta, error) {
	svc, err := c.service(ctx)
	if err != nil {
		return nil, err
	}
	res, err := svc.Files.List().
		Q("mimeType='application/vnd.google-apps.folder' and trashed=false").
		Fields("files(id,name)").
		OrderBy("name").
		PageSize(200).
		Do()
	if err != nil {
		return nil, err
	}
	folders := make([]FolderMeta, 0, len(res.Files))
	for _, f := range res.Files {
		folders = append(folders, FolderMeta{ID: f.Id, Name: f.Name})
	}
	return folders, nil
}

var allowedMimes = map[string]bool{
	"application/octet-stream": true, // .mf4 / .mdf
	"text/plain":               true, // .md
	"text/markdown":            true,
}

// ListFiles returns supported files in the selected folder.
func (c *Client) ListFiles(ctx context.Context) ([]DriveFile, error) {
	folder := c.GetFolder()
	if folder == nil {
		return nil, fmt.Errorf("no Drive folder selected")
	}
	svc, err := c.service(ctx)
	if err != nil {
		return nil, err
	}

	q := fmt.Sprintf("'%s' in parents and trashed=false", folder.ID)
	res, err := svc.Files.List().
		Q(q).
		Fields("files(id,name,size,modifiedTime,mimeType,fileExtension)").
		OrderBy("name").
		PageSize(200).
		Do()
	if err != nil {
		return nil, err
	}

	var files []DriveFile
	for _, f := range res.Files {
		ext := extFromName(f.Name)
		if !isSupportedExt(ext) {
			continue
		}
		t, _ := time.Parse(time.RFC3339, f.ModifiedTime)
		files = append(files, DriveFile{
			ID:         f.Id,
			Name:       f.Name,
			Size:       f.Size,
			Ext:        ext,
			UploadedAt: t,
			Source:     "drive",
		})
	}
	return files, nil
}

// UploadFile uploads a file to the selected Drive folder.
func (c *Client) UploadFile(ctx context.Context, name string, r io.Reader) (*DriveFile, error) {
	folder := c.GetFolder()
	if folder == nil {
		return nil, fmt.Errorf("no Drive folder selected")
	}
	svc, err := c.service(ctx)
	if err != nil {
		return nil, err
	}

	meta := &gdrive.File{Name: name, Parents: []string{folder.ID}}
	f, err := svc.Files.Create(meta).Media(r).Fields("id,name,size,modifiedTime").Do()
	if err != nil {
		return nil, err
	}
	t, _ := time.Parse(time.RFC3339, f.ModifiedTime)
	return &DriveFile{
		ID:         f.Id,
		Name:       f.Name,
		Size:       f.Size,
		Ext:        extFromName(f.Name),
		UploadedAt: t,
		Source:     "drive",
	}, nil
}

// DeleteFile deletes a file from Drive.
func (c *Client) DeleteFile(ctx context.Context, fileID string) error {
	svc, err := c.service(ctx)
	if err != nil {
		return err
	}
	return svc.Files.Delete(fileID).Do()
}

// DownloadToTemp downloads a Drive file to a local temp path and returns it.
// The caller is responsible for deleting the file when done.
func (c *Client) DownloadToTemp(ctx context.Context, fileID string) (string, error) {
	os.MkdirAll(c.cacheDir, 0755)
	svc, err := c.service(ctx)
	if err != nil {
		return "", err
	}

	// Get file metadata for name/ext
	meta, err := svc.Files.Get(fileID).Fields("name").Do()
	if err != nil {
		return "", err
	}

	dest := filepath.Join(c.cacheDir, fileID+extFromName(meta.Name))

	// Use cached copy if it exists
	if _, err := os.Stat(dest); err == nil {
		return dest, nil
	}

	resp, err := svc.Files.Get(fileID).Download()
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, resp.Body); err != nil {
		os.Remove(dest)
		return "", err
	}
	return dest, nil
}

// GetContent downloads a Drive file and returns its bytes (for text files).
func (c *Client) GetContent(ctx context.Context, fileID string) ([]byte, error) {
	svc, err := c.service(ctx)
	if err != nil {
		return nil, err
	}
	resp, err := svc.Files.Get(fileID).Download()
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// UpdateContent overwrites a Drive file's content.
func (c *Client) UpdateContent(ctx context.Context, fileID string, data []byte) error {
	svc, err := c.service(ctx)
	if err != nil {
		return err
	}
	// Clear cache
	meta, _ := svc.Files.Get(fileID).Fields("name").Do()
	if meta != nil {
		os.Remove(filepath.Join(c.cacheDir, fileID+extFromName(meta.Name)))
	}
	_, err = svc.Files.Update(fileID, &gdrive.File{}).
		Media(newBytesReader(data)).
		Do()
	return err
}

// ---- helpers ----------------------------------------------------------------

func (c *Client) loadToken() (*oauth2.Token, error) {
	data, err := os.ReadFile(c.tokenFile)
	if err != nil {
		return nil, err
	}
	var tok oauth2.Token
	return &tok, json.Unmarshal(data, &tok)
}

func (c *Client) saveToken(tok *oauth2.Token) error {
	data, err := json.MarshalIndent(tok, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.tokenFile, data, 0600)
}

func extFromName(name string) string {
	ext := filepath.Ext(name)
	if ext == "" {
		return ""
	}
	// lowercase
	b := []byte(ext)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func isSupportedExt(ext string) bool {
	switch ext {
	case ".mf4", ".mdf", ".md":
		return true
	}
	return false
}

// bytesReader wraps []byte as an io.Reader with a Name() for the Drive API.
type bytesReader struct {
	*io.SectionReader
}

func newBytesReader(data []byte) io.Reader {
	return &bytesReader{io.NewSectionReader(
		&bytesBackend{data}, 0, int64(len(data)),
	)}
}

type bytesBackend struct{ data []byte }

func (b *bytesBackend) ReadAt(p []byte, off int64) (int, error) {
	if off >= int64(len(b.data)) {
		return 0, io.EOF
	}
	n := copy(p, b.data[off:])
	return n, nil
}
