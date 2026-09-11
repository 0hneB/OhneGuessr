package desktop

import "testing"

func TestGameURL(t *testing.T) {
	tests := []struct {
		name  string
		mapID string
		mode  string
		want  string
	}{
		{name: "normal", mapID: "world", want: "/?view=game&map=world"},
		{
			name:  "mode",
			mapID: "map one",
			mode:  "country-streak",
			want:  "/?view=game&map=map+one&mode=country-streak",
		},
		{name: "blank mode", mapID: "world", mode: "  ", want: "/?view=game&map=world"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := gameURL(test.mapID, test.mode); got != test.want {
				t.Fatalf("gameURL() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestParseColourRef(t *testing.T) {
	tests := map[string]struct {
		value string
		want  uint32
		ok    bool
	}{
		"long":    {value: "#1d1a18", want: 0x181a1d, ok: true},
		"short":   {value: "#abc", want: 0xccbbaa, ok: true},
		"invalid": {value: "grey", ok: false},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			got, ok := parseColourRef(test.value)
			if got != test.want || ok != test.ok {
				t.Fatalf("parseColourRef(%q) = %#x, %t; want %#x, %t", test.value, got, ok, test.want, test.ok)
			}
		})
	}
}
