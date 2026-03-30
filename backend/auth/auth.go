package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"password_hash,omitempty"`
	GoogleID     string    `json:"google_id,omitempty"`
	AvatarURL    string    `json:"avatar_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type Store struct {
	mu        sync.RWMutex
	usersFile string
	users     []User
	secret    []byte
}

func NewStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	s := &Store{usersFile: filepath.Join(dataDir, "users.json")}

	secretFile := filepath.Join(dataDir, "jwt_secret")
	if raw, err := os.ReadFile(secretFile); err == nil {
		decoded, err := hex.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			return nil, err
		}
		s.secret = decoded
	} else {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, err
		}
		_ = os.WriteFile(secretFile, []byte(hex.EncodeToString(secret)), 0600)
		s.secret = secret
	}

	s.load()
	return s, nil
}

func (s *Store) load() {
	data, err := os.ReadFile(s.usersFile)
	if err != nil {
		s.users = nil
		return
	}
	_ = json.Unmarshal(data, &s.users)
}

func (s *Store) save() {
	data, _ := json.MarshalIndent(s.users, "", "  ")
	_ = os.WriteFile(s.usersFile, data, 0600)
}

func (s *Store) FindByID(id string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := range s.users {
		if s.users[i].ID == id {
			u := s.users[i]
			return &u
		}
	}
	return nil
}

func (s *Store) findByEmail(email string) *User {
	for i := range s.users {
		if s.users[i].Email == email {
			u := s.users[i]
			return &u
		}
	}
	return nil
}

func (s *Store) Register(email, name, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || name == "" || password == "" {
		return nil, errors.New("email, name and password are required")
	}
	if len(password) < 8 {
		return nil, errors.New("password must be at least 8 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.findByEmail(email) != nil {
		return nil, errors.New("email already registered")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	u := User{
		ID:           uuid.New().String(),
		Email:        email,
		Name:         name,
		PasswordHash: string(hash),
		CreatedAt:    time.Now(),
	}
	s.users = append(s.users, u)
	s.save()
	return &u, nil
}

func (s *Store) Login(email, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	s.mu.RLock()
	u := s.findByEmail(email)
	s.mu.RUnlock()
	if u == nil {
		return nil, errors.New("invalid email or password")
	}
	if u.PasswordHash == "" {
		return nil, errors.New("this account uses Google Sign-In — click \"Continue with Google\"")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return nil, errors.New("invalid email or password")
	}
	return u, nil
}

func (s *Store) UpsertGoogle(googleID, email, name, avatarURL string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.users {
		if s.users[i].GoogleID == googleID {
			u := s.users[i]
			return &u, nil
		}
	}
	for i := range s.users {
		if s.users[i].Email == email {
			s.users[i].GoogleID = googleID
			if s.users[i].AvatarURL == "" && avatarURL != "" {
				s.users[i].AvatarURL = avatarURL
			}
			s.save()
			u := s.users[i]
			return &u, nil
		}
	}
	u := User{
		ID:        uuid.New().String(),
		Email:     email,
		Name:      name,
		GoogleID:  googleID,
		AvatarURL: avatarURL,
		CreatedAt: time.Now(),
	}
	s.users = append(s.users, u)
	s.save()
	return &u, nil
}

type tokenClaims struct {
	UID string `json:"uid"`
	Exp int64  `json:"exp"`
}

func (s *Store) GenerateToken(userID string) (string, error) {
	claims := tokenClaims{UID: userID, Exp: time.Now().Add(7 * 24 * time.Hour).Unix()}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(enc))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return enc + "." + sig, nil
}

func (s *Store) ValidateToken(token string) (string, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", errors.New("malformed token")
	}
	enc, sig := parts[0], parts[1]
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(enc))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", errors.New("invalid token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}
	if time.Now().Unix() > claims.Exp {
		return "", errors.New("token expired")
	}
	return claims.UID, nil
}
