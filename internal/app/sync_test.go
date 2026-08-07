package app

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestSyncCoordinator(t *testing.T) {
	t.Parallel()
	coordinator := &syncCoordinator{}
	const firstJob = "Map Making App"
	ctx, release, err := coordinator.acquire(firstJob)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, _, err := coordinator.acquire("Learnable Meta"); err == nil || !strings.Contains(err.Error(), firstJob) {
		t.Fatalf("coordinator conflict = %v", err)
	}
	coordinator.cancelJob(firstJob)
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("context error = %v", ctx.Err())
	}
}
