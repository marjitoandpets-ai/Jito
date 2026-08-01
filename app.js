// --- Firebase Init ---
const firebaseConfig = {
  apiKey: "AIzaSyCdB3Q-i_nkT2p4n4GK4OgP05EDhOKvIT4",
  authDomain: "marjitosmatchupmadness.firebaseapp.com",
  databaseURL: "https://marjitosmatchupmadness-default-rtdb.firebaseio.com",
  projectId: "marjitosmatchupmadness",
  storageBucket: "marjitosmatchupmadness.firebasestorage.app",
  messagingSenderId: "559034424876",
  appId: "1:559034424876:web:8140f85b5c98b48d2ffb89",
  measurementId: "G-LCYNDGW2X9"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const App = (() => {
  const STORAGE_KEY = 'marjitos_madness';
  let state = loadState();
  let currentPicks = {};
  let currentPlayer = '';
  let tiebreakerScore = '';
  let selectedPresets = [];
  let firebaseReady = false;

  // NFL team code <-> display name mapping
  const TEAMS = {
    ARI:'Cardinals',ATL:'Falcons',BAL:'Ravens',BUF:'Bills',CAR:'Panthers',
    CHI:'Bears',CIN:'Bengals',CLE:'Browns',DAL:'Cowboys',DEN:'Broncos',
    DET:'Lions',GB:'Packers',HOU:'Texans',IND:'Colts',JAX:'Jaguars',
    KC:'Chiefs',LV:'Raiders',LAC:'Chargers',LAR:'Rams',MIA:'Dolphins',
    MIN:'Vikings',NE:'Patriots',NO:'Saints',NYG:'Giants',NYJ:'Jets',
    PHI:'Eagles',PIT:'Steelers',SF:'49ers',SEA:'Seahawks',TB:'Buccaneers',
    TEN:'Titans',WAS:'Commanders'
  };
  const NAME_TO_CODE = Object.fromEntries(Object.entries(TEAMS).map(([k,v]) => [v,k]));

  // Week 1 2026 presets
  const PRESETS = [
    { a: 'Bills', b: 'Texans', spread: '1.5', tag: 'AFC Heavyweights', prime: null },
    { a: 'Packers', b: 'Vikings', spread: '1.5', tag: 'NFC North Rivalry', prime: null },
    { a: 'Cowboys', b: 'Giants', spread: '2.5', tag: 'NFC East Rivalry', prime: 'SNF' },
    { a: '49ers', b: 'Rams', spread: '2.5', tag: 'Melbourne Showdown', prime: 'TNF' },
    { a: 'Broncos', b: 'Chiefs', spread: '2.5', tag: 'AFC West', prime: 'MNF' },
  ];

  // --- State Management ---
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState(); }
    catch { return defaultState(); }
  }
  function defaultState() {
    return { players: {}, weeks: {}, results: {} };
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function save() {
    saveLocal();
    // Push to Firebase
    db.ref('state').set(state).catch(err => console.warn('Firebase write failed:', err));
  }

  // --- Firebase Real-time Listener ---
  function initFirebase() {
    db.ref('state').on('value', (snapshot) => {
      const remote = snapshot.val();
      if (remote) {
        state = {
          players: remote.players || {},
          weeks: remote.weeks || {},
          results: remote.results || {}
        };
        saveLocal();
        firebaseReady = true;
        // Refresh current screen if dashboard/leaderboard is showing
        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen) {
          const id = activeScreen.id;
          if (id === 'screen-dashboard') renderDashboard();
          if (id === 'screen-leaderboard') renderLeaderboard();
          if (id === 'screen-results') loadResultsWeek();
          if (id === 'screen-commissioner') { initCommissioner(); updateLiveFeed(); }
          if (id === 'screen-all-picks') renderAllPicks();
          if (id === 'screen-confirm') {
            const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
            if (data) renderPickCounter(data);
          }
        }
      } else {
        // First time — push local state to Firebase
        firebaseReady = true;
        if (Object.keys(state.weeks).length > 0 || Object.keys(state.players).length > 0) {
          db.ref('state').set(state);
        }
      }
    }, (err) => {
      console.warn('Firebase read failed, using local storage:', err);
      firebaseReady = true;
    });
  }

  // --- Screen Navigation ---
  function showScreen(id) {
    sessionStorage.setItem('marjitos_last_screen', id);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'screen-landing') updateLandingInfo();
    if (id === 'screen-commissioner') {
      // Auto-set week from URL or latest saved week (unless override active)
      if (_commWeekOverride === null) {
        const urlData = parseURL();
        const weekEl = document.getElementById('comm-week');
        if (urlData && urlData.week) {
          weekEl.value = urlData.week;
        } else {
          const savedWeeks = Object.keys(state.weeks).sort((a, b) => b - a);
          if (savedWeeks.length > 0) weekEl.value = savedWeeks[0];
        }
      }
      initCommissioner();
      updateLiveFeed();
    }
    if (id === 'screen-leaderboard') renderLeaderboard();
    if (id === 'screen-my-stats') renderMyStats();
    if (id === 'screen-results') loadResultsWeek();
    if (id === 'screen-dashboard') renderDashboard();
    if (id === 'screen-all-picks') renderAllPicks();
  }

  // --- URL Hash Encoding ---
  function encodeHash(data) {
    let h = data.week.toString();
    data.matchups.forEach(m => {
      const cA = NAME_TO_CODE[m.a] || m.a;
      const cB = NAME_TO_CODE[m.b] || m.b;
      h += '-' + cA + '.' + cB + (m.isSuper ? '!' : '');
    });
    return h;
  }

  function decodeHash(hash) {
    const h = hash.replace(/^#/, '');
    if (!h) return null;
    const parts = h.split('-');
    if (parts.length < 2) return null;
    const week = parseInt(parts[0]);
    if (isNaN(week)) return null;
    const matchups = [];
    for (let i = 1; i < parts.length; i++) {
      const isSuper = parts[i].endsWith('!');
      const seg = parts[i].replace('!', '');
      const teams = seg.split('.');
      if (teams.length !== 2) continue;
      matchups.push({
        a: TEAMS[teams[0]] || teams[0],
        b: TEAMS[teams[1]] || teams[1],
        isSuper
      });
    }
    return matchups.length ? { week, matchups } : null;
  }

  function parseURL() {
    const hashData = decodeHash(window.location.hash);
    if (hashData) return hashData;
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('m');
    if (!encoded) return null;
    try { return JSON.parse(atob(encoded)); }
    catch { return null; }
  }

  function init() {
    // Restore last screen from sessionStorage
    const lastScreen = sessionStorage.getItem('marjitos_last_screen');

    // Remember player name across sessions
    const savedName = localStorage.getItem('marjitos_player_name');
    if (savedName) {
      currentPlayer = savedName;
      const nameInput = document.getElementById('player-name');
      if (nameInput) nameInput.value = savedName;
    }

    initFirebase();
    const data = parseURL();
    if (data && data.matchups) {
      state.weeks[data.week] = data;
      save();
      showScreen(lastScreen || 'screen-landing');
    } else if (lastScreen) {
      showScreen(lastScreen);
    }
  }

  // --- Landing Info ---
  function updateLandingInfo() {
    const el = document.getElementById('active-week-info');
    if (!el) return;
    const urlData = parseURL();
    let weekData;
    if (urlData && urlData.matchups) {
      weekData = urlData;
    } else {
      const weekKeys = Object.keys(state.weeks).sort((a, b) => b - a);
      if (weekKeys.length > 0) weekData = state.weeks[weekKeys[0]];
    }
    if (weekData && weekData.matchups) {
      let html = `<div style="text-align:center;margin-bottom:12px;padding:8px;border-radius:8px;background:rgba(0,200,150,0.06)">`;
      html += `<div style="font-size:0.7rem;font-weight:700;color:var(--accent);letter-spacing:1px;margin-bottom:4px">WEEK ${weekData.week} ACTIVE</div>`;
      html += weekData.matchups.map(m => `<span style="font-size:0.8rem;color:var(--text-dim)">${m.a} vs ${m.b}${m.isSuper ? ' ⭐' : ''}</span>`).join('<br>');
      html += `</div>`;
      el.innerHTML = html;
    } else {
      el.innerHTML = '';
    }
  }

  // --- Commissioner ---
  function initCommissioner() {
    selectedPresets = [];
    const container = document.getElementById('matchup-setups');
    container.innerHTML = '';

    const weekEl = document.getElementById('comm-week');
    // If override is set (e.g. from nextWeek), force that value
    if (_commWeekOverride !== null) {
      weekEl.value = _commWeekOverride;
    }
    const week = parseInt(weekEl.value) || 1;
    const existingWeek = state.weeks[week];

    // If this week already has matchups, show locked view
    if (existingWeek && existingWeek.matchups && existingWeek.matchups.length > 0) {
      let html = '<div class="divider-text">week ' + week + ' matchups locked</div>';
      existingWeek.matchups.forEach((m, i) => {
        const label = m.isSuper ? 'SUPER' : `Matchup ${i + 1}`;
        html += `<div class="live-pick-row"><span class="live-pick-name">${label}</span><span class="live-pick-teams">${m.a} vs ${m.b}</span></div>`;
      });
      html += `<div style="display:flex;gap:8px;margin-top:12px">`;
      html += `<button class="btn ghost" style="flex:1" onclick="App.editWeekSetup()">Edit Week ${week}</button>`;
      html += `<button class="btn secondary" style="flex:1" onclick="App.nextWeek()">+ Next Week</button>`;
      html += `</div>`;
      container.innerHTML = html;

      // Show share link
      const hash = encodeHash(existingWeek);
      const url = window.location.origin + window.location.pathname + '#' + hash;
      document.getElementById('share-link').value = url;
      document.getElementById('share-link-box').classList.remove('hidden');
      window.location.hash = hash;

      updateLiveFeed();
      return;
    }

    // Fresh setup — show preset picker
    renderMatchupPicker();
    document.getElementById('share-link-box').classList.add('hidden');
  }

  function renderMatchupPicker() {
    const container = document.getElementById('matchup-setups');
    container.innerHTML = '';

    const week = parseInt(document.getElementById('comm-week').value) || 1;

    // Only show presets for Week 1
    if (week === 1) {
      const pickerHeader = document.createElement('div');
      pickerHeader.innerHTML = `
        <div class="matchup-label regular" style="margin-bottom:4px">Pick 3 matchups (tap to select)</div>
        <p style="font-size:0.75rem;color:var(--text-dim);text-align:center;margin-bottom:12px">
          The 3rd pick becomes the Super Matchup (3x pts). Sorted by tightest spread.
        </p>`;
      container.appendChild(pickerHeader);

      PRESETS.forEach((p, i) => {
        const card = document.createElement('div');
        card.className = 'preset-card';
        card.id = `preset-${i}`;
        card.onclick = () => togglePreset(i);
        const primeBadge = p.prime
          ? `<span class="prime-badge prime-${p.prime.toLowerCase()}">${p.prime}</span>`
          : '';
        card.innerHTML = `
          <div class="preset-teams">${primeBadge}${p.a} <span class="vs-text">vs</span> ${p.b}</div>
          <div class="preset-meta">
            <span class="preset-spread">Spread: ${p.spread}</span>
            <span class="preset-tag">${p.tag}</span>
          </div>
          <div class="preset-slot" id="preset-slot-${i}"></div>`;
        container.appendChild(card);
      });

      const divider = document.createElement('div');
      divider.className = 'divider-text';
      divider.style.marginTop = '16px';
      divider.textContent = 'or type custom matchups';
      container.appendChild(divider);
    } else {
      const header = document.createElement('div');
      header.innerHTML = `
        <div class="matchup-label regular" style="margin-bottom:4px">Week ${week} — Set Up Matchups</div>
        <p style="font-size:0.75rem;color:var(--text-dim);text-align:center;margin-bottom:12px">
          Enter 2 regular matchups (1 pt each) + 1 Super Matchup (3x pts).
        </p>`;
      container.appendChild(header);
    }

    const manual = document.createElement('div');
    manual.innerHTML = `
      <div class="setup-group">
        <div class="matchup-label regular">Matchup 1 (1 pt)</div>
        <div class="setup-row">
          <input type="text" id="team-0-a" placeholder="Team A">
          <span class="vs-text">VS</span>
          <input type="text" id="team-0-b" placeholder="Team B">
        </div>
      </div>
      <div class="setup-group">
        <div class="matchup-label regular">Matchup 2 (1 pt)</div>
        <div class="setup-row">
          <input type="text" id="team-1-a" placeholder="Team A">
          <span class="vs-text">VS</span>
          <input type="text" id="team-1-b" placeholder="Team B">
        </div>
      </div>
      <div class="setup-group super-setup">
        <div class="matchup-label super-label">Super Matchup<span class="super-badge">3x PTS</span></div>
        <div class="setup-row">
          <input type="text" id="team-2-a" placeholder="Team A">
          <span class="vs-text">VS</span>
          <input type="text" id="team-2-b" placeholder="Team B">
        </div>
      </div>`;
    container.appendChild(manual);
  }

  function editWeekSetup() {
    // Unlock the current week for re-editing
    const week = parseInt(document.getElementById('comm-week').value) || 1;
    delete state.weeks[week];
    save();
    document.getElementById('share-link-box').classList.add('hidden');
    renderMatchupPicker();
  }

  let _commWeekOverride = null;

  function nextWeek() {
    // Advance to the next week number and show fresh setup
    const weekEl = document.getElementById('comm-week');
    const current = parseInt(weekEl.value) || 1;
    const nextW = current + 1;
    weekEl.value = nextW;
    // Clear stale hash so it doesn't pull back to old week
    window.location.hash = '';
    // Set override so Firebase listener doesn't reset the week
    _commWeekOverride = nextW;
    initCommissioner();
    // Clear override after a short delay (lets Firebase settle)
    setTimeout(() => { _commWeekOverride = null; }, 2000);
  }

  function resetWeekSetup() {
    editWeekSetup();
  }

  function onCommWeekChange() {
    initCommissioner();
  }

  function togglePreset(idx) {
    const pos = selectedPresets.indexOf(idx);
    if (pos > -1) {
      selectedPresets.splice(pos, 1);
    } else if (selectedPresets.length < 3) {
      selectedPresets.push(idx);
    }
    PRESETS.forEach((_, i) => {
      const card = document.getElementById(`preset-${i}`);
      const slot = document.getElementById(`preset-slot-${i}`);
      const selPos = selectedPresets.indexOf(i);
      card.classList.remove('preset-selected', 'preset-super-selected');
      slot.textContent = '';
      if (selPos > -1) {
        const isSuper = selPos === 2;
        card.classList.add(isSuper ? 'preset-super-selected' : 'preset-selected');
        slot.textContent = isSuper ? 'SUPER MATCHUP (3x)' : `Matchup ${selPos + 1}`;
        slot.style.color = isSuper ? 'var(--super)' : 'var(--accent)';
      }
    });
    for (let si = 0; si < 3; si++) {
      const aEl = document.getElementById(`team-${si}-a`);
      const bEl = document.getElementById(`team-${si}-b`);
      if (aEl && bEl) {
        if (si < selectedPresets.length) {
          const p = PRESETS[selectedPresets[si]];
          aEl.value = p.a;
          bEl.value = p.b;
        } else {
          aEl.value = '';
          bEl.value = '';
        }
      }
    }
  }

  function generateLink() {
    const week = parseInt(document.getElementById('comm-week').value) || 1;
    let matchups = [];

    if (selectedPresets.length === 3) {
      matchups = selectedPresets.map((pi, si) => ({
        a: PRESETS[pi].a,
        b: PRESETS[pi].b,
        isSuper: si === 2
      }));
    } else {
      for (let i = 0; i < 3; i++) {
        const a = (document.getElementById(`team-${i}-a`) || {}).value || '';
        const b = (document.getElementById(`team-${i}-b`) || {}).value || '';
        if (!a.trim() || !b.trim()) {
          alert('Either tap 3 preset matchups OR fill in all custom fields');
          return;
        }
        matchups.push({ a: a.trim(), b: b.trim(), isSuper: i === 2 });
      }
    }

    const data = { week, matchups };
    state.weeks[week] = data;
    save();

    const hash = encodeHash(data);
    const url = window.location.origin + window.location.pathname + '#' + hash;
    document.getElementById('share-link').value = url;
    document.getElementById('share-link-box').classList.remove('hidden');
    window.location.hash = hash;
  }

  function copyLink() {
    const input = document.getElementById('share-link');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = input.nextElementSibling;
      btn.textContent = 'Copied';
      setTimeout(() => btn.textContent = 'Copy Link', 1500);
    });
  }

  function commishMakePicks() {
    showScreen('screen-landing');
  }

  // --- Player Voting ---
  function enterPlayer() {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { alert('Enter your name'); return; }
    currentPlayer = name;
    localStorage.setItem('marjitos_player_name', name);

    // Get week data: URL hash first (direct link), otherwise latest week from Firebase/state
    const urlData = parseURL();
    let weekData;
    if (urlData && urlData.matchups) {
      weekData = urlData;
    } else {
      const weekKeys = Object.keys(state.weeks).sort((a, b) => b - a);
      if (weekKeys.length === 0) { alert('No matchups set up yet. Check back soon.'); return; }
      weekData = state.weeks[weekKeys[0]];
    }

    // Check Firebase directly for existing picks (most reliable)
    const week = weekData.week;
    db.ref(`state/players/${name}/${week}`).once('value').then(snapshot => {
      const existing = snapshot.val();
      if (existing && existing.picks && Object.keys(existing.picks).length > 0) {
        // Already picked — show their locked confirmation
        currentPicks = { ...existing.picks };
        tiebreakerScore = existing.tiebreaker || '';
        renderConfirmation(weekData);
      } else {
        // Also check local state as fallback
        const localExisting = state.players[name] && state.players[name][week];
        if (localExisting && localExisting.picks && Object.keys(localExisting.picks).length > 0) {
          currentPicks = { ...localExisting.picks };
          tiebreakerScore = localExisting.tiebreaker || '';
          renderConfirmation(weekData);
        } else {
          if (!state.players[name]) state.players[name] = {};
          loadVotingScreen(weekData);
        }
      }
    }).catch(() => {
      // Firebase offline — use local state
      const localExisting = state.players[name] && state.players[name][week];
      if (localExisting && localExisting.picks && Object.keys(localExisting.picks).length > 0) {
        currentPicks = { ...localExisting.picks };
        tiebreakerScore = localExisting.tiebreaker || '';
        renderConfirmation(weekData);
      } else {
        if (!state.players[name]) state.players[name] = {};
        loadVotingScreen(weekData);
      }
    });
  }

  function loadVotingScreen(data) {
    currentPicks = {};
    const weekNum = data.week;
    document.getElementById('week-label').textContent = `WEEK ${weekNum}`;
    document.getElementById('player-badge').textContent = currentPlayer;

    const container = document.getElementById('matchup-cards');
    container.innerHTML = '';

    data.matchups.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'matchup-card' + (m.isSuper ? ' super' : '');
      const labelClass = m.isSuper ? 'super-label' : 'regular';
      const labelText = m.isSuper
        ? 'Super Matchup<span class="super-badge">3x PTS</span>'
        : `Matchup ${i + 1} (1 pt)`;

      card.innerHTML = `
        <div class="matchup-label ${labelClass}">${labelText}</div>
        <div class="matchup-vs">
          <button class="team-btn" data-matchup="${i}" data-team="a" onclick="App.pickTeam(${i},'a',${m.isSuper})">${m.a}</button>
          <span class="vs-text">VS</span>
          <button class="team-btn" data-matchup="${i}" data-team="b" onclick="App.pickTeam(${i},'b',${m.isSuper})">${m.b}</button>
        </div>
        ${m.isSuper ? `
        <div class="tiebreaker">
          <label>Tiebreaker: Total combined score</label><br>
          <input type="number" id="tiebreaker" placeholder="e.g. 47" min="0" max="200" onchange="App.setTiebreaker(this.value)">
        </div>` : ''}`;
      container.appendChild(card);
    });

    showScreen('screen-vote');
  }

  function pickTeam(matchupIdx, team, isSuper) {
    const btns = document.querySelectorAll(`[data-matchup="${matchupIdx}"]`);
    btns.forEach(b => b.classList.remove('selected', 'selected-super'));
    const selectedBtn = document.querySelector(`[data-matchup="${matchupIdx}"][data-team="${team}"]`);
    selectedBtn.classList.add(isSuper ? 'selected-super' : 'selected');
    currentPicks[matchupIdx] = team;
    checkAllPicked();
  }

  function setTiebreaker(val) { tiebreakerScore = val; }

  function checkAllPicked() {
    const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
    const needed = data.matchups.length;
    document.getElementById('submit-picks-btn').disabled = Object.keys(currentPicks).length < needed;
  }

  function submitPicks() {
    const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
    const week = data.week;

    if (!state.players[currentPlayer]) state.players[currentPlayer] = {};
    state.players[currentPlayer][week] = {
      picks: { ...currentPicks },
      tiebreaker: tiebreakerScore
    };
    save();

    renderConfirmation(data);
  }

  function renderConfirmation(data) {
    document.getElementById('confirm-player').textContent = currentPlayer;
    document.getElementById('confirm-week').textContent = `Week ${data.week}`;
    const container = document.getElementById('confirm-picks');
    container.innerHTML = '';

    data.matchups.forEach((m, i) => {
      const picked = currentPicks[i];
      const teamName = picked === 'a' ? m.a : m.b;
      const div = document.createElement('div');
      div.className = 'confirm-pick' + (m.isSuper ? ' super-pick' : '');
      div.textContent = `${m.isSuper ? 'SUPER: ' : ''}${teamName}`;
      container.appendChild(div);
    });

    if (tiebreakerScore) {
      const tb = document.createElement('div');
      tb.className = 'confirm-pick';
      tb.textContent = `Tiebreaker: ${tiebreakerScore} pts`;
      container.appendChild(tb);
    }

    renderPickCounter(data);
    showScreen('screen-confirm');
  }

  function renderPickCounter(data) {
    const week = data.week;
    const allPlayers = Object.keys(state.players);
    const pickedPlayers = allPlayers.filter(p => {
      const pw = state.players[p] && state.players[p][week];
      return pw && pw.picks && Object.keys(pw.picks).length > 0;
    });

    let counterHtml = `<div class="pick-counter">`;
    counterHtml += `<div class="pick-counter-header">${pickedPlayers.length} of ${allPlayers.length} picks locked</div>`;

    data.matchups.forEach((m, i) => {
      let aCount = 0, bCount = 0;
      pickedPlayers.forEach(p => {
        const pick = (state.players[p][week].picks || {})[i];
        if (pick === 'a') aCount++;
        else if (pick === 'b') bCount++;
      });
      const total = aCount + bCount;
      const aPct = total ? Math.round((aCount / total) * 100) : 0;
      const bPct = total ? Math.round((bCount / total) * 100) : 0;

      counterHtml += `<div class="pick-breakdown${m.isSuper ? ' breakdown-super' : ''}">`;
      counterHtml += `<div class="breakdown-bar">`;
      counterHtml += `<div class="bar-a" style="width:${aPct}%"></div>`;
      counterHtml += `<div class="bar-b" style="width:${bPct}%"></div>`;
      counterHtml += `</div>`;
      counterHtml += `<div class="breakdown-labels">`;
      counterHtml += `<span class="bl-team">${m.a} <strong>${aPct}%</strong></span>`;
      counterHtml += `<span class="bl-vs">${m.isSuper ? 'SUPER' : 'vs'}</span>`;
      counterHtml += `<span class="bl-team"><strong>${bPct}%</strong> ${m.b}</span>`;
      counterHtml += `</div></div>`;
    });

    counterHtml += `</div>`;

    let counterEl = document.getElementById('pick-counter-wrap');
    if (!counterEl) {
      counterEl = document.createElement('div');
      counterEl.id = 'pick-counter-wrap';
      document.getElementById('pick-card').after(counterEl);
    }
    counterEl.innerHTML = counterHtml;
  }

  // --- Results Entry ---
  function loadResultsWeek() {
    const week = parseInt(document.getElementById('results-week').value) || 1;
    const data = state.weeks[week];
    const mContainer = document.getElementById('results-matchups');
    const pContainer = document.getElementById('player-pick-entry');
    mContainer.innerHTML = '';
    pContainer.innerHTML = '';

    if (!data) { mContainer.innerHTML = '<p style="color:var(--text-dim)">No matchups for this week</p>'; return; }

    data.matchups.forEach((m, i) => {
      const existing = (state.results[week] || {})[i];
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <span>${m.isSuper ? 'SUPER: ' : ''}${m.a} vs ${m.b}</span>
        <select id="result-${i}">
          <option value="">Winner?</option>
          <option value="a" ${existing === 'a' ? 'selected' : ''}>${m.a}</option>
          <option value="b" ${existing === 'b' ? 'selected' : ''}>${m.b}</option>
        </select>`;
      mContainer.appendChild(row);
    });

    const players = Object.keys(state.players);
    if (players.length === 0) {
      pContainer.innerHTML = '<p style="color:var(--text-dim)">No players yet</p>';
      return;
    }
    pContainer.innerHTML = `
      <div style="margin-bottom:8px">
        <label>Add Player</label>
        <div class="setup-row">
          <input type="text" id="new-player-name" placeholder="Name">
          <button class="btn secondary" style="width:auto;padding:8px 16px" onclick="App.addPlayerForWeek()">Add</button>
        </div>
      </div>`;

    players.forEach(p => {
      const pData = (state.players[p] && state.players[p][week]) || {};
      const div = document.createElement('div');
      div.style.cssText = 'margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03)';
      let picksHtml = `<strong>${p}</strong><br>`;
      data.matchups.forEach((m, i) => {
        const pick = (pData.picks || {})[i];
        const label = m.isSuper ? 'Super' : `M${i + 1}`;
        picksHtml += `
          <select id="ppick-${p}-${i}" style="margin:2px;padding:4px;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);color:var(--text);border-radius:6px;font-size:0.8rem">
            <option value="">${label}?</option>
            <option value="a" ${pick === 'a' ? 'selected' : ''}>${m.a}</option>
            <option value="b" ${pick === 'b' ? 'selected' : ''}>${m.b}</option>
          </select>`;
      });
      div.innerHTML = picksHtml;
      pContainer.appendChild(div);
    });
  }

  function addPlayerForWeek() {
    const name = document.getElementById('new-player-name').value.trim();
    if (!name) return;
    if (!state.players[name]) state.players[name] = {};
    save();
    document.getElementById('new-player-name').value = '';
    loadResultsWeek();
  }

  function saveResults() {
    const week = parseInt(document.getElementById('results-week').value) || 1;
    const data = state.weeks[week];
    if (!data) return;

    if (!state.results[week]) state.results[week] = {};
    data.matchups.forEach((m, i) => {
      const val = document.getElementById(`result-${i}`).value;
      if (val) state.results[week][i] = val;
    });

    Object.keys(state.players).forEach(p => {
      data.matchups.forEach((m, i) => {
        const el = document.getElementById(`ppick-${p}-${i}`);
        if (el && el.value) {
          if (!state.players[p][week]) state.players[p][week] = { picks: {} };
          state.players[p][week].picks[i] = el.value;
        }
      });
    });

    save();
    alert('Results saved');
  }

  // --- Leaderboard ---
  function renderLeaderboard() {
    const scores = {};
    Object.keys(state.players).forEach(p => { scores[p] = 0; });

    Object.keys(state.results).forEach(week => {
      const weekResults = state.results[week];
      const weekData = state.weeks[week];
      if (!weekData) return;

      Object.keys(state.players).forEach(p => {
        const pWeek = state.players[p] && state.players[p][week];
        if (!pWeek || !pWeek.picks) return;

        weekData.matchups.forEach((m, i) => {
          const winner = weekResults[i];
          const pick = pWeek.picks[i];
          if (winner && pick === winner) {
            scores[p] += m.isSuper ? 3 : 1;
          }
        });
      });
    });

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const container = document.getElementById('leaderboard-table');

    if (sorted.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);text-align:center">No players yet</p>';
      return;
    }

    let html = '<table class="lb-table"><thead><tr><th></th><th>Player</th><th>Pts</th></tr></thead><tbody>';
    sorted.forEach(([name, pts], i) => {
      const medal = i === 0 ? '&#127942;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : '';
      html += `<tr><td class="lb-rank">${medal || i + 1}</td><td>${name}</td><td>${pts}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // --- Scoring helper ---
  function calcScores() {
    const players = Object.keys(state.players);
    const totals = {};
    const byWeek = {};
    players.forEach(p => { totals[p] = 0; });

    const weeks = Object.keys(state.weeks).sort((a, b) => a - b);
    weeks.forEach(week => {
      const weekResults = state.results[week] || {};
      const weekData = state.weeks[week];
      if (!weekData) return;
      byWeek[week] = {};
      players.forEach(p => {
        let pts = 0;
        const pWeek = state.players[p] && state.players[p][week];
        if (pWeek && pWeek.picks) {
          weekData.matchups.forEach((m, i) => {
            const winner = weekResults[i];
            const pick = pWeek.picks[i];
            if (winner && pick === winner) pts += m.isSuper ? 3 : 1;
          });
        }
        byWeek[week][p] = pts;
        totals[p] += pts;
      });
    });
    return { totals, byWeek, weeks, players };
  }

  // --- Commissioner Dashboard ---
  function renderDashboard() {
    const { totals, byWeek, weeks, players } = calcScores();
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    const standingsEl = document.getElementById('dash-standings');
    if (sorted.length === 0) {
      standingsEl.innerHTML = '<p style="color:var(--text-dim)">No players yet</p>';
    } else {
      let h = '<div class="dash-table-wrap"><table class="lb-table dash-wide">';
      h += '<thead><tr><th></th><th>Player</th>';
      weeks.forEach(w => { h += `<th>W${w}</th>`; });
      h += '<th>Total</th></tr></thead><tbody>';
      sorted.forEach(([name, total], i) => {
        const medal = i === 0 ? '&#127942;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : '';
        h += `<tr><td class="lb-rank">${medal || i + 1}</td><td>${name}</td>`;
        weeks.forEach(w => {
          const wp = (byWeek[w] || {})[name] || 0;
          const cls = wp > 0 ? ' class="pointed"' : '';
          h += `<td${cls}>${wp}</td>`;
        });
        h += `<td><strong>${total}</strong></td></tr>`;
      });
      h += '</tbody></table></div>';
      standingsEl.innerHTML = h;
    }

    const historyEl = document.getElementById('dash-history');
    if (weeks.length === 0) {
      historyEl.innerHTML = '<p style="color:var(--text-dim)">No weeks recorded yet</p>';
      return;
    }

    let hHtml = '';
    weeks.forEach(week => {
      const wd = state.weeks[week];
      const wr = state.results[week] || {};
      const hasResults = Object.keys(wr).length > 0;

      hHtml += `<div class="history-week">`;
      hHtml += `<div class="history-week-header">`;
      hHtml += `<span class="history-week-num">Week ${week}</span>`;
      hHtml += hasResults
        ? '<span class="badge-done">Results In</span>'
        : '<span class="badge-pending">Pending</span>';
      hHtml += `<button class="btn ghost" style="padding:4px 8px;font-size:0.75rem;width:auto;margin:0" onclick="document.getElementById('results-week').value=${week};App.showScreen('screen-results')">Edit</button>`;
      hHtml += `</div>`;

      wd.matchups.forEach((m, i) => {
        const winner = wr[i];
        const winName = winner === 'a' ? m.a : winner === 'b' ? m.b : null;
        hHtml += `<div class="history-matchup${m.isSuper ? ' history-super' : ''}">`;
        hHtml += `<span class="history-teams">`;
        hHtml += winner === 'a' ? `<strong>${m.a}</strong>` : m.a;
        hHtml += ' vs ';
        hHtml += winner === 'b' ? `<strong>${m.b}</strong>` : m.b;
        hHtml += `</span>`;
        if (m.isSuper) hHtml += '<span class="super-badge" style="margin-left:6px">SUPER</span>';
        if (winName) hHtml += `<span class="history-winner">${winName}</span>`;
        else hHtml += '<span class="history-tbd">TBD</span>';
        hHtml += `</div>`;
      });

      hHtml += '<div class="history-picks">';
      players.forEach(p => {
        const pWeek = state.players[p] && state.players[p][week];
        if (!pWeek || !pWeek.picks) return;
        const pickNames = wd.matchups.map((m, i) => {
          const pick = pWeek.picks[i];
          const name = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
          const correct = wr[i] && pick === wr[i];
          const wrong = wr[i] && pick !== wr[i];
          if (correct) return `<span class="pick-correct">${name}</span>`;
          if (wrong) return `<span class="pick-wrong">${name}</span>`;
          return `<span class="pick-pending">${name}</span>`;
        }).join(', ');
        const wPts = (byWeek[week] || {})[p] || 0;
        hHtml += `<div class="history-player-row"><span>${p}</span><span class="history-player-picks">${pickNames}</span><span class="history-player-pts">${wPts} pts</span></div>`;
      });
      hHtml += '</div></div>';
    });
    historyEl.innerHTML = hHtml;
  }

  // --- Live Picks Feed (commissioner screen) ---
  function updateLiveFeed() {
    const weekEl = document.getElementById('comm-week');
    const week = weekEl ? (parseInt(weekEl.value) || 1) : 1;
    const weekData = state.weeks[week];
    const feedEl = document.getElementById('live-picks-feed');
    const listEl = document.getElementById('live-picks-list');
    if (!feedEl || !listEl) return;

    const players = Object.keys(state.players);
    const pickedPlayers = players.filter(p => {
      const pw = state.players[p] && state.players[p][week];
      return pw && pw.picks && Object.keys(pw.picks).length > 0;
    });

    if (pickedPlayers.length === 0) {
      feedEl.classList.add('hidden');
      return;
    }

    feedEl.classList.remove('hidden');
    let html = `<div class="pick-counter-header" style="margin-bottom:8px">${pickedPlayers.length} pick${pickedPlayers.length !== 1 ? 's' : ''} locked</div>`;

    pickedPlayers.forEach(p => {
      const pw = state.players[p][week];
      let pickSummary = '';
      if (weekData && weekData.matchups) {
        pickSummary = weekData.matchups.map((m, i) => {
          const pick = (pw.picks || {})[i];
          return pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
        }).join(', ');
      } else {
        pickSummary = Object.values(pw.picks || {}).join(', ');
      }
      html += `<div class="live-pick-row"><span class="live-pick-name">${p}</span><span class="live-pick-teams">${pickSummary}</span></div>`;
    });

    listEl.innerHTML = html;
  }

  // --- All Picks Screen ---
  function showAllPicks() {
    const weekVal = document.getElementById('comm-week').value;
    document.getElementById('all-picks-week').value = weekVal || 1;
    showScreen('screen-all-picks');
  }

  function renderAllPicks() {
    const week = parseInt(document.getElementById('all-picks-week').value) || 1;
    const container = document.getElementById('all-picks-container');
    const weekData = state.weeks[week];

    if (!weekData) {
      container.innerHTML = '<p style="color:var(--text-dim)">No matchups set for this week</p>';
      return;
    }

    const players = Object.keys(state.players);
    const pickedPlayers = players.filter(p => {
      const pw = state.players[p] && state.players[p][week];
      return pw && pw.picks && Object.keys(pw.picks).length > 0;
    });
    const pendingPlayers = players.filter(p => !pickedPlayers.includes(p));

    let html = '';

    // Matchup header
    html += '<div style="margin:12px 0 8px;font-size:0.8rem;color:var(--text-dim)">';
    weekData.matchups.forEach((m, i) => {
      html += `<div style="margin-bottom:4px">${m.isSuper ? '<span class="super-badge">SUPER</span> ' : `M${i+1}: `}${m.a} vs ${m.b}</div>`;
    });
    html += '</div>';

    // Picked players
    if (pickedPlayers.length > 0) {
      html += `<div class="divider-text">${pickedPlayers.length} locked in</div>`;
      pickedPlayers.forEach(p => {
        const pw = state.players[p][week];
        html += '<div class="all-pick-card">';
        html += `<div style="display:flex;justify-content:space-between;align-items:center">`;
        html += `<div class="all-pick-name">${p}</div>`;
        html += `<button class="btn ghost" style="width:auto;padding:2px 8px;font-size:0.7rem;margin:0;color:var(--danger)" onclick="App.resetPlayerPicks('${p.replace(/'/g, "\\'")}',${week})">Reset</button>`;
        html += `</div>`;
        html += '<div class="all-pick-choices">';
        weekData.matchups.forEach((m, i) => {
          const pick = (pw.picks || {})[i];
          const teamName = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
          html += `<span class="all-pick-chip${m.isSuper ? ' chip-super' : ''}">${teamName}</span>`;
        });
        html += '</div>';
        if (pw.tiebreaker) {
          html += `<div class="all-pick-tb">Tiebreaker: ${pw.tiebreaker}</div>`;
        }
        html += '</div>';
      });
    }

    // Pending players
    if (pendingPlayers.length > 0) {
      html += `<div class="divider-text">${pendingPlayers.length} waiting</div>`;
      pendingPlayers.forEach(p => {
        html += `<div class="all-pick-card pending"><div class="all-pick-name">${p}</div><div class="all-pick-choices"><span style="color:var(--text-dim);font-size:0.8rem">No picks yet</span></div></div>`;
      });
    }

    if (players.length === 0) {
      html = '<p style="color:var(--text-dim);text-align:center">No players have entered yet</p>';
    }

    container.innerHTML = html;
  }

  function resetPlayerPicks(playerName, week) {
    if (!confirm(`Reset ${playerName}'s picks for Week ${week}? They'll be able to vote again.`)) return;
    if (state.players[playerName] && state.players[playerName][week]) {
      delete state.players[playerName][week];
      save();
      renderAllPicks();
    }
  }

  // --- Player Stats ---
  function renderMyStats() {
    const name = currentPlayer;
    if (!name) { showScreen('screen-landing'); return; }

    document.getElementById('my-stats-name').textContent = `${name}'s Record`;
    const container = document.getElementById('my-stats-content');
    const playerData = state.players[name];
    if (!playerData) { container.innerHTML = '<p style="color:var(--text-dim)">No picks recorded yet</p>'; return; }

    const { totals, byWeek, weeks, players } = calcScores();
    const myTotal = totals[name] || 0;
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const rank = sorted.findIndex(([n]) => n === name) + 1;

    let correct = 0, total = 0;
    weeks.forEach(week => {
      const wd = state.weeks[week];
      const wr = state.results[week] || {};
      const pw = playerData[week];
      if (!wd || !pw || !pw.picks) return;
      wd.matchups.forEach((m, i) => {
        if (wr[i]) {
          total++;
          if (pw.picks[i] === wr[i]) correct++;
        }
      });
    });
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    let html = '';
    // Summary card
    html += `<div style="display:flex;gap:12px;margin-bottom:16px">`;
    html += `<div class="stat-box"><div class="stat-num">${myTotal}</div><div class="stat-label">Points</div></div>`;
    html += `<div class="stat-box"><div class="stat-num">#${rank || '—'}</div><div class="stat-label">Rank</div></div>`;
    html += `<div class="stat-box"><div class="stat-num">${pct}%</div><div class="stat-label">Accuracy</div></div>`;
    html += `</div>`;

    // Week-by-week breakdown
    html += '<div class="divider-text">week by week</div>';
    weeks.forEach(week => {
      const wd = state.weeks[week];
      const wr = state.results[week] || {};
      const pw = playerData[week];
      if (!wd || !pw || !pw.picks) return;

      const wPts = (byWeek[week] || {})[name] || 0;
      html += `<div style="margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03)">`;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-size:0.85rem">Week ${week}</span><span class="pointed">${wPts} pts</span></div>`;

      wd.matchups.forEach((m, i) => {
        const pick = pw.picks[i];
        const pickName = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
        const winner = wr[i];
        let cls = 'pick-pending';
        let icon = '⏳';
        if (winner) {
          if (pick === winner) { cls = 'pick-correct'; icon = '✓'; }
          else { cls = 'pick-wrong'; icon = '✗'; }
        }
        html += `<div style="font-size:0.8rem;padding:2px 0"><span class="${cls}">${icon} ${pickName}</span>`;
        html += `<span style="color:var(--text-dim)"> — ${m.a} vs ${m.b}${m.isSuper ? ' ⭐' : ''}</span></div>`;
      });
      html += `</div>`;
    });

    // vs the field
    if (sorted.length > 1) {
      html += '<div class="divider-text">vs the field</div>';
      sorted.slice(0, 5).forEach(([n, pts], i) => {
        const isMe = n === name;
        html += `<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:0.85rem;${isMe ? 'font-weight:700;color:var(--accent)' : ''}">`;
        html += `<span>${i + 1}. ${n}${isMe ? ' (you)' : ''}</span><span>${pts} pts</span></div>`;
      });
    }

    container.innerHTML = html;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'marjitos-madness-data.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadMyPicks() {
    const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
    if (!data) return;
    const week = data.week;
    const pickData = {
      _type: 'marjito-madness-pick',
      player: currentPlayer,
      week: week,
      picks: { ...currentPicks },
      tiebreaker: tiebreakerScore,
      matchups: data.matchups.map((m, i) => ({
        a: m.a, b: m.b, isSuper: m.isSuper,
        picked: currentPicks[i] === 'a' ? m.a : m.b
      }))
    };
    const blob = new Blob([JSON.stringify(pickData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `madness-${currentPlayer.toLowerCase().replace(/\s+/g, '-')}-wk${week}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    document.getElementById('import-file').click();
  }

  function handleImport(files) {
    const statusEl = document.getElementById('import-status');
    statusEl.classList.remove('hidden');
    let imported = 0;
    let errors = 0;
    const total = files.length;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const d = JSON.parse(e.target.result);
          if ((d._type === 'marjito-madness-pick' || d._type === 'gridiron-pick') && d.player && d.week && d.picks) {
            if (!state.players[d.player]) state.players[d.player] = {};
            state.players[d.player][d.week] = {
              picks: d.picks,
              tiebreaker: d.tiebreaker || ''
            };
            imported++;
          } else {
            errors++;
          }
        } catch { errors++; }

        if (imported + errors === total) {
          save();
          statusEl.innerHTML = `<p class="import-msg">Imported ${imported} pick file${imported !== 1 ? 's' : ''}${errors ? `, ${errors} failed` : ''}</p>`;
          renderDashboard();
        }
      };
      reader.readAsText(file);
    });
  }

  function importFullData() {
    document.getElementById('import-full-file').click();
  }

  function handleFullImport(files) {
    if (!files.length) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (d.players && d.weeks) {
          Object.keys(d.players || {}).forEach(p => {
            if (!state.players[p]) state.players[p] = {};
            Object.keys(d.players[p]).forEach(w => {
              state.players[p][w] = d.players[p][w];
            });
          });
          Object.keys(d.weeks || {}).forEach(w => {
            state.weeks[w] = d.weeks[w];
          });
          Object.keys(d.results || {}).forEach(w => {
            state.results[w] = d.results[w];
          });
          save();
          const statusEl = document.getElementById('import-status');
          statusEl.classList.remove('hidden');
          statusEl.innerHTML = '<p class="import-msg">Full backup imported and merged</p>';
          renderDashboard();
        } else {
          alert('Invalid backup file');
        }
      } catch { alert('Could not parse file'); }
    };
    reader.readAsText(files[0]);
  }

  init();

  return {
    showScreen, enterPlayer, generateLink, copyLink, commishMakePicks,
    pickTeam, setTiebreaker, submitPicks,
    loadResultsWeek, addPlayerForWeek, saveResults,
    togglePreset, exportData, downloadMyPicks,
    triggerImport, handleImport, importFullData, handleFullImport,
    showAllPicks, renderAllPicks, resetWeekSetup, onCommWeekChange,
    editWeekSetup, nextWeek, resetPlayerPicks
  };
})();
