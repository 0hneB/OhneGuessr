package httpjson

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"
)

const MaxBodySize = 64 << 20

type responseError struct {
	status  int
	message string
}

func (e *responseError) Error() string       { return e.message }
func (e *responseError) HTTPStatus() int     { return e.status }
func (e *responseError) HTTPMessage() string { return e.message }

func Error(status int, message string) error {
	return &responseError{status: status, message: message}
}

func Handler(fn func(*http.Request) (any, int, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, status, err := fn(r)
		if err != nil {
			code, message := errorResponse(err)
			Write(w, code, map[string]string{"error": message})
			return
		}
		Write(w, status, payload)
	}
}

func errorResponse(err error) (int, string) {
	var response interface {
		error
		HTTPStatus() int
		HTTPMessage() string
	}
	if errors.As(err, &response) {
		return response.HTTPStatus(), response.HTTPMessage()
	}
	return http.StatusInternalServerError, "request failed"
}

func Write(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"response failed"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func Decode[T any](r *http.Request) (T, error) {
	var result T
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return result, Error(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}
	if r.ContentLength > MaxBodySize {
		return result, Error(http.StatusRequestEntityTooLarge, "request body is too large")
	}
	r.Body = http.MaxBytesReader(nil, r.Body, MaxBodySize)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&result); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return result, Error(http.StatusRequestEntityTooLarge, "request body is too large")
		}
		return result, Error(http.StatusBadRequest, "invalid JSON request")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return result, Error(http.StatusBadRequest, "request body must contain one JSON value")
	}
	return result, nil
}

func ReadLimited(reader io.Reader, maximum int64) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(value)) > maximum {
		return nil, errors.New("response is too large")
	}
	return value, nil
}

func Wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
