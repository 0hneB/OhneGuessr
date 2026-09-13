package localparty

import (
	"errors"
	"math"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	partyCapacity   = 16
	partyCookieName = "ohneguessr_party"
	partyBodyLimit  = 4 << 10
)

var partyPalette = []string{
	"#ef4444", "#f97316", "#f59e0b", "#eab308",
	"#84cc16", "#22c55e", "#10b981", "#14b8a6",
	"#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
	"#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
}

type PartyPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type PartyPlayerRound struct {
	PlayerID string      `json:"playerId"`
	Guess    *PartyPoint `json:"guess,omitempty"`
	Distance *float64    `json:"distanceKm,omitempty"`
	Points   int         `json:"points"`
}

type PartyRoundReveal struct {
	Round   int                `json:"round"`
	Actual  PartyPoint         `json:"actual"`
	Results []PartyPlayerRound `json:"results"`
}

type PartyHostPlayer struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Color  string      `json:"color"`
	Locked bool        `json:"locked"`
	Guess  *PartyPoint `json:"guess,omitempty"`
	Total  int         `json:"total"`
	Place  int         `json:"place,omitempty"`
}

type PartyHostState struct {
	ID           string            `json:"id"`
	MapID        string            `json:"mapId"`
	Phase        string            `json:"phase"`
	URL          string            `json:"url"`
	URLs         []string          `json:"urls"`
	QRCode       string            `json:"qrCode"`
	RosterLocked bool              `json:"rosterLocked"`
	Round        int               `json:"round"`
	Rounds       int               `json:"rounds"`
	Deadline     int64             `json:"deadline"`
	MapStyle     string            `json:"mapStyle"`
	AllLocked    bool              `json:"allLocked"`
	Players      []PartyHostPlayer `json:"players"`
}

type PartyColorOption struct {
	Value     string `json:"value"`
	Available bool   `json:"available"`
}

type PartyGuestResult struct {
	Actual   PartyPoint  `json:"actual"`
	Guess    *PartyPoint `json:"guess,omitempty"`
	Distance *float64    `json:"distanceKm,omitempty"`
	Points   int         `json:"points"`
}

type PartyGuestState struct {
	Phase       string             `json:"phase"`
	Theme       string             `json:"theme"`
	AccentColor string             `json:"accentColor"`
	Joined      bool               `json:"joined"`
	Capacity    int                `json:"capacity"`
	PlayerCount int                `json:"playerCount"`
	Colors      []PartyColorOption `json:"colors,omitempty"`
	Color       string             `json:"color,omitempty"`
	Round       int                `json:"round"`
	Rounds      int                `json:"rounds"`
	Deadline    int64              `json:"deadline"`
	MapStyle    string             `json:"mapStyle,omitempty"`
	Locked      bool               `json:"locked"`
	Guess       *PartyPoint        `json:"guess,omitempty"`
	Result      *PartyGuestResult  `json:"result,omitempty"`
	Total       int                `json:"total"`
	Place       int                `json:"place,omitempty"`
	Message     string             `json:"message,omitempty"`
}

type partyPlayer struct {
	id     string
	name   string
	color  string
	token  string
	guess  *PartyPoint
	locked bool
	total  int
	place  int
	result *PartyGuestResult
}

func cleanPartyName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > 20 {
		return "", errors.New("username must be 1–20 characters")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", errors.New("username contains unsupported characters")
		}
	}
	return value, nil
}

func partyColor(value string) bool {
	for _, color := range partyPalette {
		if value == color {
			return true
		}
	}
	return false
}

func validPartyPoint(point PartyPoint) bool {
	return point.Lat >= -90 && point.Lat <= 90 && point.Lng >= -180 && point.Lng <= 180
}

func (p *partyServer) colorUsedLocked(color string) bool {
	for _, player := range p.players {
		if player.color == color {
			return true
		}
	}
	return false
}

func (p *partyServer) guestStateLocked(player *partyPlayer) PartyGuestState {
	state := PartyGuestState{
		Phase:       p.phase,
		Theme:       p.theme,
		AccentColor: p.accentColor,
		Joined:      player != nil,
		Capacity:    partyCapacity,
		PlayerCount: len(p.players),
		Round:       p.round,
		Rounds:      p.rounds,
		Deadline:    p.deadline,
		MapStyle:    p.mapStyle,
	}
	if player == nil {
		state.Colors = make([]PartyColorOption, 0, len(partyPalette))
		for _, color := range partyPalette {
			state.Colors = append(state.Colors, PartyColorOption{
				Value: color, Available: !p.colorUsedLocked(color),
			})
		}
		if p.rosterLocked {
			state.Message = "This game already has a fixed roster."
		}
		return state
	}
	state.Color = player.color
	state.Locked = player.locked
	state.Guess = clonePartyPoint(player.guess)
	state.Result = cloneGuestResult(player.result)
	state.Total = player.total
	state.Place = player.place
	if p.phase == "closed" {
		state.Message = "The host ended the party."
	}
	return state
}

func clonePartyPoint(point *PartyPoint) *PartyPoint {
	if point == nil {
		return nil
	}
	copy := *point
	return &copy
}

func cloneGuestResult(result *PartyGuestResult) *PartyGuestResult {
	if result == nil {
		return nil
	}
	copy := *result
	copy.Guess = clonePartyPoint(result.Guess)
	if result.Distance != nil {
		distance := *result.Distance
		copy.Distance = &distance
	}
	return &copy
}

func (p *partyServer) allLockedLocked() bool {
	if len(p.players) == 0 {
		return false
	}
	for _, player := range p.players {
		if !player.locked {
			return false
		}
	}
	return true
}

