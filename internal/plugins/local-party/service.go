package localparty

import (
	"errors"
	"io/fs"
	"net/url"
	"strings"
	"sync"
)

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

func (p *LocalParty) LaunchParty(mapID, theme, accentColor string) (PartyHostState, error) {
	mapID = strings.TrimSpace(mapID)
	if mapID == "" || p.mapExists == nil || !p.mapExists(mapID) {
		return PartyHostState{}, errors.New("map not found")
	}
	p.mu.Lock()
	if p.party != nil {
		p.mu.Unlock()
		return PartyHostState{}, errors.New("end the current party first")
	}
	party, err := newPartyServer(p.frontend, mapID, theme, accentColor, p.changed)
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
