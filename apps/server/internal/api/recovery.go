package api

import "net/http"

func (s *Server) recoveryRoutes(add func(string, string, endpoint)) {
	add("POST", "/platform/users/{id}/recovery", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		reason := text(body(r, "reason"), "reason", 5, 500)
		value := token()
		s.transaction(r.Context(), func(db Store) any {
			user := db.one(`SELECT email FROM users WHERE id=$1 FOR UPDATE`, id)
			require(user != nil, 404, "Persona no encontrada")
			db.exec(`DELETE FROM tokens WHERE kind='reset' AND email=$1`, str(user, "email"))
			db.exec(`INSERT INTO tokens(token,kind,email,expires_at) VALUES($1,'reset',$2,now()+interval '30 minutes')`, hash(value), str(user, "email"))
			db.audit(str(actor, "id"), "", "platform.recovery.issued", id, Row{"reason": reason})
			return nil
		})
		return Row{"url": s.Config.Origin + "/?reset=" + value, "message": "Entrega este enlace manualmente tras verificar la identidad. Vence en 30 minutos."}
	})
	add("POST", "/auth/reset", func(w http.ResponseWriter, r *http.Request) any {
		b := body(r, "token", "password")
		value, password := text(b, "token", 64, 64), passwordInput(b, "password")
		s.reserveAttempts(r, map[string]int64{"reset-ip:" + hash(s.clientIP(r)): 10})
		var encoded string
		s.passwordWork(r.Context(), func() { encoded = encodePassword(password) })
		s.transaction(r.Context(), func(db Store) any {
			entry := db.one(`SELECT email FROM tokens WHERE token=$1 AND kind='reset' AND expires_at>now()`, hash(value))
			require(entry != nil, 400, "Enlace inválido o vencido")
			user := db.one(`SELECT id FROM users WHERE email=$1 FOR UPDATE`, str(entry, "email"))
			require(user != nil, 400, "Enlace inválido")
			require(db.one(`DELETE FROM tokens WHERE token=$1 AND kind='reset' AND expires_at>now() RETURNING email`, hash(value)) != nil, 400, "Enlace inválido o vencido")
			db.exec(`UPDATE users SET password=$2,must_change_password=false WHERE id=$1`, str(user, "id"), encoded)
			db.exec(`DELETE FROM sessions WHERE user_id=$1`, str(user, "id"))
			db.exec(`DELETE FROM tokens WHERE email=$1 AND kind='reset'`, str(entry, "email"))
			db.audit(str(user, "id"), "", "password.reset", str(user, "id"), Row{})
			return nil
		})
		s.setSession(w, "", -1)
		return Row{"ok": true}
	})
}
