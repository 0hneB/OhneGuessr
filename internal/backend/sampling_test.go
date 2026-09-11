package backend

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestSampleMapLocations(t *testing.T) {
	input := `{"customCoordinates":[
		null, 7, {"lat":null,"lng":0},
		{"lat":1,"lng":2},
		{"location":{"lat":3,"lng":4},"flags":1,"panoId":"nested","heading":90},
		{"location":{"lat":5,"lng":6},"flags":2},
		{"lat":7,"lng":8,"panoid":"legacy","pitch":0,"zoom":2}
	]}`
	result, err := sampleMapLocations(strings.NewReader(input), 10, map[int]bool{3: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.LocationCount != 3 || len(result.Locations) != 2 || result.MapDiagonalKM <= 0 || math.IsNaN(result.MapDiagonalKM) {
		t.Fatalf("sample = %#v", result)
	}
	for _, location := range result.Locations {
		switch location.SourceIndex {
		case 4:
			if location.Panoid == nil || *location.Panoid != "nested" || location.Heading == nil || *location.Heading != 90 || location.Pitch != nil {
				t.Fatalf("nested location = %#v", location)
			}
		case 6:
			if location.Panoid == nil || *location.Panoid != "legacy" || location.Heading != nil || location.Pitch == nil || *location.Pitch != 0 {
				t.Fatalf("flat location = %#v", location)
			}
		default:
			t.Fatalf("unexpected source index: %d", location.SourceIndex)
		}
	}
	for _, raw := range []string{`[`, `[] {}`, `{"customCoordinates":null}`, `[{}] trailing`} {
		if _, err := sampleMapLocations(strings.NewReader(raw), 1, nil); !errors.Is(err, errInvalidMapData) {
			t.Errorf("input %q: error = %v", raw, err)
		}
	}
	result, err = sampleMapLocations(strings.NewReader(`[{}, {"lat":1,"lng":2}, {"lat":3,"lng":4}]`), 1, nil)
	if err != nil || len(result.Locations) != 1 || result.LocationCount != 2 {
		t.Fatalf("limited sample = %#v, error = %v", result, err)
	}
}

func BenchmarkSampleMapLocations(b *testing.B) {
	input := "[" + strings.Repeat(`{"lat":1,"lng":2},`, 9999) + `{"lat":3,"lng":4}]`
	b.ReportAllocs()
	b.SetBytes(int64(len(input)))
	for b.Loop() {
		if _, err := sampleMapLocations(strings.NewReader(input), 5, nil); err != nil {
			b.Fatal(err)
		}
	}
}
