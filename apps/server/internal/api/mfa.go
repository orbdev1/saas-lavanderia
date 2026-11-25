package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) cipher() cipher.AEAD {
	require(len(s.Config.Key) == 32, 503, "Configura la clave de cifrado MFA del servidor", "MFA_NOT_CONFIGURED")
	block := must(aes.NewCipher(s.Config.Key))
	return must(cipher.NewGCM(block))
}
func (s *Server) seal(user, secret string) string {
	aead := s.cipher()
	nonce := make([]byte, aead.NonceSize())
	must(rand.Read(nonce))
	return base64.RawStdEncoding.EncodeToString(aead.Seal(nonce, nonce, []byte(secret), []byte(user)))
}
func (s *Server) unseal(user, encrypted string) string {
	aead := s.cipher()
	data := must(base64.RawStdEncoding.DecodeString(encrypted))
	require(len(data) >= aead.NonceSize(), 500, "Secreto MFA inválido")
	return string(must(aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], []byte(user))))
}
func totp(secret string, step int64) string {
	key := must(base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret))
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 15
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(digest[offset:offset+4])&0x7fffffff)%1000000)
}
func validStep(secret, code string, last int64, now time.Time) int64 {
	for _, delta := range []int64{0, -1, 1} {
		step := now.Unix()/30 + delta
		if step > last && subtle.ConstantTimeCompare([]byte(totp(secret, step)), []byte(code)) == 1 {
			return step
		}
	}
	return -1
}
func (s *Server) platform(r *http.Request) Row {
	actor := s.authenticate(r)
	require(flag(actor, "platformAdmin"), 403, "Acceso exclusivo de plataforma")
	require(!flag(actor, "mustChangePassword"), 403, "Cambia tu contraseña para continuar", "PASSWORD_CHANGE_REQUIRED")
	require(flag(actor, "mfaVerified"), 403, "Verifica tu segundo factor para administrar la plataforma", "MFA_REQUIRED")
	return actor
}
func (s *Server) mfaRoutes(add func(string, string, endpoint)) {
	add("GET", "/auth/mfa", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		row := s.store(r).one(`SELECT totp_secret IS NOT NULL AS enabled FROM users WHERE id=$1`, str(user, "id"))
		return Row{"enabled": flag(row, "enabled"), "verified": flag(user, "mfaVerified")}
	})
	add("POST", "/auth/mfa/setup", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		password := passwordInput(body(r, "password"), "password")
		s.reserveAttempts(r, map[string]int64{"mfa-setup:" + str(user, "id"): 5})
		before := s.store(r).one(`SELECT password,totp_secret FROM users WHERE id=$1`, str(user, "id"))
		require(before["totp_secret"] == nil, 409, "El segundo factor ya está configurado")
		s.passwordWork(r.Context(), func() { require(verifyPassword(str(before, "password"), password), 401, "Contraseña incorrecta") })
		raw := make([]byte, 20)
		must(rand.Read(raw))
		secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
		encrypted := s.seal(str(user, "id"), secret)
		s.transaction(r.Context(), func(db Store) any {
			locked := db.one(`SELECT password,totp_secret FROM users WHERE id=$1 FOR UPDATE`, str(user, "id"))
			require(str(locked, "password") == str(before, "password") && locked["totp_secret"] == nil, 409, "La cuenta cambió. Inicia sesión nuevamente.")
			active := db.one(`SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`, str(user, "sessionId"), str(user, "id"))
			require(active != nil, 401, "Tu sesión ha vencido")
			db.exec(`INSERT INTO mfa_enrollments(session_id,user_id,encrypted_secret) VALUES($1,$2,$3)
				ON CONFLICT(session_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,expires_at=now()+interval '10 minutes'`, str(user, "sessionId"), str(user, "id"), encrypted)
			return nil
		})
		return Row{"secret": secret, "uri": "otpauth://totp/" + url.PathEscape("Lavanda:"+str(user, "email")) + "?secret=" + secret + "&issuer=Lavanda&algorithm=SHA1&digits=6&period=30"}
	})
	add("POST", "/auth/mfa/enable", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		code := text(body(r, "code"), "code", 6, 6)
		s.reserveAttempts(r, map[string]int64{"mfa:" + str(user, "id"): 10})
		return s.transaction(r.Context(), func(db Store) any {
			locked := db.one(`SELECT totp_secret FROM users WHERE id=$1 FOR UPDATE`, str(user, "id"))
			require(locked["totp_secret"] == nil, 409, "MFA ya está configurado")
			enrollment := db.one(`SELECT e.encrypted_secret FROM mfa_enrollments e JOIN sessions ss ON ss.id=e.session_id
				WHERE e.session_id=$1 AND e.user_id=$2 AND e.expires_at>now() AND ss.expires_at>now() FOR UPDATE OF e,ss`, str(user, "sessionId"), str(user, "id"))
			require(enrollment != nil, 400, "Configuración vencida. Inicia nuevamente.")
			secret := s.unseal(str(user, "id"), str(enrollment, "encrypted_secret"))
			step := validStep(secret, code, -1, time.Now())
			require(step >= 0, 400, "Código inválido")
			db.exec(`UPDATE users SET totp_secret=$2,totp_last_step=$3 WHERE id=$1`, str(user, "id"), str(enrollment, "encrypted_secret"), step)
			db.exec(`DELETE FROM sessions WHERE user_id=$1 AND id<>$2`, str(user, "id"), str(user, "sessionId"))
			db.exec(`UPDATE sessions SET mfa_verified=true WHERE id=$1 AND user_id=$2`, str(user, "sessionId"), str(user, "id"))
			db.exec(`DELETE FROM mfa_enrollments WHERE user_id=$1`, str(user, "id"))
			codes := []string{}
			for range 8 {
				recovery := token()[:24]
				codes = append(codes, recovery)
				db.exec(`INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)`, str(user, "id"), hash(recovery))
			}
			db.audit(str(user, "id"), "", "mfa.enabled", str(user, "id"), Row{})
			return Row{"ok": true, "recoveryCodes": codes}
		})
	})
	add("POST", "/auth/mfa/verify", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		code := strings.ReplaceAll(text(body(r, "code"), "code", 6, 40), " ", "")
		s.reserveAttempts(r, map[string]int64{"mfa:" + str(user, "id"): 10})
		return s.transaction(r.Context(), func(db Store) any {
			row := db.one(`SELECT totp_secret,totp_last_step FROM users WHERE id=$1 FOR UPDATE`, str(user, "id"))
			require(row["totp_secret"] != nil, 409, "Primero configura el segundo factor")
			if len(code) == 6 {
				step := validStep(s.unseal(str(user, "id"), str(row, "totp_secret")), code, num(row, "totp_last_step"), time.Now())
				require(step >= 0, 401, "Código inválido o ya utilizado")
				db.exec(`UPDATE users SET totp_last_step=$2 WHERE id=$1`, str(user, "id"), step)
			} else {
				require(db.one(`DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING user_id`, str(user, "id"), hash(code)) != nil, 401, "Código inválido o ya utilizado")
			}
			session := db.one(`UPDATE sessions SET mfa_verified=true WHERE user_id=$1 AND id=$2 AND expires_at>now() RETURNING id`, str(user, "id"), str(user, "sessionId"))
			require(session != nil, 401, "Tu sesión ha vencido")
			db.audit(str(user, "id"), "", "mfa.verified", str(user, "sessionId"), Row{"recovery": len(code) != 6})
			return Row{"ok": true}
		})
	})
}
