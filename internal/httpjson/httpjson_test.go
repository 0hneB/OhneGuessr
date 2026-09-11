package httpjson

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeLimit(t *testing.T) {
	for _, tc := range []struct {
		name, body, contentType string
		status                  int
	}{
		{"valid", `{"n":1}`, "application/json; charset=utf-8", http.StatusOK},
		{"exact limit", `{"n":1} `, "application/json", http.StatusOK},
		{"wrong type", `{}`, "text/plain", http.StatusUnsupportedMediaType},
		{"malformed", `{"n":`, "application/json", http.StatusBadRequest},
		{"second value", `{} {}`, "application/json", http.StatusBadRequest},
		{"oversized value", `{"n":12345}`, "application/json", http.StatusRequestEntityTooLarge},
		{"oversized whitespace", `{}       `, "application/json", http.StatusRequestEntityTooLarge},
		{"oversized second value", `{} {"n":12345}`, "application/json", http.StatusRequestEntityTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			r.ContentLength = -1 // Exercise streamed bodies without a declared size.
			r.Header.Set("Content-Type", tc.contentType)
			_, err := DecodeLimit[struct{ N int }](r, 8)
			status := http.StatusOK
			if err != nil {
				status, _ = errorResponse(err)
			}
			if status != tc.status {
				t.Fatalf("status = %d, want %d (error: %v)", status, tc.status, err)
			}
		})
	}
}
