package api

import (
	"net/http"
	"sort"
)

// Reserve attempts in a short transaction before password hashing or other work.
// Blocked requests roll back; successful operations do not erase concurrent failures.
func (s *Server) reserveAttempts(r *http.Request, limits map[string]int64) {
	keys := make([]string, 0, len(limits))
	for key := range limits {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	s.transaction(r.Context(), func(db Store) any {
		lockBuckets(db, keys...)
		for _, key := range keys {
			db.exec(`INSERT INTO login_limits(bucket) VALUES($1) ON CONFLICT DO NOTHING`, key)
			db.exec(`UPDATE login_limits SET attempts=0,window_start=now(),blocked_until=NULL
				WHERE bucket=$1 AND window_start<now()-interval '15 minutes'`, key)
			row := db.one(`SELECT attempts FROM login_limits WHERE bucket=$1`, key)
			require(num(row, "attempts") < limits[key], 429, "Demasiados intentos. Intenta nuevamente en 15 minutos.", "LOGIN_BLOCKED")
			db.exec(`UPDATE login_limits SET attempts=attempts+1 WHERE bucket=$1`, key)
		}
		return nil
	})
}
