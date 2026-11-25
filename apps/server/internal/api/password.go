package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Preserve the PHC encoding used by node-argon2, including existing parameters.
func encodePassword(password string) string {
	salt := make([]byte, 16)
	must(rand.Read(salt))
	key := argon2.IDKey([]byte(password), salt, 3, 65536, 4, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory, iterations, parallelism uint32
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || n != 3 {
		return false
	}
	// Bound resource use even when a stored hash is malformed.
	if parallelism < 1 || parallelism > 16 || memory < 8*parallelism || memory > 262144 || iterations < 1 || iterations > 10 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 || len(expected) > 64 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, uint8(parallelism), uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func passwordInput(b Row, key string) string {
	value, ok := b[key].(string)
	require(ok && len([]rune(value)) >= 12 && len([]rune(value)) <= 128, 400, "La contraseña debe tener entre 12 y 128 caracteres")
	return value // Passwords must never be trimmed.
}

func (s *Server) passwordWork(ctx context.Context, work func()) {
	select {
	case s.hashSlots <- struct{}{}:
		defer func() { <-s.hashSlots }()
		work()
	case <-ctx.Done():
		panic(ctx.Err())
	}
}
