package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
	pool   *pgxpool.Pool
	secret []byte
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	s := &Store{pool: pool}
	if err := s.initSecret(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) initSecret() error {
	ctx := context.Background()
	var secretHex string
	err := s.pool.QueryRow(ctx, `SELECT secret FROM jwt_secret LIMIT 1`).Scan(&secretHex)
	if err == pgx.ErrNoRows {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return err
		}
		secretHex = hex.EncodeToString(raw)
		_, err = s.pool.Exec(ctx, `INSERT INTO jwt_secret (secret) VALUES ($1)`, secretHex)
		if err != nil {
			return err
		}
		s.secret = raw
		return nil
	}
	if err != nil {
		return err
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(secretHex))
	if err != nil {
		return err
	}
	s.secret = decoded
	return nil
}

func (s *Store) FindByID(id string) *User {
	ctx := context.Background()
	u := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, google_id, avatar_url, created_at FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.GoogleID, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil
	}
	return u
}

func (s *Store) FindByEmail(email string) *User {
	ctx := context.Background()
	email = strings.ToLower(strings.TrimSpace(email))
	u := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, google_id, avatar_url, created_at FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.GoogleID, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil
	}
	return u
}

func (s *Store) ListUsers() []User {
	ctx := context.Background()
	rows, err := s.pool.Query(ctx,
		`SELECT id, email, name, password_hash, google_id, avatar_url, created_at FROM users ORDER BY created_at`,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.GoogleID, &u.AvatarURL, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, u)
	}
	return users
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
	ctx := context.Background()
	_, err = s.pool.Exec(ctx,
		`INSERT INTO users (id, email, name, password_hash, google_id, avatar_url, created_at)
         VALUES ($1, $2, $3, $4, '', '', $5)`,
		u.ID, u.Email, u.Name, u.PasswordHash, u.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, errors.New("email already registered")
		}
		return nil, err
	}
	return &u, nil
}

func (s *Store) Login(email, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	u := s.FindByEmail(email)
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
	ctx := context.Background()

	// Check by google_id first
	u := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, google_id, avatar_url, created_at FROM users WHERE google_id = $1`,
		googleID,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.GoogleID, &u.AvatarURL, &u.CreatedAt)
	if err == nil {
		return u, nil
	}

	// Check by email
	err = s.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, google_id, avatar_url, created_at FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.GoogleID, &u.AvatarURL, &u.CreatedAt)
	if err == nil {
		// Update google_id and optionally avatar
		_, err = s.pool.Exec(ctx,
			`UPDATE users SET google_id = $1, avatar_url = CASE WHEN avatar_url = '' THEN $2 ELSE avatar_url END WHERE id = $3`,
			googleID, avatarURL, u.ID,
		)
		if err != nil {
			return nil, err
		}
		u.GoogleID = googleID
		if u.AvatarURL == "" {
			u.AvatarURL = avatarURL
		}
		return u, nil
	}

	// Create new user
	newUser := User{
		ID:        uuid.New().String(),
		Email:     email,
		Name:      name,
		GoogleID:  googleID,
		AvatarURL: avatarURL,
		CreatedAt: time.Now(),
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO users (id, email, name, password_hash, google_id, avatar_url, created_at)
         VALUES ($1, $2, $3, '', $4, $5, $6)`,
		newUser.ID, newUser.Email, newUser.Name, newUser.GoogleID, newUser.AvatarURL, newUser.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &newUser, nil
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
