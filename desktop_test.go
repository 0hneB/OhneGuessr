package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChallengeFileBoundary(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "game.ohne")
	if err := atomicWriteFile(filename, []byte(`{"format":"ohneguessr.challenge"}`)); err != nil {
		t.Fatal(err)
	}
	if err := atomicWriteFile(filename, []byte(`{"format":"ohneguessr.challenge","version":1}`)); err != nil {
		t.Fatalf("overwrite challenge: %v", err)
	}
	contents, err := readChallengeFile(filename)
	if err != nil || contents == "" {
		t.Fatalf("read challenge = %q, %v", contents, err)
	}
	wrong := filepath.Join(dir, "game.json")
	if err := os.WriteFile(wrong, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readChallengeFile(wrong); err == nil {
		t.Fatal("expected non-.ohne file to fail")
	}
	large := filepath.Join(dir, "large.ohne")
	if err := os.WriteFile(large, []byte(strings.Repeat("x", maxChallengeSize+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readChallengeFile(large); err == nil {
		t.Fatal("expected oversized challenge to fail")
	}
}
