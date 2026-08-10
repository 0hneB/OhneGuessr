package localparty

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	qrcode "github.com/skip2/go-qrcode"
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

type partyServer struct {
	mu           sync.Mutex
	id           string
	secret       string
	mapID        string
	frontend     fs.FS
	listener     net.Listener
	server       *http.Server
	url          string
	urls         []string
	qrCode       string
	phase        string
	rosterLocked bool
	round        int
	rounds       int
	deadline     int64
	mapStyle     string
	players      []*partyPlayer
	byToken      map[string]*partyPlayer
	history      []PartyRoundReveal
	subscribers  map[chan struct{}]struct{}
	changed      func(string)
	closed       bool
}

type LocalParty struct {
	mu         sync.RWMutex
	frontend   fs.FS
	mapExists  func(string) bool
	launchGame func(string, string) error
	changed    func(string)
	party      *partyServer
}

func New(
	frontend fs.FS,
	mapExists func(string) bool,
	launchGame func(string, string) error,
	changed func(string),
) *LocalParty {
	return &LocalParty{
		frontend: frontend, mapExists: mapExists, launchGame: launchGame, changed: changed,
	}
}

func newPartyServer(frontend fs.FS, mapID string, changed func(string)) (*partyServer, error) {
	id, err := partyToken(12)
	if err != nil {
		return nil, err
	}
	secret, err := partyToken(24)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", "0.0.0.0:8077")
	if err != nil {
		listener, err = net.Listen("tcp4", "0.0.0.0:0")
	}
	if err != nil {
		return nil, fmt.Errorf("start local party server: %w", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port
	urls := partyURLs(port, secret)
	png, err := qrcode.Encode(urls[0], qrcode.Medium, 256)
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("create party QR code: %w", err)
	}
	p := &partyServer{
		id:          id,
		secret:      secret,
		mapID:       mapID,
		frontend:    frontend,
		listener:    listener,
		url:         urls[0],
		urls:        urls,
		qrCode:      "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
		phase:       "lobby",
		round:       -1,
		byToken:     make(map[string]*partyPlayer),
		subscribers: make(map[chan struct{}]struct{}),
		changed:     changed,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", p.serveState)
	mux.HandleFunc("POST /api/join", p.serveJoin)
	mux.HandleFunc("GET /api/events", p.serveEvents)
	mux.HandleFunc("POST /api/guess", p.serveGuess)
	mux.HandleFunc("GET /{file...}", p.serveFrontend)
	p.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       75 * time.Second,
	}
	go func() { _ = p.server.Serve(listener) }()
	return p, nil
}

func partyToken(bytes int) (string, error) {
	value := make([]byte, bytes)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("create party token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func partyURLs(port int, secret string) []string {
	preferred := ""
	if connection, err := net.Dial("udp4", "192.0.2.1:80"); err == nil {
		if address, ok := connection.LocalAddr().(*net.UDPAddr); ok && address.IP.IsPrivate() {
			preferred = address.IP.String()
		}
		_ = connection.Close()
	}
	addresses := make([]string, 0)
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		items, _ := iface.Addrs()
		for _, item := range items {
			ip, _, err := net.ParseCIDR(item.String())
			if err != nil || ip.To4() == nil || (!ip.IsPrivate() && !ip.IsLinkLocalUnicast()) {
				continue
			}
			addresses = append(addresses, ip.String())
		}
	}
	sort.Strings(addresses)
	addresses = slices.Compact(addresses)
	if preferred != "" {
		ordered := []string{preferred}
		for _, address := range addresses {
			if address != preferred {
				ordered = append(ordered, address)
			}
		}
		addresses = ordered
	}
	if len(addresses) == 0 {
		addresses = []string{"127.0.0.1"}
	}
	urls := make([]string, 0, len(addresses))
	for _, address := range addresses {
		host := net.JoinHostPort(address, strconv.Itoa(port))
		urls = append(urls, "http://"+host+"/?view=party&join="+url.QueryEscape(secret))
	}
	return urls
}

func (p *partyServer) close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	p.phase = "closed"
	p.notifyLocked()
	p.mu.Unlock()
	forceClose := time.AfterFunc(250*time.Millisecond, func() { _ = p.server.Close() })
	defer forceClose.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := p.server.Shutdown(ctx); err != nil {
		if closeErr := p.server.Close(); closeErr != nil && !errors.Is(closeErr, http.ErrServerClosed) {
			return closeErr
		}
	}
	return nil
}

