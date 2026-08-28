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
