package api

import (
	"net/http/httptest"
	"testing"
)

func TestOnlyConfiguredProxyCanSupplyClientIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/", nil)
	r.RemoteAddr = "198.51.100.2:1000"
	r.Header.Set("X-Forwarded-For", "203.0.113.10")
	s := New(nil, Config{TrustedProxyCIDR: "10.0.0.0/24"})
	if got := s.clientIP(r); got != "198.51.100.2" {
		t.Fatal("untrusted header used", got)
	}
	r.RemoteAddr = "10.0.0.2:1000"
	r.Header.Set("X-Forwarded-For", "203.0.113.10, 10.0.0.3")
	if got := s.clientIP(r); got != "203.0.113.10" {
		t.Fatal(got)
	}
	s.Config.TrustedProxyCIDR = ""
	if got := s.clientIP(r); got != "10.0.0.2" {
		t.Fatal("proxy trusted by default", got)
	}
}