func (p *partyServer) serveFrontend(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean("/"+r.PathValue("file")), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	contents, err := fs.ReadFile(p.frontend, name)
	if err != nil {
		name = "index.html"
		contents, err = fs.ReadFile(p.frontend, name)
	}
	if err != nil {
		http.Error(w, "guest app unavailable", http.StatusNotFound)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if path.Ext(name) == ".js" {
		contentType = "text/javascript; charset=utf-8"
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	_, _ = w.Write(contents)
}

func (p *partyServer) serveState(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	player := p.playerFromRequestLocked(r)
	if player == nil && r.URL.Query().Get("join") != p.secret {
		p.mu.Unlock()
		partyError(w, http.StatusForbidden, "invalid party link")
		return
	}
	state := p.guestStateLocked(player)
	p.mu.Unlock()
	partyJSON(w, http.StatusOK, state)
}

func (p *partyServer) serveJoin(w http.ResponseWriter, r *http.Request) {
	if !partySameOrigin(r) {
		partyError(w, http.StatusForbidden, "invalid request origin")
		return
	}
	var body struct {
		Join  string `json:"join"`
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := partyDecode(r, &body); err != nil {
		partyError(w, http.StatusBadRequest, err.Error())
		return
	}
	name, err := cleanPartyName(body.Name)
	if err != nil {
		partyError(w, http.StatusBadRequest, err.Error())
		return
	}
	color := strings.ToLower(strings.TrimSpace(body.Color))

	p.mu.Lock()
	if existing := p.playerFromRequestLocked(r); existing != nil {
		state := p.guestStateLocked(existing)
		p.mu.Unlock()
		partyJSON(w, http.StatusOK, state)
		return
	}
	if body.Join != p.secret {
		p.mu.Unlock()
		partyError(w, http.StatusForbidden, "invalid party link")
		return
	}
	if p.closed || p.rosterLocked || p.phase != "lobby" {
		p.mu.Unlock()
		partyError(w, http.StatusConflict, "the party roster is locked")
		return
	}
	if len(p.players) >= partyCapacity {
		p.mu.Unlock()
		partyError(w, http.StatusConflict, "the party is full")
		return
	}
	if !partyColor(color) || p.colorUsedLocked(color) {
		p.mu.Unlock()
		partyError(w, http.StatusConflict, "that color is unavailable")
		return
	}
	for _, player := range p.players {
		if strings.EqualFold(player.name, name) {
			p.mu.Unlock()
			partyError(w, http.StatusConflict, "that username is already taken")
			return
		}
	}
	token, tokenErr := partyToken(24)
	id, idErr := partyToken(9)
	if tokenErr != nil || idErr != nil {
		p.mu.Unlock()
		partyError(w, http.StatusInternalServerError, "could not join the party")
		return
	}
	player := &partyPlayer{id: id, name: name, color: color, token: token}
	p.players = append(p.players, player)
	p.byToken[token] = player
	p.notifyLocked()
	state := p.guestStateLocked(player)
	p.mu.Unlock()
	p.emitChanged()
	http.SetCookie(w, &http.Cookie{
		Name:     partyCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	partyJSON(w, http.StatusCreated, state)
}

func (p *partyServer) serveEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		partyError(w, http.StatusInternalServerError, "streaming is unavailable")
		return
	}
	p.mu.Lock()
	player := p.playerFromRequestLocked(r)
	if player == nil {
		p.mu.Unlock()
		partyError(w, http.StatusUnauthorized, "join the party first")
		return
	}
	updates := make(chan struct{}, 1)
	p.subscribers[updates] = struct{}{}
	state := p.guestStateLocked(player)
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.subscribers, updates)
		p.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	writePartyEvent(w, state)
	flusher.Flush()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-updates:
			p.mu.Lock()
			state = p.guestStateLocked(player)
			p.mu.Unlock()
			writePartyEvent(w, state)
			flusher.Flush()
		case <-ticker.C:
			_, _ = io.WriteString(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (p *partyServer) serveGuess(w http.ResponseWriter, r *http.Request) {
	if !partySameOrigin(r) {
		partyError(w, http.StatusForbidden, "invalid request origin")
		return
	}
	var body struct {
		Round int     `json:"round"`
		Lat   float64 `json:"lat"`
		Lng   float64 `json:"lng"`
	}
	if err := partyDecode(r, &body); err != nil {
		partyError(w, http.StatusBadRequest, err.Error())
		return
	}
	guess := PartyPoint{Lat: body.Lat, Lng: body.Lng}
	if !validPartyPoint(guess) {
		partyError(w, http.StatusBadRequest, "invalid guess coordinates")
		return
	}

	p.mu.Lock()
	player := p.playerFromRequestLocked(r)
	if player == nil {
		p.mu.Unlock()
		partyError(w, http.StatusUnauthorized, "join the party first")
		return
	}
	if p.phase != "guessing" || body.Round != p.round {
		p.mu.Unlock()
		partyError(w, http.StatusConflict, "that round is no longer accepting guesses")
		return
	}
	if !player.locked {
		player.guess = &guess
		player.locked = true
	}
	p.notifyLocked()
	state := p.guestStateLocked(player)
	p.mu.Unlock()
	p.emitChanged()
	partyJSON(w, http.StatusOK, state)
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

func (p *partyServer) playerFromRequestLocked(r *http.Request) *partyPlayer {
	cookie, err := r.Cookie(partyCookieName)
	if err != nil {
		return nil
	}
	return p.byToken[cookie.Value]
}

func (p *partyServer) guestStateLocked(player *partyPlayer) PartyGuestState {
	state := PartyGuestState{
		Phase:       p.phase,
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

func (p *partyServer) notifyLocked() {
	for subscriber := range p.subscribers {
		select {
		case subscriber <- struct{}{}:
		default:
		}
	}
}

func (p *partyServer) emitChanged() {
	if p.changed != nil {
		p.changed(p.id)
	}
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
	p.history = append(p.history, reveal)
	p.phase = "result"
	p.notifyLocked()
	p.mu.Unlock()
	p.emitChanged()
	return nil
}

func (p *partyServer) finish() (PartyHostState, error) {
	p.mu.Lock()
	if p.phase != "result" || len(p.history) == 0 || (p.rounds > 0 && p.round+1 != p.rounds) {
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
	p.history = nil
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

func partySameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == r.Host
}

func partyDecode(r *http.Request, target any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errors.New("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(nil, r.Body, partyBodyLimit)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON request")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writePartyEvent(w io.Writer, state PartyGuestState) {
	data, _ := json.Marshal(state)
	_, _ = fmt.Fprintf(w, "event: state\ndata: %s\n\n", data)
}

func partyJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func partyError(w http.ResponseWriter, status int, message string) {
	partyJSON(w, status, map[string]string{"error": message})
}

func (p *LocalParty) activeParty(id string) (*partyServer, error) {
	p.mu.RLock()
	party := p.party
	p.mu.RUnlock()
	if party == nil || (id != "" && party.id != id) {
		return nil, errors.New("party is no longer available")
	}
	return party, nil
}

func (p *LocalParty) Active() bool {
	if p == nil {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.party != nil
}

func (p *LocalParty) LaunchParty(mapID string) (PartyHostState, error) {
	mapID = strings.TrimSpace(mapID)
	if mapID == "" || p.mapExists == nil || !p.mapExists(mapID) {
		return PartyHostState{}, errors.New("map not found")
	}
	p.mu.Lock()
	if p.party != nil {
		p.mu.Unlock()
		return PartyHostState{}, errors.New("end the current party first")
	}
	party, err := newPartyServer(p.frontend, mapID, p.changed)
	if err != nil {
		p.mu.Unlock()
		return PartyHostState{}, err
	}
	p.party = party
	p.mu.Unlock()
	if p.launchGame == nil {
		_ = p.StopParty(party.id)
		return PartyHostState{}, errors.New("desktop runtime is not ready")
	}
	if err := p.launchGame(partyGameURL(mapID, party.id), mapID); err != nil {
		_ = p.StopParty(party.id)
		return PartyHostState{}, err
	}
	return party.hostState(), nil
}

func (p *LocalParty) GetPartyHostState(id string) (PartyHostState, error) {
	party, err := p.activeParty(id)
	if err != nil {
		return PartyHostState{}, err
	}
	return party.hostState(), nil
}

func (p *LocalParty) LockPartyRoster(id string) (PartyHostState, error) {
	party, err := p.activeParty(id)
	if err != nil {
		return PartyHostState{}, err
	}
	return party.lockRoster()
}

func (p *LocalParty) BeginPartyRound(id string, round, rounds int, deadline int64, mapStyle string) error {
	party, err := p.activeParty(id)
	if err != nil {
		return err
	}
	return party.beginRound(round, rounds, deadline, mapStyle)
}

func (p *LocalParty) ClosePartyRound(id string, round int) ([]PartyHostPlayer, error) {
	party, err := p.activeParty(id)
	if err != nil {
		return nil, err
	}
	return party.closeRound(round)
}

func (p *LocalParty) PublishPartyReveal(id string, reveal PartyRoundReveal) error {
	party, err := p.activeParty(id)
	if err != nil {
		return err
	}
	return party.publishReveal(reveal)
}

func (p *LocalParty) FinishParty(id string) (PartyHostState, error) {
	party, err := p.activeParty(id)
	if err != nil {
		return PartyHostState{}, err
	}
	return party.finish()
}

func (p *LocalParty) ResetParty(id string) error {
	party, err := p.activeParty(id)
	if err != nil {
		return err
	}
	return party.reset()
}

func (p *LocalParty) StopParty(id string) error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	party := p.party
	if party == nil || (id != "" && party.id != id) {
		p.mu.Unlock()
		return nil
	}
	p.party = nil
	p.mu.Unlock()
	return party.close()
}

func partyGameURL(mapID, partyID string) string {
	return "/?view=game&map=" + url.QueryEscape(mapID) + "&party=" + url.QueryEscape(partyID)
}
