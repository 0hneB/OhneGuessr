<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { formatDistance } from '../game/scoring.js';
  import { GuessMap, createRevealMaps } from '../maps/map.js';
  import type { PartyGuestState, Point } from '../types.js';

  let { join }: { join: string } = $props();
  let party = $state<PartyGuestState | null>(null);
  let username = $state('');
  let color = $state('');
  let error = $state('');
  let connectionLost = $state(false);
  let busy = $state(false);
  let hasGuess = $state(false);
  let now = $state(Date.now());
  let guessMap = $state.raw<GuessMap>();
  let resultMap: ReturnType<typeof createRevealMaps>['resultMap'];
  let events: EventSource | null = null;
  let mapRound = -2;
  let resultRound = -2;

  const availableColors = $derived(party?.colors?.filter((item) => item.available) || []);
  const remaining = $derived(party?.deadline
    ? Math.max(0, Math.ceil((party.deadline - now) / 1000))
    : 0);
  const timerText = $derived(`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The party request failed.');
    return body as T;
  }

  function openEvents() {
    if (events || !party?.joined) return;
    events = new EventSource('/api/events');
    events.addEventListener('state', (event) => {
      connectionLost = false;
      void applyState(JSON.parse((event as MessageEvent).data) as PartyGuestState);
    });
    events.onopen = () => { connectionLost = false; };
    events.onerror = () => { connectionLost = true; };
  }

  async function applyState(next: PartyGuestState) {
    party = next;
    if (next.phase === 'lobby') {
      mapRound = -2;
      resultRound = -2;
    }
    if (next.color) color = next.color;
    else if (!next.colors?.some((item) => item.value === color && item.available)) {
      color = next.colors?.find((item) => item.available)?.value || '';
    }
    if (next.phase === 'closed') {
      events?.close();
      events = null;
      connectionLost = false;
    } else if (next.joined) {
      openEvents();
    }
    await tick();
    if (next.phase === 'guessing') {
      guessMap ||= new GuessMap('partyGuessMap', placeGuess, next.mapStyle);
      if (mapRound !== next.round) {
        mapRound = next.round;
        hasGuess = false;
        guessMap!.reset();
      }
      if (next.mapStyle) guessMap!.setStyle(next.mapStyle);
      if (next.color) guessMap!.setAccent(next.color);
      if (next.guess) {
        guessMap!.setGuess(next.guess);
        hasGuess = true;
      }
      guessMap!.resize();
    }
    if (next.phase === 'result' && next.result && resultRound !== next.round) {
      if (!resultMap) {
        ({ resultMap } = createRevealMaps('partyRevealMap', 'partyFinalMap', next.mapStyle));
      }
      resultRound = next.round;
      if (next.mapStyle) resultMap.setStyle(next.mapStyle);
      if (next.color) resultMap.setAccent(next.color);
      resultMap.show({
        guess: next.result.guess || null,
        actual: next.result.actual
      });
    }
  }

  async function joinParty() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await applyState(await request<PartyGuestState>('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ join, name: username, color })
      }));
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Could not join the party.';
      try {
        await applyState(await request<PartyGuestState>(`/api/state?join=${encodeURIComponent(join)}`));
      } catch { /* retain the useful join error */ }
    } finally {
      busy = false;
    }
  }

  function placeGuess(_point: Point) {
    hasGuess = true;
    error = '';
  }

  async function lockGuess() {
    const guess = guessMap?.guess;
    if (!guess || !party || party.locked || busy) return;
    busy = true;
    error = '';
    try {
      await applyState(await request<PartyGuestState>('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round: party.round, lat: guess.lat, lng: guess.lng })
      }));
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Could not lock that guess.';
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const clock = setInterval(() => { now = Date.now(); }, 250);
    void request<PartyGuestState>(`/api/state?join=${encodeURIComponent(join)}`)
      .then(applyState)
      .catch((reason) => { error = reason instanceof Error ? reason.message : 'This party link is unavailable.'; });
    return () => {
      clearInterval(clock);
      events?.close();
    };
  });
</script>

<main class="party-guest">
  {#if !party}
    <section class="party-guest-card party-guest-center">
      <div class="spinner"></div>
      <p>{error || 'Opening party…'}</p>
    </section>
  {:else if !party.joined}
    <form class="party-guest-card party-join-form" onsubmit={(event) => { event.preventDefault(); void joinParty(); }}>
      <p class="party-eyebrow">Local Party</p>
      <h1>Join the game</h1>
      {#if party.message}
        <p class="party-error" role="alert">{party.message}</p>
      {:else}
        <label>
          <span>Username</span>
          <input bind:value={username} maxlength="20" autocomplete="nickname" required />
        </label>
        <fieldset>
          <legend>Pin color</legend>
          <div class="party-color-picker">
            {#each party.colors || [] as option}
              <button type="button" class:selected={color === option.value}
                      style={`--player-color:${option.value}`}
                      disabled={!option.available}
                      aria-label={option.available ? `Choose ${option.value}` : `${option.value} is taken`}
                      aria-pressed={color === option.value}
                      onclick={() => { color = option.value; }}></button>
            {/each}
          </div>
        </fieldset>
        <button class="party-primary" disabled={busy || !username.trim() || !color || !availableColors.length}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      {/if}
      {#if error}<p class="party-error" role="alert">{error}</p>{/if}
    </form>
  {:else if party.phase === 'lobby'}
    <section class="party-guest-card party-guest-center">
      <span class="party-wait-mark" aria-hidden="true"></span>
      <h1>You're in</h1>
      <p>Waiting for the host to start.</p>
      <small>{party.playerCount} / {party.capacity} joined</small>
    </section>
  {:else if party.phase === 'guessing'}
    <section class="party-phone-game">
      <div class="party-phone-round">
        <span>Round {party.round + 1}{party.rounds ? ` / ${party.rounds}` : ''}</span>
        {#if party.deadline}<b class:low={remaining <= 10}>{timerText}</b>{/if}
      </div>
      {#if party.locked}<div class="party-map-lock"><b>Guess locked</b><span>Waiting for everyone else.</span></div>{/if}
      <div class="party-phone-actions">
        <button class="party-primary" style={`--player-color:${party.color}`}
                disabled={busy || party.locked || !hasGuess} onclick={lockGuess}>
          {party.locked ? 'Locked' : busy ? 'Locking…' : 'Guess'}
        </button>
      </div>
    </section>
  {:else if party.phase === 'scoring'}
    <section class="party-guest-card party-guest-center">
      <div class="spinner"></div>
      <h1>Revealing…</h1>
    </section>
  {:else if party.phase === 'result' && party.result}
    <section class="party-phone-result">
      <div class="party-phone-result-card">
        <strong>{party.result.points}</strong>
        <span>points</span>
        <small>{party.result.distanceKm == null ? 'No guess' : `${formatDistance(party.result.distanceKm)} away`}</small>
        <p>Waiting for the host…</p>
      </div>
    </section>
  {:else if party.phase === 'final'}
    <section class="party-guest-card party-phone-final party-guest-center">
      <p class="party-eyebrow">Final result</p>
      <strong>#{party.place}</strong>
      <h1>{party.total} points</h1>
      <p>Look at the shared screen for the leaderboard.</p>
    </section>
  {:else}
    <section class="party-guest-card party-guest-center">
      <h1>Party ended</h1>
      <p>{party.message || 'The host closed this game.'}</p>
    </section>
  {/if}

  <div id="partyGuessMap" class="party-phone-map party-persistent-map"
       class:hidden={party?.phase !== 'guessing'}></div>
  <div id="partyRevealMap" class="party-phone-map party-persistent-map"
       class:hidden={party?.phase !== 'result'}></div>
  <div id="partyFinalMap" hidden></div>
  {#if connectionLost}<p class="party-connection" role="status">Reconnecting…</p>{/if}
  {#if party?.joined && error}<p class="party-floating-error" role="alert">{error}</p>{/if}
</main>
