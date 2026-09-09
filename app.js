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
  const ADMIN_NAME = 'Marjito';

  let selectedPresets = [];
  let firebaseReady = false;

  // HTML-escape player names to prevent XSS (no DOM allocation)
  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

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

  // Team primary colors + emoji for visual identity
  const TEAM_META = {
    Cardinals: { color: '#97233F', emoji: '🐦' },
    Falcons: { color: '#A71930', emoji: '🦅' },
    Ravens: { color: '#241773', emoji: '🐦‍⬛' },
    Bills: { color: '#00338D', emoji: '🦬' },
    Panthers: { color: '#0085CA', emoji: '🐆' },
    Bears: { color: '#0B162A', emoji: '🐻' },
    Bengals: { color: '#FB4F14', emoji: '🐯' },
    Browns: { color: '#311D00', emoji: '🐶' },
    Cowboys: { color: '#003594', emoji: '⭐' },
    Broncos: { color: '#FB4F14', emoji: '🐴' },
    Lions: { color: '#0076B6', emoji: '🦁' },
    Packers: { color: '#203731', emoji: '🧀' },
    Texans: { color: '#03202F', emoji: '🐂' },
    Colts: { color: '#002C5F', emoji: '🐎' },
    Jaguars: { color: '#006778', emoji: '🐆' },
    Chiefs: { color: '#E31837', emoji: '🏹' },
    Raiders: { color: '#000000', emoji: '☠️' },
    Chargers: { color: '#0080C6', emoji: '⚡' },
    Rams: { color: '#003594', emoji: '🐏' },
    Dolphins: { color: '#008E97', emoji: '🐬' },
    Vikings: { color: '#4F2683', emoji: '⚔️' },
    Patriots: { color: '#002244', emoji: '🇺🇸' },
    Saints: { color: '#D3BC8D', emoji: '⚜️' },
    Giants: { color: '#0B2265', emoji: '🗽' },
    Jets: { color: '#125740', emoji: '✈️' },
    Eagles: { color: '#004C54', emoji: '🦅' },
    Steelers: { color: '#FFB612', emoji: '⚙️' },
    '49ers': { color: '#AA0000', emoji: '⛏️' },
    Seahawks: { color: '#002244', emoji: '🦅' },
    Buccaneers: { color: '#D50A0A', emoji: '🏴‍☠️' },
    Titans: { color: '#0C2340', emoji: '⚔️' },
    Commanders: { color: '#5A1414', emoji: '🎖️' },
  };

  function teamBadge(name) {
    const meta = TEAM_META[name];
    if (!meta) return name;
    return `<span class="team-badge" style="background:${meta.color}">${meta.emoji}</span> ${name}`;
  }

  // NFL 2026 Primetime Games Only — TNF (1pt), SNF (1pt), MNF (Super 3x)
  // Week 1 TNF: Thursday Sept 10, 2026
  const WEEK1_THURSDAY = new Date('2026-09-10T17:00:00-07:00'); // 5pm PT kickoff

  function getCurrentNFLWeek() {
    const now = new Date();
    if (now < WEEK1_THURSDAY) return 1; // Pre-season — Week 1 open for picks
    // Each week is 7 days; after Thursday kickoff you're in that week (locked), next week opens Tuesday
    const msPerDay = 86400000;
    const daysSinceW1 = Math.floor((now - WEEK1_THURSDAY) / msPerDay);
    const currentWeek = Math.floor(daysSinceW1 / 7) + 1;
    // After Thursday kickoff, that week is locked; picks open for next week starting Tuesday
    const dayOfWeek = daysSinceW1 % 7; // 0=Thu, 1=Fri, 2=Sat, 3=Sun, 4=Mon, 5=Tue, 6=Wed
    if (dayOfWeek >= 5) {
      // Tuesday or later — next week is open for picks
      return Math.min(currentWeek + 1, 17);
    }
    // Thu-Mon: current week is in progress / locked
    return Math.min(currentWeek, 17);
  }

  function getWeekStatus(week) {
    const nflWeek = getCurrentNFLWeek();
    if (week < nflWeek) return 'past';    // Already played — locked
    if (week === nflWeek) return 'active'; // Current — open for picks
    return 'future';                       // Not yet — grayed out
  }

  function getWeekDeadline(week) {
    // Thursday kickoff for this week (5pm PT)
    const deadline = new Date(WEEK1_THURSDAY.getTime() + (week - 1) * 7 * 86400000);
    return deadline;
  }

  const SCHEDULE = {
    1:  { tnf: { a: '49ers', b: 'Rams' }, snf: { a: 'Cowboys', b: 'Giants' }, mnf: { a: 'Broncos', b: 'Chiefs' } },
    2:  { tnf: { a: 'Lions', b: 'Bills' }, snf: { a: 'Colts', b: 'Chiefs' }, mnf: { a: 'Giants', b: 'Rams' } },
    3:  { tnf: { a: 'Falcons', b: 'Packers' }, snf: { a: 'Rams', b: 'Broncos' }, mnf: { a: 'Eagles', b: 'Bears' } },
    4:  { tnf: { a: 'Steelers', b: 'Browns' }, snf: { a: 'Lions', b: 'Panthers' }, mnf: { a: 'Falcons', b: 'Saints' } },
    5:  { tnf: { a: 'Buccaneers', b: 'Cowboys' }, snf: { a: 'Ravens', b: 'Falcons' }, mnf: { a: 'Bills', b: 'Rams' } },
    6:  { tnf: { a: 'Seahawks', b: 'Broncos' }, snf: { a: 'Cowboys', b: 'Packers' }, mnf: { a: 'Commanders', b: '49ers' } },
    7:  { tnf: { a: 'Patriots', b: 'Bears' }, snf: { a: 'Chiefs', b: 'Seahawks' }, mnf: { a: 'Cowboys', b: 'Eagles' } },
    8:  { tnf: { a: 'Panthers', b: 'Packers' }, snf: { a: 'Commanders', b: 'Cowboys' }, mnf: { a: 'Bears', b: 'Seahawks' } },
    9:  { tnf: { a: 'Jaguars', b: 'Ravens' }, snf: { a: 'Eagles', b: 'Commanders' }, mnf: { a: 'Bills', b: 'Vikings' } },
    10: { tnf: { a: 'Commanders', b: 'Giants' }, snf: { a: 'Buccaneers', b: 'Bears' }, mnf: { a: 'Chargers', b: 'Ravens' } },
    11: { tnf: { a: 'Colts', b: 'Texans' }, snf: { a: 'Steelers', b: 'Bengals' }, mnf: { a: 'Bengals', b: 'Commanders' } },
    12: { tnf: { a: 'Chiefs', b: 'Bills' }, snf: { a: 'Patriots', b: 'Chargers' }, mnf: { a: 'Panthers', b: 'Buccaneers' } },
    13: { tnf: { a: 'Chiefs', b: 'Rams' }, snf: { a: 'Texans', b: 'Steelers' }, mnf: { a: 'Cowboys', b: 'Seahawks' } },
    14: { tnf: { a: 'Vikings', b: 'Patriots' }, snf: { a: 'Bills', b: 'Packers' }, mnf: { a: 'Steelers', b: 'Jaguars' } },
    15: { tnf: { a: '49ers', b: 'Chargers' }, snf: { a: 'Lions', b: 'Vikings' }, mnf: { a: 'Patriots', b: 'Chiefs' } },
    16: { tnf: { a: 'Texans', b: 'Eagles' }, snf: { a: 'Jaguars', b: 'Cowboys' }, mnf: { a: 'Giants', b: 'Lions' } },
    17: { tnf: { a: 'Ravens', b: 'Bengals' }, snf: { a: 'Eagles', b: '49ers' }, mnf: { a: 'Texans', b: 'Packers' } },
  };

  // --- State Management ---
  // Convert SCHEDULE to week data format used by the app
  function ensureAllWeeksLoaded() {
    let changed = false;
    Object.keys(SCHEDULE).forEach(w => {
      const week = parseInt(w);
      if (state.weeks[week]) return; // already confirmed, don't overwrite
      const s = SCHEDULE[week];
      if (!s) return;
      state.weeks[week] = {
        week: week,
        matchups: [
          { a: s.tnf.a, b: s.tnf.b, isSuper: false },
          { a: s.snf.a, b: s.snf.b, isSuper: false },
          { a: s.mnf.a, b: s.mnf.b, isSuper: true }
        ]
      };
      changed = true;
    });
    if (changed) {
      saveLocal();
      // Save all new weeks to Firebase
      Object.keys(SCHEDULE).forEach(w => {
        const week = parseInt(w);
        if (state.weeks[week]) saveWeek(week, state.weeks[week]);
      });
    }
  }

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
    // Push entire state to Firebase — use update to merge, not overwrite
    db.ref('state').update({
      players: state.players,
      weeks: state.weeks,
      results: state.results
    }).catch(err => console.warn('Firebase write failed:', err));
  }

  // Granular save: write only a specific path to avoid overwriting others' data
  function savePlayerWeek(playerName, week, data) {
    saveLocal();
    db.ref(`state/players/${playerName}/${week}`).set(data)
      .catch(err => console.warn('Firebase write failed:', err));
  }

  function saveWeek(week, data) {
    saveLocal();
    db.ref(`state/weeks/${week}`).set(data)
      .catch(err => console.warn('Firebase write failed:', err));
  }

  function savePlayerEntry(playerName) {
    saveLocal();
    db.ref(`state/players/${playerName}`).set(state.players[playerName] || {})
      .catch(err => console.warn('Firebase write failed:', err));
  }

  // --- Firebase Real-time Listener ---
  let _renderTimer = null;
  let _lastSyncTime = 0;
  let _syncCount = 0;

  function initFirebase() {
    // Monitor connection state
    db.ref('.info/connected').on('value', snap => {
      const el = document.getElementById('sync-status');
      if (el) el.textContent = snap.val() ? 'Connected' : 'Disconnected';
    });

    db.ref('state').on('value', (snapshot) => {
      const remote = snapshot.val();
      if (remote) {
        const remotePlayerCount = Object.keys(remote.players || {}).length;
        _syncCount++;
        _lastSyncTime = Date.now();
        console.log('[Firebase sync #' + _syncCount + '] ' + remotePlayerCount + ' players, ' + Object.keys(remote.weeks || {}).length + ' weeks');
        state = {
          players: remote.players || {},
          weeks: remote.weeks || {},
          results: remote.results || {}
        };
        ensureAllWeeksLoaded();
        saveLocal();
        firebaseReady = true;
        // Debounce screen refresh — max once per 400ms
        if (_renderTimer) clearTimeout(_renderTimer);
        _renderTimer = setTimeout(() => {
          _renderTimer = null;
          refreshActiveScreen();
        }, 400);
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

  // Force a one-shot sync on reload — guarantees fresh state even if the
  // real-time listener is slow to fire the first callback
  function syncOnce() {
    db.ref('state').once('value').then(snap => {
      const remote = snap.val();
      if (remote) {
        const pc = Object.keys(remote.players || {}).length;
        console.log('[syncOnce] Got ' + pc + ' players from Firebase');
        state = { players: remote.players || {}, weeks: remote.weeks || {}, results: remote.results || {} };
        ensureAllWeeksLoaded();
        saveLocal();
        firebaseReady = true;
        refreshActiveScreen();
        updateSyncIndicator();
      }
    }).catch(err => { console.warn('[syncOnce] failed:', err); });
  }

  function updateSyncIndicator() {
    const el = document.getElementById('sync-info');
    if (!el) return;
    const playerCount = Object.keys(state.players).length;
    const ago = _lastSyncTime ? Math.round((Date.now() - _lastSyncTime) / 1000) + 's ago' : 'never';
    el.textContent = playerCount + ' players synced | last: ' + ago + ' | pulls: ' + _syncCount;
  }

  // Re-render whatever screen is active (shared by listener + sync helpers)
  function refreshActiveScreen() {
    const activeScreen = document.querySelector('.screen.active');
    if (!activeScreen) return;
    const id = activeScreen.id;
    if (id === 'screen-dashboard') { renderDashboard(); updateSyncIndicator(); }
    if (id === 'screen-leaderboard') renderLeaderboard();
    if (id === 'screen-results') loadResultsWeek();
    if (id === 'screen-commissioner') { if (!_commWeekOverride) initCommissioner(); updateLiveFeed(); }
    if (id === 'screen-all-picks') renderAllPicks();
    if (id === 'screen-confirm') {
      const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
      if (data) renderPickCounter(data);
    }
    if (id === 'screen-my-stats') renderMyStats();
    if (id === 'screen-landing') updateLandingInfo();
  }

  // Re-sync when the app comes back from background (mobile tab switch, lock screen, etc.)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncOnce();
  });

  // --- Screen Navigation ---
  function isAdmin() {
    if (!currentPlayer) return false;
    return currentPlayer.trim().toLowerCase() === ADMIN_NAME.toLowerCase();
  }

  function updateCommishButtons() {
    document.querySelectorAll('.commish-btn').forEach(btn => {
      btn.style.display = isAdmin() ? '' : 'none';
    });
  }

  function updateLoggedInBar() {
    const bar = document.getElementById('logged-in-bar');
    if (!bar) return;
    if (currentPlayer) {
      bar.style.display = '';
      let html = '<span class="logged-in-name">' + esc(currentPlayer) + '</span>';
      if (isAdmin()) {
        html += '<a href="#" class="admin-badge" onclick="App.showScreen(\'screen-commissioner\');return false">★ COMMISSIONER</a>';
      }
      bar.innerHTML = html;
    } else {
      bar.style.display = 'none';
      bar.innerHTML = '';
    }
  }

  const ADMIN_SCREENS = ['screen-results', 'screen-commissioner', 'screen-dashboard', 'screen-all-picks'];

  function goHome() {
    if (currentPlayer) {
      showScreen('screen-my-stats');
    } else {
      showScreen('screen-landing');
    }
  }

  function showScreen(id) {
    // Gate commissioner-only screens
    if (ADMIN_SCREENS.includes(id) && !isAdmin()) {
      id = 'screen-landing';
    }
    sessionStorage.setItem('marjitos_last_screen', id);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    updateCommishButtons();
    updateLoggedInBar();
    if (id === 'screen-landing') updateLandingInfo();
    if (id === 'screen-commissioner') {
      // Auto-set week from URL or latest saved week (unless override active from nextWeek)
      if (_commWeekOverride === null) {
        const urlData = parseURL();
        const weekEl = document.getElementById('comm-week');
        if (urlData && urlData.week) {
          weekEl.value = urlData.week;
        } else {
          const savedWeeks = Object.keys(state.weeks).sort((a, b) => b - a);
          if (savedWeeks.length > 0) weekEl.value = savedWeeks[0];
        }
        initCommissioner();
      } else {
        initCommissioner(_commWeekOverride);
      }
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
      updateLoggedInBar();
      updateCommishButtons();
    }

    initFirebase();
    syncOnce();  // Redundant one-shot fetch — guarantees fresh state on reload
    ensureAllWeeksLoaded();
    const data = parseURL();
    if (data && data.matchups && !state.weeks[data.week]) {
      state.weeks[data.week] = data;
      saveWeek(data.week, data);
    }

    // Auto-login: if we have a saved name and a last screen that isn't landing,
    // go straight back to where they were (skip the name entry)
    if (savedName && lastScreen && lastScreen !== 'screen-landing') {
      showScreen(lastScreen);
    } else if (savedName && !lastScreen) {
      // Saved name but no last screen — auto-enter as that player
      // Wait briefly for Firebase to sync so we have week data
      // Only auto-enter if still on landing (user may have navigated away)
      setTimeout(() => {
        const active = document.querySelector('.screen.active');
        if (active && active.id === 'screen-landing' && Object.keys(state.weeks).length > 0) enterPlayer();
      }, 500);
    } else if (data && data.matchups) {
      showScreen(lastScreen || 'screen-landing');
    } else if (lastScreen) {
      showScreen(lastScreen);
    }
  }

  // --- Landing Info ---
  function updateLandingInfo() {
    // Show "Welcome back" if a saved name exists
    const savedName = localStorage.getItem('marjitos_player_name');
    const heading = document.getElementById('landing-heading');
    const nameInput = document.getElementById('player-name');
    const switchLink = document.getElementById('switch-player-link');
    if (savedName && heading) {
      heading.textContent = `Welcome back, ${savedName}`;
      if (nameInput) { nameInput.value = savedName; nameInput.style.display = 'none'; }
      if (switchLink) switchLink.classList.remove('hidden');
    } else {
      if (heading) heading.textContent = 'Enter Your Name';
      if (nameInput) nameInput.style.display = '';
      if (switchLink) switchLink.classList.add('hidden');
    }
    const el = document.getElementById('active-week-info');
    if (!el) return;
    const activeWeek = getCurrentNFLWeek();
    const weekData = state.weeks[activeWeek];
    if (weekData && weekData.matchups) {
      const deadline = getWeekDeadline(activeWeek);
      const now = new Date();
      const isLocked = now >= deadline;
      const deadlineStr = deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      let html = `<div style="text-align:center;margin-bottom:12px;padding:8px;border-radius:8px;background:rgba(0,200,150,0.06)">`;
      html += `<div style="font-size:0.7rem;font-weight:700;color:var(--accent);letter-spacing:1px;margin-bottom:4px">WEEK ${activeWeek}${isLocked ? ' — LOCKED' : ' — OPEN'}</div>`;
      if (!isLocked) {
        html += `<div style="font-size:0.65rem;color:var(--text-dim);margin-bottom:4px">Picks lock ${deadlineStr} at kickoff</div>`;
      }
      html += weekData.matchups.map(m => `<span style="font-size:0.8rem;color:var(--text-dim)">${teamBadge(m.a)} vs ${teamBadge(m.b)}${m.isSuper ? ' ⭐' : ''}</span>`).join('<br>');
      html += `</div>`;
      el.innerHTML = html;
    } else {
      el.innerHTML = '';
    }
  }

  // --- Commissioner ---
  function initCommissioner(forceWeek) {
    selectedPresets = [];
    const container = document.getElementById('matchup-setups');
    container.innerHTML = '';

    const weekEl = document.getElementById('comm-week');
    // If a specific week was passed (e.g. from nextWeek), use it
    if (forceWeek) {
      weekEl.value = forceWeek;
    }
    const week = parseInt(weekEl.value) || 1;
    const existingWeek = state.weeks[week];

    // If this week already has matchups, show locked view
    if (existingWeek && existingWeek.matchups && existingWeek.matchups.length > 0) {
      let html = '<div class="divider-text">week ' + week + ' matchups locked ✓</div>';
      existingWeek.matchups.forEach((m, i) => {
        const label = m.isSuper ? 'SUPER' : `Matchup ${i + 1}`;
        html += `<div class="live-pick-row"><span class="live-pick-name">${label}</span><span class="live-pick-teams">${teamBadge(m.a)} vs ${teamBadge(m.b)}</span></div>`;
      });
      html += `<div style="display:flex;gap:8px;margin-top:12px">`;
      html += `<button class="btn ghost" style="flex:1" onclick="App.editWeekSetup()">Unlock & Edit</button>`;
      html += `<button class="btn ghost" style="flex:1;color:var(--danger)" onclick="App.resetWeekPicks()">Reset All Picks</button>`;
      html += `</div>`;
      container.innerHTML = html;

      // Hide confirm button for already-locked weeks
      document.getElementById('confirm-week-btn').classList.add('hidden');
      // Keep hash updated but hide share link box
      const hash = encodeHash(existingWeek);
      window.location.hash = hash;
      document.getElementById('share-link-box').classList.add('hidden');

      updateLiveFeed();
      return;
    }

    // Fresh setup — show preset picker
    renderMatchupPicker();
    document.getElementById('confirm-week-btn').classList.remove('hidden');
    document.getElementById('share-link-box').classList.add('hidden');
  }

  function renderMatchupPicker() {
    const container = document.getElementById('matchup-setups');
    container.innerHTML = '';

    const week = parseInt(document.getElementById('comm-week').value) || 1;
    const weekGames = SCHEDULE[week];

    // If we have primetime data, auto-populate the 3 matchups
    if (weekGames) {
      const header = document.createElement('div');
      header.innerHTML = `
        <div class="matchup-label regular" style="margin-bottom:4px">Week ${week} — Primetime Matchups</div>
        <p style="font-size:0.75rem;color:var(--text-dim);text-align:center;margin-bottom:12px">
          TNF (1 pt) + SNF (1 pt) + MNF = Super Matchup (3x pts). Confirm or edit below.
        </p>`;
      container.appendChild(header);

      const preview = document.createElement('div');
      preview.innerHTML = `
        <div class="setup-group">
          <div class="matchup-label regular"><span class="prime-badge prime-tnf">TNF</span> Matchup 1 (1 pt)</div>
          <div class="setup-row">
            <input type="text" id="team-0-a" value="${weekGames.tnf.a}" placeholder="Team A">
            <span class="vs-text">VS</span>
            <input type="text" id="team-0-b" value="${weekGames.tnf.b}" placeholder="Team B">
          </div>
        </div>
        <div class="setup-group">
          <div class="matchup-label regular"><span class="prime-badge prime-snf">SNF</span> Matchup 2 (1 pt)</div>
          <div class="setup-row">
            <input type="text" id="team-1-a" value="${weekGames.snf.a}" placeholder="Team A">
            <span class="vs-text">VS</span>
            <input type="text" id="team-1-b" value="${weekGames.snf.b}" placeholder="Team B">
          </div>
        </div>
        <div class="setup-group super-setup">
          <div class="matchup-label super-label"><span class="prime-badge prime-mnf">MNF</span> Super Matchup<span class="super-badge">3x PTS</span></div>
          <div class="setup-row">
            <input type="text" id="team-2-a" value="${weekGames.mnf.a}" placeholder="Team A">
            <span class="vs-text">VS</span>
            <input type="text" id="team-2-b" value="${weekGames.mnf.b}" placeholder="Team B">
          </div>
        </div>`;
      container.appendChild(preview);
    } else {
      // No schedule data — full manual entry
      const header = document.createElement('div');
      header.innerHTML = `
        <div class="matchup-label regular" style="margin-bottom:4px">Week ${week} — Set Up Matchups</div>
        <p style="font-size:0.75rem;color:var(--text-dim);text-align:center;margin-bottom:12px">
          Enter 2 regular matchups (1 pt each) + 1 Super Matchup (3x pts).
        </p>`;
      container.appendChild(header);

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
  }

  function editWeekSetup() {
    // Unlock the current week for re-editing
    const week = parseInt(document.getElementById('comm-week').value) || 1;
    delete state.weeks[week];
    saveLocal();
    db.ref(`state/weeks/${week}`).remove().catch(err => console.warn('Firebase delete failed:', err));
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
    // Lock the week — prevents Firebase listener from resetting
    _commWeekOverride = nextW;
    initCommissioner(nextW);
    // Keep override for 3 seconds so Firebase callbacks don't reset
    setTimeout(() => { _commWeekOverride = null; }, 3000);
  }

  function resetWeekSetup() {
    editWeekSetup();
  }

  function onCommWeekChange() {
    initCommissioner();
  }

  function browseWeek(direction) {
    const weekEl = document.getElementById('comm-week');
    const current = parseInt(weekEl.value) || 1;
    const next = Math.max(1, Math.min(18, current + direction));
    weekEl.value = next;
    // Clear hash so it doesn't interfere
    window.location.hash = '';
    _commWeekOverride = next;
    initCommissioner(next);
    setTimeout(() => { _commWeekOverride = null; }, 3000);
  }

  function generateLink() {
    const week = parseInt(document.getElementById('comm-week').value) || 1;
    let matchups = [];

    for (let i = 0; i < 3; i++) {
      const a = (document.getElementById(`team-${i}-a`) || {}).value || '';
      const b = (document.getElementById(`team-${i}-b`) || {}).value || '';
      if (!a.trim() || !b.trim()) {
        alert('All matchup fields must be filled in');
        return;
      }
      matchups.push({ a: a.trim(), b: b.trim(), isSuper: i === 2 });
    }

    const data = { week, matchups };
    state.weeks[week] = data;
    saveWeek(week, data);

    const hash = encodeHash(data);
    window.location.hash = hash;
    // Re-render to show locked view
    initCommissioner();
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
    currentPlayer = ADMIN_NAME;
    localStorage.setItem('marjitos_player_name', ADMIN_NAME);
    document.getElementById('player-name').value = ADMIN_NAME;
    enterPlayer();
  }

  // --- Player Voting ---
  function switchPlayer() {
    localStorage.removeItem('marjitos_player_name');
    currentPlayer = '';
    const nameInput = document.getElementById('player-name');
    if (nameInput) { nameInput.value = ''; nameInput.style.display = ''; }
    const heading = document.getElementById('landing-heading');
    if (heading) heading.textContent = 'Enter Your Name';
    const switchLink = document.getElementById('switch-player-link');
    if (switchLink) switchLink.classList.add('hidden');
    updateLoggedInBar();
  }

  const MAX_PLAYERS = 12;

  function enterPlayer() {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { alert('Enter your name'); return; }

    // Check player cap — only for NEW non-admin players (existing ones + Marjito always allowed)
    const existingPlayers = Object.keys(state.players);
    const isNewAdmin = name.trim().toLowerCase() === ADMIN_NAME.toLowerCase();
    if (!state.players[name] && !isNewAdmin && existingPlayers.length >= MAX_PLAYERS) {
      alert(`League is full — max ${MAX_PLAYERS} players allowed. Contact Marjito to join.`);
      return;
    }

    currentPlayer = name;
    localStorage.setItem('marjitos_player_name', name);

    // Determine the active NFL week
    const activeWeek = getCurrentNFLWeek();
    let weekData = state.weeks[activeWeek];

    if (!weekData) {
      const urlData = parseURL();
      if (urlData && urlData.matchups) {
        weekData = urlData;
      } else {
        alert('No matchups available for the current week. Check back soon.');
        return;
      }
    }

    // Use local state FIRST for instant response — Firebase syncs in background
    const week = weekData.week;
    const localExisting = state.players[name] && state.players[name][week];
    if (localExisting && localExisting.picks && Object.keys(localExisting.picks).length > 0) {
      currentPicks = { ...localExisting.picks };
      renderConfirmation(weekData);
    } else {
      if (!state.players[name]) { state.players[name] = {}; savePlayerEntry(name); }
      loadVotingScreen(weekData);
    }
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
          <button class="team-btn" data-matchup="${i}" data-team="a" data-super="${m.isSuper}">${teamBadge(m.a)}</button>
          <span class="vs-text">VS</span>
          <button class="team-btn" data-matchup="${i}" data-team="b" data-super="${m.isSuper}">${teamBadge(m.b)}</button>
        </div>`;
      container.appendChild(card);
    });

    // Use pointerdown for instant response — fires on touch contact, no waiting for lift
    // Prevents ghost click and scroll-triggered picks
    let _pickTouchHandled = false;
    container.addEventListener('pointerdown', function(e) {
      const btn = e.target.closest('.team-btn');
      if (!btn) return;
      e.preventDefault(); // prevent subsequent click + text selection
      _pickTouchHandled = true;
      pickTeam(
        parseInt(btn.dataset.matchup),
        btn.dataset.team,
        btn.dataset.super === 'true'
      );
    }, { passive: false });
    // Fallback click for accessibility (keyboard, assistive tech)
    container.addEventListener('click', function(e) {
      if (_pickTouchHandled) { _pickTouchHandled = false; return; }
      const btn = e.target.closest('.team-btn');
      if (!btn) return;
      pickTeam(
        parseInt(btn.dataset.matchup),
        btn.dataset.team,
        btn.dataset.super === 'true'
      );
    });

    showScreen('screen-vote');
  }

  function pickTeam(matchupIdx, team, isSuper) {
    // Single querySelectorAll instead of two separate calls
    const btns = document.querySelectorAll(`[data-matchup="${matchupIdx}"]`);
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (b.dataset.team === team) {
        b.classList.add(isSuper ? 'selected-super' : 'selected');
      } else {
        b.classList.remove('selected', 'selected-super');
      }
    }
    currentPicks[matchupIdx] = team;
    // Inline check — no sorting, no URL parsing
    document.getElementById('submit-picks-btn').disabled = Object.keys(currentPicks).length < 3;
  }



  function checkAllPicked() {
    const data = parseURL() || state.weeks[Object.keys(state.weeks).sort((a, b) => b - a)[0]];
    const needed = data.matchups.length;
    document.getElementById('submit-picks-btn').disabled = Object.keys(currentPicks).length < needed;
  }

  function submitPicks() {
    const activeWeek = getCurrentNFLWeek();
    const data = state.weeks[activeWeek] || parseURL();
    if (!data) return;
    const week = data.week;

    // Check deadline — can't submit after Thursday kickoff
    const deadline = getWeekDeadline(week);
    if (new Date() >= deadline) {
      alert('Picks are locked — the games have already started for this week.');
      return;
    }

    if (!state.players[currentPlayer]) state.players[currentPlayer] = {};
    const pickData = { picks: { ...currentPicks } };
    state.players[currentPlayer][week] = pickData;
    savePlayerWeek(currentPlayer, week, pickData);

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
        const pw = state.players[p][week];
        if (!pw || !pw.picks) return;
        const pick = pw.picks[i];
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

    // --- Winner entry section ---
    data.matchups.forEach((m, i) => {
      const existing = (state.results[week] || {})[i];
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <span>${m.isSuper ? '<span class="super-badge">SUPER</span> ' : ''}${teamBadge(m.a)} vs ${teamBadge(m.b)}</span>
        <select id="result-${i}">
          <option value="">Winner?</option>
          <option value="a" ${existing === 'a' ? 'selected' : ''}>${m.a}</option>
          <option value="b" ${existing === 'b' ? 'selected' : ''}>${m.b}</option>
        </select>`;
      mContainer.appendChild(row);
    });

    // --- Player picks display ---
    const players = Object.keys(state.players);
    if (players.length === 0) {
      pContainer.innerHTML = '<p style="color:var(--text-dim);text-align:center">No players yet</p>';
      return;
    }

    players.forEach(p => {
      const pData = (state.players[p] && state.players[p][week]) || {};
      const hasPicks = pData.picks && Object.keys(pData.picks).length > 0;
      const card = document.createElement('div');
      card.className = 'rp-card';

      let picksHtml = '';
      data.matchups.forEach((m, i) => {
        const pick = (pData.picks || {})[i];
        const pickedName = pick === 'a' ? m.a : pick === 'b' ? m.b : null;
        if (pickedName) {
          const cls = m.isSuper ? 'rp-chip chip-super' : 'rp-chip';
          picksHtml += `<span class="${cls}">${teamBadge(pickedName)}</span>`;
        } else {
          picksHtml += `<span class="rp-chip chip-empty">—</span>`;
        }
      });

      card.innerHTML = `
        <div class="rp-header">
          <span class="rp-name">${esc(p)}</span>
          <button class="btn ghost rp-reset${hasPicks ? '' : ' rp-disabled'}" onclick="App.resetPlayerPicksFromResults('${esc(p.replace(/'/g, "\\'"))}', ${week})"${hasPicks ? '' : ' disabled'}>Reset</button>
        </div>
        <div class="rp-picks">${picksHtml}</div>`;
      pContainer.appendChild(card);
    });
  }

  function browseResultsWeek(dir) {
    const el = document.getElementById('results-week');
    let w = parseInt(el.value) || 1;
    w = Math.max(1, Math.min(18, w + dir));
    el.value = w;
    loadResultsWeek();
  }

  function resetPlayerPicksFromResults(playerName, week) {
    if (!confirm(`Reset ${playerName}'s picks for Week ${week}? They'll be able to vote again.`)) return;
    if (state.players[playerName] && state.players[playerName][week]) {
      delete state.players[playerName][week];
      savePlayerEntry(playerName);
      loadResultsWeek();
    }
  }

  function addPlayerForWeek() {
    const name = document.getElementById('new-player-name').value.trim();
    if (!name) return;
    if (!state.players[name]) {
      if (Object.keys(state.players).length >= MAX_PLAYERS) {
        alert(`League is full — max ${MAX_PLAYERS} players. Remove someone first.`);
        return;
      }
      state.players[name] = {};
      savePlayerEntry(name);
    }
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

    save();
    alert('Winners saved');
    renderLeaderboard();
  }

  // --- Leaderboard ---
  let _lbWeekView = 0; // 0 = season totals, 1-17 = specific week

  function renderLeaderboard() {
    const { totals, byWeek, weeks, players } = calcScores();
    const currentWeek = getCurrentNFLWeek();
    const container = document.getElementById('leaderboard-table');

    if (players.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);text-align:center">No players yet</p>';
      return;
    }

    // Week selector tabs
    let html = '<div class="lb-week-tabs">';
    html += `<button class="lb-tab${_lbWeekView === 0 ? ' active' : ''}" onclick="App.setLBWeek(0)">Season</button>`;
    for (let w = 1; w <= 17; w++) {
      const status = getWeekStatus(w);
      const cls = status === 'future' ? ' future' : '';
      const isCurrent = w === currentWeek ? ' current' : '';
      html += `<button class="lb-tab${_lbWeekView === w ? ' active' : ''}${cls}${isCurrent}" onclick="App.setLBWeek(${w})">W${w}</button>`;
    }
    html += '</div>';

    if (_lbWeekView === 0) {
      // Season totals view
      const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      html += '<table class="lb-table"><thead><tr><th></th><th>Player</th><th>Pts</th></tr></thead><tbody>';
      sorted.forEach(([name, pts], i) => {
        const medal = i === 0 ? '&#127942;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : '';
        html += `<tr><td class="lb-rank">${medal || i + 1}</td><td>${esc(name)}</td><td>${pts}</td></tr>`;
      });
      html += '</tbody></table>';
    } else {
      // Per-week view
      const w = _lbWeekView;
      const wd = state.weeks[w];
      const wr = state.results[w] || {};
      const status = getWeekStatus(w);
      const hasResults = Object.keys(wr).length > 0;

      // Show matchups for context
      if (wd && wd.matchups) {
        html += '<div class="lb-week-matchups">';
        wd.matchups.forEach((m) => {
          const winnerKey = wr[wd.matchups.indexOf(m)];
          html += `<div class="lb-matchup-row${m.isSuper ? ' lb-matchup-super' : ''}">`;
          const mIdx = wd.matchups.indexOf(m);
          const winner = wr[mIdx];
          const aWin = winner === 'a' ? ' style="font-weight:700;color:var(--accent)"' : '';
          const bWin = winner === 'b' ? ' style="font-weight:700;color:var(--accent)"' : '';
          html += `<span${aWin}>${teamBadge(m.a)}</span><span class="vs-text" style="margin:0 6px">vs</span><span${bWin}>${teamBadge(m.b)}</span>`;
          if (m.isSuper) html += '<span class="super-badge" style="margin-left:6px">3x</span>';
          html += `</div>`;
        });
        html += '</div>';
      }

      if (status === 'future') {
        html += '<p style="color:var(--text-dim);text-align:center;font-size:0.85rem;margin-top:12px">This week hasn\'t started yet</p>';
      } else {
        // Player picks for this week
        const weekScores = [];
        players.forEach(p => {
          const pw = state.players[p] && state.players[p][w];
          const hasPicks = pw && pw.picks && Object.keys(pw.picks).length > 0;
          const pts = (byWeek[w] || {})[p] || 0;
          weekScores.push({ name: p, pts, hasPicks, pw });
        });
        weekScores.sort((a, b) => b.pts - a.pts);

        html += '<table class="lb-table" style="margin-top:8px"><thead><tr><th></th><th>Player</th><th>Picks</th><th>Pts</th></tr></thead><tbody>';
        weekScores.forEach(({ name, pts, hasPicks, pw }, i) => {
          const medal = hasPicks && hasResults ? (i === 0 ? '&#127942;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : '') : '';
          let picksStr = '<span style="color:var(--text-dim);font-size:0.75rem">—</span>';
          if (hasPicks && wd) {
            picksStr = wd.matchups.map((m, mi) => {
              const pick = (pw.picks || {})[mi];
              const pickName = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
              const winner = wr[mi];
              if (winner && pick === winner) return `<span class="pick-correct">${pickName}</span>`;
              if (winner && pick !== winner) return `<span class="pick-wrong">${pickName}</span>`;
              return `<span class="pick-pending">${pickName}</span>`;
            }).join(', ');
          }
          html += `<tr><td class="lb-rank">${medal || i + 1}</td><td>${esc(name)}</td><td style="font-size:0.75rem">${picksStr}</td><td>${hasPicks ? pts : '—'}</td></tr>`;
        });
        html += '</tbody></table>';
      }
    }

    container.innerHTML = html;
  }

  function setLBWeek(w) {
    _lbWeekView = w;
    renderLeaderboard();
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
        h += `<tr><td class="lb-rank">${medal || i + 1}</td><td>${esc(name)}</td>`;
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

      hHtml += `<div class="history-week collapsible-week" onclick="this.classList.toggle('open')">`;
      hHtml += `<div class="history-week-header cw-row">`;
      hHtml += `<span class="history-week-num">Week ${week}</span>`;
      hHtml += hasResults
        ? '<span class="badge-done">Results In</span>'
        : '<span class="badge-pending">Pending</span>';
      hHtml += `<button class="btn ghost" style="padding:4px 8px;font-size:0.75rem;width:auto;margin:0" onclick="event.stopPropagation();document.getElementById('results-week').value=${week};App.showScreen('screen-results')">Edit</button>`;
      hHtml += `<button class="btn ghost" style="padding:4px 8px;font-size:0.65rem;width:auto;margin:0;color:var(--danger)" onclick="event.stopPropagation();App.resetWeekPicks(${week})">Reset</button>`;
      hHtml += `<span class="cw-chevron">▸</span>`;
      hHtml += `</div>`;

      hHtml += `<div class="cw-body">`;
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
        hHtml += `<div class="history-player-row"><span>${esc(p)}</span><span class="history-player-picks">${pickNames}</span><span class="history-player-pts">${wPts} pts</span></div>`;
      });
      hHtml += '</div></div></div>';
    });
    historyEl.innerHTML = hHtml;

    // Manage Players section — dropdown selector + detail panel
    const playersEl = document.getElementById('dash-players');
    const allPlayers = Object.keys(state.players).sort();
    const activeWeeks = Object.keys(state.weeks).sort((a, b) => a - b);
    if (allPlayers.length === 0) {
      playersEl.innerHTML = '<p style="color:var(--text-dim)">No players yet</p>';
    } else {
      let pH = '<div class="player-manage-wrap">';
      pH += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`;
      pH += `<label style="font-size:0.8rem;color:var(--text-dim);white-space:nowrap">Player (${allPlayers.length})</label>`;
      pH += `<select id="manage-player-select" onchange="App.renderPlayerDetail()" style="flex:1;background:var(--card);color:var(--text);border:1px solid var(--card-border);border-radius:6px;padding:6px 8px;font-size:0.85rem">`;
      allPlayers.forEach((p, i) => {
        const pickedWeeks = activeWeeks.filter(w => {
          const pw = state.players[p] && state.players[p][w];
          return pw && pw.picks && Object.keys(pw.picks).length > 0;
        });
        pH += `<option value="${esc(p)}"${i === 0 ? ' selected' : ''}>${esc(p)} — ${pickedWeeks.length} week${pickedWeeks.length !== 1 ? 's' : ''} picked</option>`;
      });
      pH += `</select></div>`;
      pH += `<div id="manage-player-detail"></div>`;
      pH += '</div>';
      playersEl.innerHTML = pH;
      renderPlayerDetail();
    }
  }

  function renderPlayerDetail() {
    const sel = document.getElementById('manage-player-select');
    const detailEl = document.getElementById('manage-player-detail');
    if (!sel || !detailEl) return;
    const name = sel.value;
    if (!name) { detailEl.innerHTML = ''; return; }

    const activeWeeks = Object.keys(state.weeks).sort((a, b) => a - b);
    const escapedName = name.replace(/'/g, "\\'");

    let h = `<div style="border:1px solid var(--card-border);border-radius:8px;padding:10px;margin-top:4px">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">`;
    h += `<strong style="font-size:0.9rem">${esc(name)}</strong>`;
    h += `<button class="btn ghost" style="width:auto;padding:2px 10px;font-size:0.7rem;margin:0;color:var(--danger)" onclick="App.removePlayer('${escapedName}')">Remove Player</button>`;
    h += `</div>`;

    if (activeWeeks.length > 0) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      activeWeeks.forEach(w => {
        const pWeek = state.players[name] && state.players[name][w];
        const hasPicks = pWeek && pWeek.picks && Object.keys(pWeek.picks).length > 0;
        if (hasPicks) {
          h += `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;background:rgba(0,200,150,0.12);color:var(--accent);padding:3px 8px;border-radius:4px">`;
          h += `W${w} ✓ <a href="#" onclick="App.resetPlayerPicks('${escapedName}',${w});return false" style="color:var(--danger);text-decoration:none;font-weight:700" title="Reset Week ${w}">✕</a>`;
          h += `</span>`;
        } else {
          h += `<span style="font-size:0.7rem;color:var(--text-dim);padding:3px 8px">W${w} —</span>`;
        }
      });
      h += '</div>';
    } else {
      h += '<p style="font-size:0.75rem;color:var(--text-dim);margin:0">No weeks set up yet</p>';
    }
    h += '</div>';
    detailEl.innerHTML = h;
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
      html += `<div class="live-pick-row"><span class="live-pick-name">${esc(p)}</span><span class="live-pick-teams">${pickSummary}</span></div>`;
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
        html += `<div class="all-pick-name">${esc(p)}</div>`;
        html += `<button class="btn ghost" style="width:auto;padding:2px 8px;font-size:0.7rem;margin:0;color:var(--danger)" onclick="App.resetPlayerPicks('${p.replace(/'/g, "\\'")}',${week})">Reset</button>`;
        html += `</div>`;
        html += '<div class="all-pick-choices">';
        weekData.matchups.forEach((m, i) => {
          const pick = (pw.picks || {})[i];
          const teamName = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
          html += `<span class="all-pick-chip${m.isSuper ? ' chip-super' : ''}">${teamName}</span>`;
        });
        html += '</div>';
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
      savePlayerEntry(playerName);
      const active = document.querySelector('.screen.active');
      if (active && active.id === 'screen-results') loadResultsWeek();
      else if (active && active.id === 'screen-dashboard') renderDashboard();
      else renderAllPicks();
    }
  }

  function resetWeekPicks(week) {
    if (!week) week = parseInt(document.getElementById('comm-week').value) || 1;
    const players = Object.keys(state.players);
    const withPicks = players.filter(p => state.players[p][week] && state.players[p][week].picks);
    if (withPicks.length === 0) { alert(`No picks to reset for Week ${week}.`); return; }
    if (!confirm(`Reset ALL ${withPicks.length} player picks for Week ${week}? Everyone will need to re-vote.`)) return;
    const updates = {};
    withPicks.forEach(p => {
      delete state.players[p][week];
      updates[`state/players/${p}/${week}`] = null;
    });
    saveLocal();
    db.ref().update(updates).catch(err => console.warn('Firebase batch delete failed:', err));
    alert(`Week ${week}: ${withPicks.length} player picks cleared.`);
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'screen-dashboard') renderDashboard();
    else if (active && active.id === 'screen-all-picks') renderAllPicks();
    else initCommissioner();
  }

  function removePlayer(playerName) {
    if (!confirm(`Remove ${playerName} entirely? All their picks across every week will be deleted.`)) return;
    if (state.players[playerName]) {
      delete state.players[playerName];
      saveLocal();
      db.ref(`state/players/${playerName}`).remove()
        .catch(err => console.warn('Firebase delete failed:', err));
      renderDashboard();
    }
  }

  // --- Schedule Refresh ---
  // Try ESPN API for live schedule; fall back to hardcoded SCHEDULE
  function refreshSchedule() {
    const week = parseInt(document.getElementById('comm-week').value) || 1;
    // Don't overwrite a confirmed week unless user says so
    if (state.weeks[week] && state.weeks[week].matchups) {
      if (!confirm(`Week ${week} is already confirmed. Re-apply schedule data and unlock it?`)) return;
      delete state.weeks[week];
      saveLocal();
      db.ref(`state/weeks/${week}`).remove().catch(() => {});
    }

    const statusEl = document.getElementById('schedule-status');
    if (statusEl) { statusEl.textContent = 'Fetching schedule...'; statusEl.style.display = ''; }

    // Try ESPN undocumented API (2026 regular season)
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=2026`;
    fetch(espnUrl)
      .then(r => { if (!r.ok) throw new Error('ESPN returned ' + r.status); return r.json(); })
      .then(data => {
        const games = (data.events || []);
        // Identify primetime games by their broadcast slot
        let tnf = null, snf = null, mnf = null;
        games.forEach(g => {
          const name = (g.name || '').toLowerCase();
          const shortName = g.shortName || '';
          const teams = (g.competitions && g.competitions[0] && g.competitions[0].competitors) || [];
          const dayOfWeek = new Date(g.date).getDay(); // 0=Sun, 1=Mon, 4=Thu
          const broadcast = ((g.competitions && g.competitions[0] && g.competitions[0].broadcast) || '').toLowerCase();

          if (teams.length < 2) return;
          const away = teams.find(t => t.homeAway === 'away');
          const home = teams.find(t => t.homeAway === 'home');
          if (!away || !home) return;
          const aName = TEAMS[away.team.abbreviation] || away.team.displayName;
          const bName = TEAMS[home.team.abbreviation] || home.team.displayName;

          if (dayOfWeek === 4 && !tnf) tnf = { a: aName, b: bName };
          else if (dayOfWeek === 0 && !snf) {
            // SNF is the late Sunday game — check time or just take last Sunday game
            if (!snf) snf = { a: aName, b: bName }; // will be overwritten by later Sunday games
          }
          else if (dayOfWeek === 1 && !mnf) mnf = { a: aName, b: bName };
        });

        // If we got all 3 primetime slots from ESPN, use them
        if (tnf && snf && mnf) {
          SCHEDULE[week] = { tnf, snf, mnf };
          if (statusEl) { statusEl.textContent = `Week ${week} updated from ESPN`; statusEl.style.color = 'var(--accent)'; }
        } else {
          // Partial data — fall back to hardcoded
          if (statusEl) { statusEl.textContent = `ESPN partial — using stored schedule`; statusEl.style.color = 'var(--super)'; }
        }
        renderMatchupPicker();
        document.getElementById('confirm-week-btn').classList.remove('hidden');
      })
      .catch(() => {
        // ESPN failed (CORS, down, etc.) — use hardcoded SCHEDULE
        if (statusEl) { statusEl.textContent = `Using stored schedule (ESPN unavailable)`; statusEl.style.color = 'var(--text-dim)'; }
        renderMatchupPicker();
        document.getElementById('confirm-week-btn').classList.remove('hidden');
      });
  }

  function resetAllData() {
    if (!confirm('NUCLEAR RESET: This will delete ALL picks, results, and week data for everyone. Are you sure?')) return;
    if (!confirm('Seriously — this cannot be undone. Confirm one more time.')) return;
    state = { players: {}, weeks: {}, results: {} };
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('marjitos_player_name');
    sessionStorage.removeItem('marjitos_last_screen');
    db.ref('state').set(null).then(() => {
      alert('All data wiped. Reloading...');
      window.location.hash = '';
      window.location.reload();
    }).catch(err => {
      alert('Firebase wipe failed: ' + err.message);
    });
  }

  // --- Player Stats ---
  function renderMyStats() {
    const name = currentPlayer;
    if (!name) { showScreen('screen-landing'); return; }

    document.getElementById('my-stats-name').textContent = `${name}'s Record`;
    const container = document.getElementById('my-stats-content');
    const playerData = state.players[name] || {};

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

    const currentWeek = getCurrentNFLWeek();

    let html = '';

    // --- Summary stats ---
    html += `<div style="display:flex;gap:12px;margin-bottom:16px">`;
    html += `<div class="stat-box"><div class="stat-num">${myTotal}</div><div class="stat-label">Points</div></div>`;
    html += `<div class="stat-box"><div class="stat-num">#${rank || '—'}</div><div class="stat-label">Rank</div></div>`;
    html += `<div class="stat-box"><div class="stat-num">${pct}%</div><div class="stat-label">Accuracy</div></div>`;
    html += `</div>`;

    // --- Full Season Browser: all 17 weeks ---
    html += '<div class="divider-text">full season</div>';

    for (let w = 1; w <= 17; w++) {
      const wd = state.weeks[w] || (SCHEDULE[w] ? { week: w, matchups: [
        { a: SCHEDULE[w].tnf.a, b: SCHEDULE[w].tnf.b, isSuper: false },
        { a: SCHEDULE[w].snf.a, b: SCHEDULE[w].snf.b, isSuper: false },
        { a: SCHEDULE[w].mnf.a, b: SCHEDULE[w].mnf.b, isSuper: true }
      ]} : null);
      if (!wd || !wd.matchups) continue;

      const wr = state.results[w] || {};
      const pw = playerData[w];
      const hasPicks = pw && pw.picks && Object.keys(pw.picks).length > 0;
      const status = getWeekStatus(w);
      const wPts = (byWeek[w] || {})[name] || 0;
      const deadline = getWeekDeadline(w);
      const now = new Date();

      if (status === 'active') {
        // --- Current week: prominent card (not collapsible) ---
        const isLocked = now >= deadline && !hasPicks;
        const deadlineStr = deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        html += `<div class="current-week-card">`;
        html += `<div class="cw-header"><span class="cw-label">WEEK ${w}</span>`;
        if (hasPicks) {
          html += `<span class="badge-done">LOCKED IN</span>`;
        } else if (isLocked) {
          html += `<span class="badge-missed">MISSED</span>`;
        } else {
          html += `<span class="badge-pending">NEEDS PICKS</span>`;
        }
        html += `</div>`;
        if (!hasPicks && !isLocked) {
          html += `<p style="font-size:0.7rem;color:var(--text-dim);text-align:center;margin-bottom:6px">Picks lock ${deadlineStr} at kickoff</p>`;
        }

        if (hasPicks) {
          wd.matchups.forEach((m, i) => {
            const pick = pw.picks[i];
            const pickedName = pick === 'a' ? m.a : pick === 'b' ? m.b : '—';
            const winner = wr[i];
            let cls = 'pick-pending', icon = '⏳';
            if (winner) {
              if (pick === winner) { cls = 'pick-correct'; icon = '✓'; }
              else { cls = 'pick-wrong'; icon = '✗'; }
            }
            const superTag = m.isSuper ? ' <span class="super-badge">SUPER</span>' : '';
            html += `<div class="cw-pick"><span class="${cls}">${icon} ${teamBadge(pickedName)}</span>`;
            html += `<span class="cw-matchup">${m.a} vs ${m.b}${superTag}</span></div>`;
          });
        } else if (isLocked) {
          html += `<p class="cw-prompt" style="color:var(--danger)">Picks window closed for this week.</p>`;
        } else {
          html += `<p class="cw-prompt">Picks not in yet — tap below to make your picks.</p>`;
          html += `<button class="btn primary" style="margin-top:8px" onclick="App.enterPlayer()">Make Picks</button>`;
        }
        html += `</div>`;

      } else if (status === 'past') {
        // --- Past week: collapsible, LAZY body (populated on first expand) ---
        html += `<div class="collapsible-week week-past" data-lazy-week="${w}" onclick="App.toggleWeek(this)">`;
        html += `<div class="cw-row">`;
        html += `<span style="font-weight:700;font-size:0.85rem">Week ${w}</span>`;
        if (hasPicks) {
          html += `<span class="pointed">${wPts} pts</span>`;
        } else {
          html += `<span class="badge-missed-sm">MISSED</span>`;
        }
        html += `<span class="cw-chevron">▸</span></div>`;
        html += `<div class="cw-body"></div></div>`;

      } else {
        // --- Future week: collapsible, LAZY body ---
        html += `<div class="collapsible-week week-future" data-lazy-week="${w}" onclick="App.toggleWeek(this)">`;
        html += `<div class="cw-row">`;
        html += `<span style="font-weight:700;font-size:0.85rem;opacity:0.5">Week ${w}</span>`;
        html += `<span class="badge-future">UPCOMING</span>`;
        html += `<span class="cw-chevron">▸</span></div>`;
        html += `<div class="cw-body"></div></div>`;
      }
    }

    // vs the field
    if (sorted.length > 1) {
      html += '<div class="divider-text">vs the field</div>';
      sorted.slice(0, 5).forEach(([n, pts], i) => {
        const isMe = n === name;
        html += `<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:0.85rem;${isMe ? 'font-weight:700;color:var(--accent)' : ''}">`;
        html += `<span>${i + 1}. ${esc(n)}${isMe ? ' (you)' : ''}</span><span>${pts} pts</span></div>`;
      });
    }

    container.innerHTML = html;
  }

  // Lazy toggle for collapsible weeks — populates body on first open
  function toggleWeek(el) {
    const body = el.querySelector('.cw-body');
    if (!body) return;

    // If already populated, just toggle
    if (body.dataset.loaded) {
      el.classList.toggle('open');
      return;
    }

    // First open — build the content
    const w = parseInt(el.dataset.lazyWeek);
    if (!w) { el.classList.toggle('open'); return; }

    const name = currentPlayer;
    const playerData = state.players[name] || {};
    const wd = state.weeks[w] || (SCHEDULE[w] ? { week: w, matchups: [
      { a: SCHEDULE[w].tnf.a, b: SCHEDULE[w].tnf.b, isSuper: false },
      { a: SCHEDULE[w].snf.a, b: SCHEDULE[w].snf.b, isSuper: false },
      { a: SCHEDULE[w].mnf.a, b: SCHEDULE[w].mnf.b, isSuper: true }
    ]} : null);
    if (!wd || !wd.matchups) { el.classList.toggle('open'); return; }

    const wr = state.results[w] || {};
    const pw = playerData[w];
    const hasPicks = pw && pw.picks && Object.keys(pw.picks).length > 0;
    const status = getWeekStatus(w);
    let inner = '';

    if (status === 'past') {
      if (hasPicks) {
        wd.matchups.forEach((m, i) => {
          const pick = pw.picks[i];
          const pickName = pick === 'a' ? m.a : pick === 'b' ? m.b : '?';
          const winner = wr[i];
          let cls = 'pick-pending', icon = '⏳';
          if (winner) {
            if (pick === winner) { cls = 'pick-correct'; icon = '✓'; }
            else { cls = 'pick-wrong'; icon = '✗'; }
          }
          inner += `<div style="font-size:0.8rem;padding:2px 0"><span class="${cls}">${icon} ${teamBadge(pickName)}</span>`;
          inner += `<span style="color:var(--text-dim)"> — ${m.a} vs ${m.b}${m.isSuper ? ' ⭐' : ''}</span></div>`;
        });
      } else {
        inner += `<div style="font-size:0.8rem;color:var(--text-dim);padding:4px 0">No picks submitted</div>`;
        wd.matchups.forEach((m, i) => {
          const winner = wr[i];
          const winName = winner === 'a' ? m.a : winner === 'b' ? m.b : null;
          inner += `<div style="font-size:0.8rem;padding:2px 0;color:var(--text-dim)">${m.a} vs ${m.b}${m.isSuper ? ' ⭐' : ''}`;
          if (winName) inner += ` — <span class="pick-correct">W: ${winName}</span>`;
          inner += `</div>`;
        });
      }
    } else {
      // Future
      wd.matchups.forEach((m) => {
        const primeLabel = m.isSuper ? '<span class="super-badge" style="font-size:0.55rem;margin-right:4px">MNF</span>' : '';
        inner += `<div style="font-size:0.8rem;padding:2px 0;opacity:0.45">${primeLabel}${teamBadge(m.a)} vs ${teamBadge(m.b)}</div>`;
      });
    }

    body.innerHTML = inner;
    body.dataset.loaded = '1';
    el.classList.toggle('open');
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
              picks: d.picks
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
    goHome, showScreen, enterPlayer, switchPlayer, generateLink, copyLink, commishMakePicks,
    pickTeam, submitPicks,
    loadResultsWeek, addPlayerForWeek, saveResults, browseResultsWeek, resetPlayerPicksFromResults,
    exportData, downloadMyPicks,
    triggerImport, handleImport, importFullData, handleFullImport,
    showAllPicks, renderAllPicks, resetWeekSetup, onCommWeekChange,
    editWeekSetup, nextWeek, resetPlayerPicks, resetWeekPicks, removePlayer, browseWeek, resetAllData, refreshSchedule,
    setLBWeek, toggleWeek, renderPlayerDetail, syncOnce
  };
})();
