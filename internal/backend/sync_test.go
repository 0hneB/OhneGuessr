package backend

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
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
	release()
	secondCtx, secondRelease, err := coordinator.acquire("Learnable Meta")
	if err != nil {
		t.Fatal(err)
	}
	defer secondRelease()
	release() // A late duplicate release must not clear or finish the next job.
	if _, _, err := coordinator.acquire(firstJob); err == nil {
		t.Fatal("duplicate release cleared the active job")
	}
	if !coordinator.cancelJob("Learnable Meta") || !errors.Is(secondCtx.Err(), context.Canceled) {
		t.Fatal("duplicate release lost the active job's cancellation")
	}
	secondRelease()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := coordinator.shutdown(shutdownCtx); err != nil {
		t.Fatal(err)
	}
}