func (p *partyServer) hostState() PartyHostState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.hostStateLocked()
}

func (p *partyServer) hostStateLocked() PartyHostState {
	state := PartyHostState{
		ID: p.id, MapID: p.mapID, Phase: p.phase, URL: p.url,
		URLs: append([]string(nil), p.urls...), QRCode: p.qrCode,
		RosterLocked: p.rosterLocked, Round: p.round, Rounds: p.rounds,
		Deadline: p.deadline, MapStyle: p.mapStyle, AllLocked: p.allLockedLocked(),
		Players: make([]PartyHostPlayer, 0, len(p.players)),
	}
	for _, player := range p.players {
		state.Players = append(state.Players, PartyHostPlayer{
			ID: player.id, Name: player.name, Color: player.color,
			Locked: player.locked, Guess: clonePartyPoint(player.guess),
			Total: player.total, Place: player.place,
		})
	}
	return state
}

func (p *partyServer) lockRoster() (PartyHostState, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.phase != "lobby" || len(p.players) == 0 {
		return PartyHostState{}, errors.New("at least one player must join before starting")
	}
	p.rosterLocked = true
	p.notifyLocked()
	return p.hostStateLocked(), nil
}

func (p *partyServer) beginRound(round, rounds int, deadline int64, mapStyle string) error {
	p.mu.Lock()
	if !p.rosterLocked || (p.phase != "lobby" && p.phase != "result") {
		p.mu.Unlock()
		return errors.New("party is not ready for a round")
	}
	if round != p.round+1 || rounds < 0 || (rounds > 0 && round >= rounds) ||
		(p.round >= 0 && rounds != p.rounds) || deadline < 0 {
		p.mu.Unlock()
		return errors.New("invalid party round")
	}
	p.phase = "guessing"
	p.round = round
	p.rounds = rounds
	p.deadline = deadline
	p.mapStyle = strings.TrimSpace(mapStyle)
	for _, player := range p.players {
		player.guess = nil
		player.locked = false
		player.result = nil
	}
	p.notifyLocked()
	p.mu.Unlock()
	p.emitChanged()
	return nil
}

func (p *partyServer) closeRound(round int) ([]PartyHostPlayer, error) {
	p.mu.Lock()
	if p.phase != "guessing" || p.round != round {
		p.mu.Unlock()
		return nil, errors.New("party round is no longer open")
	}
	p.phase = "scoring"
	p.deadline = 0
	players := p.hostStateLocked().Players
	p.notifyLocked()
	p.mu.Unlock()
	p.emitChanged()
	return players, nil
}

func (p *partyServer) publishReveal(reveal PartyRoundReveal) error {
	p.mu.Lock()
	if p.phase != "scoring" || reveal.Round != p.round || !validPartyPoint(reveal.Actual) {
		p.mu.Unlock()
		return errors.New("invalid party reveal")
	}
	results := make(map[string]PartyPlayerRound, len(reveal.Results))
	for _, result := range reveal.Results {
		invalidDistance := result.Distance != nil && (*result.Distance < 0 || math.IsNaN(*result.Distance) || math.IsInf(*result.Distance, 0))
		if _, duplicate := results[result.PlayerID]; duplicate || result.Points < 0 || result.Points > 5000 || invalidDistance {
			p.mu.Unlock()
			return errors.New("invalid party results")
		}
		results[result.PlayerID] = result
	}
	if len(results) != len(p.players) {
		p.mu.Unlock()
		return errors.New("party results do not match the roster")
	}
	for _, player := range p.players {
		result, ok := results[player.id]
		if !ok {
			p.mu.Unlock()
			return errors.New("party results do not match the roster")
		}
		if !samePartyPoint(result.Guess, player.guess) {
			p.mu.Unlock()
			return errors.New("party results do not match submitted guesses")
		}
		player.total += result.Points
		player.result = &PartyGuestResult{
			Actual: reveal.Actual, Guess: clonePartyPoint(result.Guess),
			Distance: result.Distance, Points: result.Points,
		}
	}
	p.phase = "result"
	p.notifyLocked()
	p.mu.Unlock()
	p.emitChanged()
	return nil
}

func (p *partyServer) finish() (PartyHostState, error) {
	p.mu.Lock()
	if p.phase != "result" || (p.rounds > 0 && p.round+1 != p.rounds) {
		p.mu.Unlock()
		return PartyHostState{}, errors.New("party is not ready to finish")
	}
	ranked := append([]*partyPlayer(nil), p.players...)
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].total > ranked[j].total })
	place := 0
	previous := -1
	for index, player := range ranked {
		if index == 0 || player.total != previous {
			place = index + 1
		}
		player.place = place
		previous = player.total
	}
	p.phase = "final"
	p.notifyLocked()
	state := p.hostStateLocked()
	p.mu.Unlock()
	p.emitChanged()
	return state, nil
}

func samePartyPoint(left, right *PartyPoint) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Lat == right.Lat && left.Lng == right.Lng
}

func (p *partyServer) reset() error {
	p.mu.Lock()
	if p.phase != "final" {
		p.mu.Unlock()
		return errors.New("party is not finished")
	}
	p.phase = "lobby"
	p.round = -1
	p.rounds = 0
	p.deadline = 0
	p.mapStyle = ""
	for _, player := range p.players {
		player.guess = nil
		player.locked = false
		player.total = 0
		player.place = 0
		player.result = nil
	}
	p.notifyLocked()
	p.mu.Unlock()
	p.emitChanged()
	return nil
}
