// BREACH:// — a terminal puzzle game. Break into a fictional version of SRATH's systems and find the access key.
// Everything is simulated in this file: the filesystem, users, network, SQL database and processes.
// Progress is saved in this browser's localStorage under "breach:v2". Nothing is sent anywhere.
(function () {
  'use strict';

  var root = document.getElementById('breach');
  if (!root) return;

  var SAVE_KEY = 'breach:v2'; // v2: the machine became srath, so old saves would point at missing files
  var FRAGMENTS = ['7F3A', '9C1E', '2B8D', 'D5A0', 'E04C'];
  var FULL_KEY = FRAGMENTS.join('-');
  var ADMIN_PASSWORD = 'regnorm-42';
  var VAULT_URL = '/games/breach/vault/';

  // ---------------------------------------------------------------------------
  // Missions

  var LEVELS = [
    { title: 'First Access', goal: 'Switch to the admin account. Its password is written down somewhere on this machine.', hints: [
      'Look around. `ls` lists files, `cd <folder>` moves into a folder, `cat <file>` prints a file.',
      'Read your notes (`cat notes.md`), then look in the scripts folder.',
      'Run `cat ~/scripts/backup.sh`, then `su admin` and type the password.',
    ] },
    { title: 'Hidden Files', goal: 'Find what admin is hiding in their home folder and decode it.', hints: [
      'You have mail: `cat /var/mail/admin`. Files whose names start with a dot are hidden from a plain `ls`. Try `ls -a`.',
      'There is a hidden folder in /home/admin. The file inside is Base64-encoded.',
      'Run `base64 -d ~/.backup/recovery.b64`.',
    ] },
    { title: 'Network Breach', goal: 'Find the database server and its one open port, then connect to it.', hints: [
      'The decoded note mentioned /etc/hosts. Read it with `cat /etc/hosts`.',
      '`scan <host>` lists a server\'s ports, for example `scan db.srath`.',
      'Connect to the open port: `connect db.srath 5433`.',
    ] },
    { title: 'Database Heist', goal: 'Query the SRATH database for the fourth fragment.', hints: [
      'Type `sql` to open the console, then `SHOW TABLES;` and `SELECT * FROM users;`.',
      'The vault table only shows rows you filter by owner. Whose vault is it? The users table and the mail server know.',
      'In the console: `SELECT * FROM vault WHERE owner = \'tommy\';`',
    ] },
    { title: 'The Cipher', goal: 'Decrypt the message in /srv/cipher.', hints: [
      'Read `/srv/cipher/README` to learn which cipher was used.',
      'The key is the codename of the classified project. Look in the projects table with `sql`.',
      'Run `decrypt BREACH /srv/cipher/message.enc`.',
    ] },
    { title: 'Root Access', goal: 'Get past the sentinel and unlock root with the full access key.', hints: [
      'The decrypted message says a sentinel guards root. `ps` lists running processes.',
      'Killing the sentinel is pointless while its watchdog is alive. Stop the watchdog first with `kill <pid>`.',
      'Kill the watchdog, then the sentinel, then `unlock` followed by all five fragments in order. `status` lists them.',
    ] },
  ];

  var ACHIEVEMENTS = {
    first: ['Hello, world', 'Ran your first command.'],
    whoami: ['Identity crisis', 'Asked the machine who you are.'],
    sudo: ['Not in the sudoers file', 'Tried sudo. This incident will be reported.'],
    rmrf: ['Scorched earth', 'Tried rm -rf /. SRATH survived.'],
    history: ['History buff', 'Read somebody else\'s shell history.'],
    grep: ['Needle, haystack', 'Found the admin password with grep.'],
    oldschool: ['Old school', 'Decoded a fragment yourself and submitted it.'],
    logdiver: ['Log diver', 'Found the database port in a log instead of scanning.'],
    bobby: ['Little Bobby Tables', 'Used a tautology to get past a WHERE clause.'],
    brute: ['Brute force', 'Tried every Caesar shift.'],
    archivist: ['Archivist', 'Browsed the release server.'],
    ghost: ['Ghost', 'Reached root without using a single hint.'],
    speed: ['Speedrunner', 'Reached root in under 15 minutes.'],
  };

  // ---------------------------------------------------------------------------
  // The simulated machine: a fictional version of SRATH's systems, not the real ones.

  var HOSTS = {
    'gateway': { ip: '10.0.7.1', ports: [[22, 'filtered', 'ssh'], [443, 'closed', 'https']] },
    'srath': { ip: '10.0.7.5', ports: [[22, 'open', 'ssh']] },
    'releases.srath': { ip: '10.0.7.12', ports: [[21, 'open', 'ftp'], [22, 'filtered', 'ssh']] },
    'mail.srath': { ip: '10.0.7.20', ports: [[25, 'open', 'smtp'], [143, 'closed', 'imap']] },
    'db.srath': { ip: '10.0.7.31', ports: [[22, 'filtered', 'ssh'], [80, 'closed', 'http'], [5433, 'open', 'srath-db']] },
  };

  function F(content, owner) { return { type: 'file', content: content, owner: owner || 'guest' }; }
  function D(children, owner) { return { type: 'dir', children: children, owner: owner || 'guest' }; }

  var FS = D({
    home: D({
      guest: D({
        'README.txt': F([
          'SRATH - development machine',
          '',
          'SRATH is a one-person software company, and this is (a fictional',
          'version of) its main machine. Tommy has challenged you to break in.',
          'Somewhere on this network is the ACCESS KEY, split into five fragments.',
          '',
          'Commands:  mission   what to do next',
          '           help      every command you can use',
          '           hint      a nudge, if you get stuck',
          '',
          'Everything here is made up. These are not SRATH\'s real servers.',
        ].join('\n')),
        '.bash_history': F('ls\ncat notes.md\nnano scripts/backup.sh\n./scripts/backup.sh\nsu admin\nexit'),
        'notes.md': F([
          '# Guest account',
          '',
          '- set up for testers and the occasional curious visitor',
          '- reminder to self: the admin password was never rotated. It is still',
          '  hardcoded in the backup script, of all places. Fix before anyone notices.',
          '    -- Tommy',
        ].join('\n')),
        scripts: D({
          'backup.sh': F([
            '#!/bin/sh',
            '# Nightly backup of /home to the release server.',
            '# TODO: move these credentials somewhere safer (said every developer, ever)',
            '',
            'BACKUP_USER=admin',
            'BACKUP_PASS=regnorm-42',
            '',
            'rsync -a /home/ "$BACKUP_USER@releases.srath:/backups/$(date +%F)/"',
          ].join('\n')),
          'cleanup.sh': F([
            '#!/bin/sh',
            '# Delete temporary files older than a week.',
            'find /tmp -type f -mtime +7 -delete',
          ].join('\n')),
        }),
      }),
      admin: D({
        '.bash_history': F('ls -a\ncd .backup\nbase64 recovery.b64\ncat /etc/hosts\nexit', 'admin'),
        'notes.txt': F([
          '- srath-db moved off its default port. Do not tell anyone which one.',
          '- sentinel config lives in /etc/sentinel.conf',
        ].join('\n'), 'admin'),
        '.backup': D({
          'NOTE': F('Encoded with base64. -- T', 'admin'),
          'recovery.b64': F('S0VZIEZSQUdNRU5UIDIvNTogOUMxRQpOZXR3b3JrIG1hcDog\nL2V0Yy9ob3N0cwpUaGUgZGF0YWJhc2Ugc2VydmVyIGhhcyBl\neGFjdGx5IG9uZSBvcGVuIGRvb3Iu', 'admin'),
        }, 'admin'),
      }, 'admin'),
      tommy: D({ 'ideas.txt': F('Nice try. The ideas stay private.', 'root') }, 'root'),
    }),
    etc: D({
      hosts: F([
        '127.0.0.1   localhost',
        '10.0.7.1    gateway',
        '10.0.7.5    srath            # this machine',
        '10.0.7.12   releases.srath   # app builds and old releases',
        '10.0.7.20   mail.srath',
        '10.0.7.31   db.srath',
      ].join('\n')),
      motd: F('SRATH: independent projects. Authorised users only. Unauthorised users: please at least wipe your feet.'),
      passwd: F('root:x:0:0:root:/root\ntommy:x:1000:1000:Tommy Jonas Rath:/home/tommy\nadmin:x:1001:1001:admin account:/home/admin\nci-bot:x:1002:1002:build robot:/nonexistent\nbackup-bot:x:1003:1003:backup robot:/nonexistent\nguest:x:1004:1004:Guest:/home/guest'),
      'sentinel.conf': F([
        '# sentinel - guards /root',
        'protect     = /root',
        'respawn_by  = watchdog     # if sentinel dies, watchdog restarts it',
        'on_intrude  = lockdown',
      ].join('\n'), 'admin'),
    }),
    var: D({
      mail: D({
        admin: F([
          'From tommy@srath  Tue Nov 11 16:02',
          'From: Tommy <tommy@srath>',
          'To: admin@srath',
          'Subject: note to self: the recovery file',
          '',
          'Moved the recovery file into a hidden folder in your home,',
          'so a plain `ls` will not show it. It is base64-encoded too.',
          'Yes, I am emailing myself. It is a one-person company.',
          '',
          '-- T',
        ].join('\n'), 'admin'),
      }),
      log: D({
        'auth.log': F([
          'Nov 12 08:58  su admin      FAILED  (from guest)',
          'Nov 12 08:59  su admin      OK      (from guest)',
          'Nov 12 17:31  sudo  guest   DENIED  "make me a sandwich"',
        ].join('\n')),
        'firewall.log': F([
          'Nov 12 09:14  DENY   tcp 10.0.7.31:22    from 10.0.7.5',
          'Nov 12 09:14  ALLOW  tcp 10.0.7.31:5433  from 10.0.7.5   srath-db',
          'Nov 12 09:15  DENY   tcp 10.0.7.1:22     from 10.0.7.5',
          'Nov 12 11:02  ALLOW  tcp 10.0.7.12:21    from 10.0.7.5   ftp (anonymous)',
        ].join('\n'), 'admin'),
      }),
    }),
    srv: D({
      cipher: D({
        README: F([
          'message.enc - encrypted with a Vigenere cipher.',
          'The key is one word in capitals: the codename of the project',
          'that is still marked classified.',
          '',
          'Tool: decrypt <KEY> <file>',
        ].join('\n'), 'admin'),
        'message.enc': F('LVC FTHHDINV 5/5: L04D\nJINVPOVP GWHSUW RQVU. ZXS YHUTLDQN SVWTCYUJ MT.\nUAPG XHG DBKGHFVH WMRUA, UYIN VOF JINVPOVP.\nTJLO LRLQJL NMTJ HMC JIXL GIEGOLOKW, IP VSUIR.', 'admin'),
      }, 'admin'),
    }),
    tmp: D({
      '.coffee': F('There is no coffee in /tmp. There never was.'),
    }),
    root: D({ 'flag.txt': F('If you can read this, you are root on srath. Congratulations.', 'root') }, 'root'),
  });

  // SRATH's projects as they really are; BREACH (this game) is the one still marked classified.
  var DB = {
    users: {
      cols: ['id', 'username', 'full_name', 'role'],
      rows: [[1, 'tommy', 'Tommy Jonas Rath', 'owner'], [2, 'admin', 'admin account', 'sysadmin'], [3, 'ci-bot', 'build robot', 'service'], [4, 'backup-bot', 'backup robot', 'service']],
    },
    projects: {
      cols: ['id', 'codename', 'kind', 'status'],
      rows: [[1, 'EVERAFTER', 'android app', 'live'], [2, 'KVITOGFRIT', 'android app', 'in development'], [3, 'REGNORM', 'android app', 'coming soon'], [4, 'BAIGANYO', 'webshop', 'opening soon'], [5, 'GRIDWORD', 'browser game', 'live'], [6, 'BREACH', 'browser game', 'classified']],
    },
    vault: {
      cols: ['id', 'owner', 'fragment', 'note'],
      rows: [
        [1, 'ci-bot', '(empty)', 'Build 1.0.0 green. Ship it.'],
        [2, 'tommy', 'KEY FRAGMENT 4/5: D5A0', 'Encrypted message: /srv/cipher/message.enc'],
        [3, 'backup-bot', '(empty)', 'Last backup OK. Password still in backup.sh. Not my problem.'],
      ],
    },
  };

  // ---------------------------------------------------------------------------
  // State

  function freshState() {
    return {
      level: 1, done: false, user: 'guest', cwd: '/home/guest',
      found: [false, false, false, false, false],
      achievements: {}, hintsUsed: 0, hintStep: [0, 0, 0, 0, 0, 0],
      history: [], elapsed: 0, booted: false,
      scanned: {}, dbConnected: false, watchdog: true, sentinel: true, sentinelPid: 418,
    };
  }

  var state = load();
  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && saved.found) {
        var base = freshState();
        Object.keys(base).forEach(function (k) { if (!(k in saved)) saved[k] = base[k]; });
        return saved;
      }
    } catch (e) { /* ignore */ }
    return freshState();
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------------------
  // DOM

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  root.textContent = '';
  root.classList.add('br');
  var frame = el('div', 'br-frame');
  var bar = el('div', 'br-bar');
  var brand = el('span', 'br-brand', 'BREACH://');
  var pips = el('div', 'br-pips');
  pips.setAttribute('aria-label', 'Mission progress');
  var stars = el('span', 'br-stars');
  bar.append(brand, pips, stars);

  var screen = el('div', 'br-screen');
  var log = el('div', 'br-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  var line = el('label', 'br-line');
  var prompt = el('span', 'br-prompt');
  var input = el('input', 'br-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Command');
  input.setAttribute('enterkeyhint', 'send');
  line.append(prompt, input);
  screen.append(log, line);

  var keys = el('div', 'br-keys');
  [['Tab', 'tab'], ['↑', 'up'], ['↓', 'down'], ['hint', 'hint'], ['help', 'help']].forEach(function (k) {
    var b = el('button', 'br-key', k[0]);
    b.type = 'button';
    b.dataset.act = k[1];
    keys.appendChild(b);
  });

  frame.append(bar, screen, keys);
  root.appendChild(frame);

  // ---------------------------------------------------------------------------
  // Output

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Text may contain links written as [[label|url]] and inline code written as `code`.
  function format(text) {
    return escapeHtml(text)
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, function (_, label, url) {
        var external = /^https?:/.test(url) ? ' rel="noopener noreferrer"' : '';
        return '<a href="' + url + '"' + external + '>' + label + '</a>';
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function print(text, cls) {
    String(text).split('\n').forEach(function (t) {
      var row = el('div', 'br-row' + (cls ? ' ' + cls : ''));
      row.innerHTML = t ? format(t) : '&nbsp;';
      log.appendChild(row);
    });
    scrollDown();
  }
  function scrollDown() { screen.scrollTop = screen.scrollHeight; }

  var fast = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, fast ? 0 : ms); }); }
  async function slow(lines, delay) {
    fast = false; // a key press during the sequence skips the rest of it
    for (var i = 0; i < lines.length; i++) {
      print(lines[i][0], lines[i][1]);
      await sleep(delay || 120);
    }
  }

  function renderBar() {
    pips.innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var pip = el('span', 'br-pip');
      if (state.done || i + 1 < state.level) pip.classList.add('is-done');
      else if (i + 1 === state.level) pip.classList.add('is-current');
      pip.title = (i + 1) + '. ' + lv.title;
      pips.appendChild(pip);
    });
    pips.setAttribute('aria-label', state.done ? 'All missions complete' : 'Mission ' + state.level + ' of 6');
    stars.textContent = '★ ' + Object.keys(state.achievements).length + '/' + Object.keys(ACHIEVEMENTS).length;
  }

  function promptText() {
    if (mode === 'password') return 'Password: ';
    if (mode === 'sql') return 'srath-db> ';
    var path = state.cwd.replace(new RegExp('^/home/' + state.user.replace('.', '\\.') + '(?=/|$)'), '~');
    if (state.user === 'root' && state.cwd === '/root') path = '~';
    return state.user + '@srath:' + path + (state.user === 'root' ? '# ' : '$ ');
  }
  function renderPrompt() {
    prompt.textContent = promptText();
    input.type = mode === 'password' ? 'password' : 'text';
  }

  // ---------------------------------------------------------------------------
  // Filesystem helpers

  function homeOf(user) { return user === 'root' ? '/root' : '/home/' + user; }

  function normalize(path) {
    if (!path || path === '~') path = homeOf(state.user);
    else if (path.indexOf('~/') === 0) path = homeOf(state.user) + path.slice(1);
    if (path[0] !== '/') path = state.cwd + '/' + path;
    var parts = [];
    path.split('/').forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') parts.pop(); else parts.push(p);
    });
    return '/' + parts.join('/');
  }

  function lookup(path) {
    var node = FS;
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (node.type !== 'dir' || !node.children[parts[i]]) return null;
      node = node.children[parts[i]];
    }
    return node;
  }

  function canRead(node) {
    if (!node) return false;
    if (state.user === 'root' || node.owner === 'guest') return true;
    return node.owner === state.user;
  }

  // Returns the node or prints an error and returns null.
  function resolveFor(cmd, arg, want) {
    var path = normalize(arg);
    var node = lookup(path);
    if (!node) { print(cmd + ': ' + arg + ': No such file or directory', 't-err'); return null; }
    // Every folder on the way must be readable too.
    var parts = path.split('/').filter(Boolean), cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      if (!canRead(lookup(cur))) { print(cmd + ': ' + arg + ': Permission denied', 't-err'); return null; }
    }
    if (want === 'file' && node.type === 'dir') { print(cmd + ': ' + arg + ': Is a directory', 't-err'); return null; }
    if (want === 'dir' && node.type !== 'dir') { print(cmd + ': ' + arg + ': Not a directory', 't-err'); return null; }
    return { node: node, path: path };
  }

  // Every readable file below `path`, as [path, node].
  function walk(path, node, out) {
    if (!canRead(node)) return out;
    if (node.type === 'file') { out.push([path, node]); return out; }
    Object.keys(node.children).sort().forEach(function (name) {
      walk((path === '/' ? '' : path) + '/' + name, node.children[name], out);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Progress

  function achieve(id) {
    if (state.achievements[id]) return;
    state.achievements[id] = Date.now();
    print('★ Achievement unlocked: ' + ACHIEVEMENTS[id][0] + ' (' + ACHIEVEMENTS[id][1] + ')', 't-star');
    renderBar();
  }

  // Called whenever a fragment is revealed, however the player got it.
  function reveal(n) {
    if (!state.found[n - 1]) {
      state.found[n - 1] = true;
      print('');
      print('[ FRAGMENT ' + n + '/5 FOUND: ' + FRAGMENTS[n - 1] + ' ]', 't-key');
    }
    advance();
  }

  function advance() {
    var moved = false;
    while (!state.done && state.level <= 5 && state.found[state.level - 1]) {
      print('>> MISSION ' + state.level + ' COMPLETE: ' + LEVELS[state.level - 1].title, 't-ok');
      state.level++;
      moved = true;
    }
    if (moved) {
      print('');
      showMission();
      renderBar();
    }
  }

  function showMission() {
    if (state.done) {
      print('All missions complete. You are root. Explore as much as you like, or type `reset` to play again.', 't-ok');
      return;
    }
    var lv = LEVELS[state.level - 1];
    print('MISSION ' + state.level + '/6 - ' + lv.title.toUpperCase(), 't-head');
    print(lv.goal);
  }

  function clock(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  // ---------------------------------------------------------------------------
  // Commands

  var mode = 'shell'; // 'shell' | 'password' | 'sql'
  var pendingUser = null;

  var COMMANDS = {
    help: function () {
      print('Commands', 't-head');
      [
        ['mission', 'show your current mission'], ['hint', 'get a nudge (counts against you, just a little)'],
        ['status', 'progress, fragments and time'], ['achievements', 'what you have unlocked'],
        ['ls [-a] [path]', 'list files (-a shows hidden ones)'], ['cd <path>', 'change folder'], ['pwd', 'print current folder'],
        ['cat <file>', 'print a file'], ['grep [-r] <text> [path]', 'search inside files'], ['find [path] [-name pattern]', 'find files by name'],
        ['whoami', 'who you are logged in as'], ['su <user>', 'switch user (asks for their password)'], ['exit', 'switch back to guest'],
        ['base64 -d <file>', 'decode Base64'], ['scan <host|10.0.7.0/24>', 'list hosts or open ports'], ['connect <host> <port>', 'open a network connection'],
        ['sql', 'open the database console (once connected)'], ['caesar <shift|--all> <file>', 'Caesar cipher'], ['decrypt <KEY> <file>', 'Vigenere cipher'],
        ['ps', 'running processes'], ['kill <pid>', 'stop a process'], ['submit <code>', 'hand in a fragment you worked out yourself'],
        ['unlock <key>', 'unlock root with the full access key'], ['history', 'commands you have typed'], ['clear', 'clear the screen'],
        ['man <command>', 'more about a command'], ['reset', 'start over from mission 1'],
      ].forEach(function (c) { print('  ' + (c[0] + '                              ').slice(0, 30) + c[1]); });
      print('Tab completes commands and paths. ↑ and ↓ go through your history.', 't-dim');
    },

    mission: function () { showMission(); },

    hint: function () {
      if (state.done) { print('No hints needed. You won.', 't-dim'); return; }
      var i = state.level - 1;
      var step = Math.min(state.hintStep[i], 2);
      print('Hint ' + (step + 1) + '/3: ' + LEVELS[i].hints[step], 't-warn');
      if (state.hintStep[i] < 3) { state.hintStep[i]++; state.hintsUsed++; }
    },

    status: function () {
      print('user       ' + state.user);
      print('mission    ' + (state.done ? 'complete' : state.level + '/6 - ' + LEVELS[state.level - 1].title));
      print('fragments  ' + FRAGMENTS.map(function (f, i) { return state.found[i] ? f : '????'; }).join('-'));
      print('time       ' + clock(state.elapsed));
      print('hints      ' + state.hintsUsed);
      print('stars      ' + Object.keys(state.achievements).length + '/' + Object.keys(ACHIEVEMENTS).length);
    },

    achievements: function () {
      Object.keys(ACHIEVEMENTS).forEach(function (id) {
        var got = state.achievements[id];
        print((got ? '★ ' : '☆ ') + ACHIEVEMENTS[id][0] + (got ? ' - ' + ACHIEVEMENTS[id][1] : ' - ???'), got ? 't-star' : 't-dim');
      });
    },

    clear: function () { log.innerHTML = ''; },

    pwd: function () { print(state.cwd); },

    whoami: function () { print(state.user); achieve('whoami'); },

    id: function () { print('uid=' + ({ root: 0, admin: 1000, guest: 1002 })[state.user] + '(' + state.user + ')'); },

    hostname: function () { print('srath'); },
    uname: function () { print('Linux srath 6.8.0 x86_64 GNU/Linux'); },
    date: function () { print(new Date().toString()); },
    echo: function (args) { print(args.join(' ')); },

    ls: function (args) {
      var all = false, long = false, target = null;
      args.forEach(function (a) {
        if (a[0] === '-' && a.length > 1) { if (a.indexOf('a') !== -1) all = true; if (a.indexOf('l') !== -1) long = true; }
        else target = a;
      });
      var r = resolveFor('ls', target || '.');
      if (!r) return;
      if (r.node.type === 'file') { print(target); return; }
      var names = Object.keys(r.node.children).sort().filter(function (n) { return all || n[0] !== '.'; });
      if (all) names = ['.', '..'].concat(names);
      if (!names.length) { print('(empty)', 't-dim'); return; }
      if (long) {
        names.forEach(function (n) {
          var node = n === '.' || n === '..' ? r.node : r.node.children[n];
          var dir = node.type === 'dir';
          var size = dir ? 4096 : node.content.length;
          print((dir ? 'drwx------ ' : '-rw------- ') + (node.owner + '        ').slice(0, 9) + (String(size) + '      ').slice(0, 6) + (dir ? n + '/' : n), dir ? 't-dir' : '');
        });
        return;
      }
      var row = el('div', 'br-row br-ls');
      row.innerHTML = names.map(function (n) {
        var node = r.node.children[n];
        var dir = n === '.' || n === '..' || node.type === 'dir';
        var slash = dir && n !== '.' && n !== '..' ? '/' : '';
        return '<span class="' + (dir ? 't-dir' : '') + '">' + escapeHtml(n + slash) + '</span>';
      }).join('');
      log.appendChild(row);
      scrollDown();
    },

    cd: function (args) {
      var r = resolveFor('cd', args[0] || '~', 'dir');
      if (r) state.cwd = r.path;
    },

    cat: function (args) {
      if (!args.length) { print('cat: which file? Try `cat README.txt`.', 't-err'); return; }
      args.forEach(function (a) {
        var r = resolveFor('cat', a, 'file');
        if (!r) return;
        print(r.node.content);
        if (r.path === '/home/guest/.bash_history') achieve('history');
        if (r.path === '/var/log/firewall.log') state.readFirewall = true;
      });
    },

    grep: function (args) {
      var recursive = false, ignore = false, rest = [];
      args.forEach(function (a) {
        if (/^-[a-z]+$/i.test(a)) { if (/[rR]/.test(a)) recursive = true; if (/i/.test(a)) ignore = true; }
        else rest.push(a);
      });
      var pattern = rest[0];
      if (!pattern) { print('usage: grep [-r] [-i] <text> [path]', 't-err'); return; }
      var target = rest[1] || '.';
      if (!rest[1]) recursive = true; // no path: search everything below the current folder
      var r = resolveFor('grep', target);
      if (!r) return;
      if (r.node.type === 'dir' && !recursive) { print('grep: ' + target + ': Is a directory (use -r)', 't-err'); return; }
      var needle = ignore ? pattern.toLowerCase() : pattern;
      var hits = 0;
      walk(r.path, r.node, []).forEach(function (entry) {
        entry[1].content.split('\n').forEach(function (l) {
          if ((ignore ? l.toLowerCase() : l).indexOf(needle) !== -1) {
            print((r.node.type === 'dir' ? entry[0] + ': ' : '') + l);
            hits++;
            if (l.indexOf(ADMIN_PASSWORD) !== -1) achieve('grep');
          }
        });
      });
      if (!hits) print('(no matches)', 't-dim');
    },

    find: function (args) {
      var start = '.', pattern = null;
      for (var i = 0; i < args.length; i++) {
        if (args[i] === '-name' || args[i] === '-iname') pattern = (args[++i] || '').replace(/^["']|["']$/g, '');
        else start = args[i];
      }
      var r = resolveFor('find', start);
      if (!r) return;
      var re = pattern ? new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
      var found = 0;
      (function visit(path, node) {
        if (!canRead(node)) return;
        var name = path.split('/').pop();
        if (!re || re.test(name)) { print(path, node.type === 'dir' ? 't-dir' : ''); found++; }
        if (node.type === 'dir') Object.keys(node.children).sort().forEach(function (n) { visit((path === '/' ? '' : path) + '/' + n, node.children[n]); });
      })(r.path, r.node);
      if (!found) print('(nothing found)', 't-dim');
    },

    history: function () {
      state.history.forEach(function (h, i) { print(String(i + 1).padStart(4) + '  ' + h); });
    },

    // su <user>: switch user, like on a real Linux machine. Plain `su` means root. `exit` switches back.
    su: function (args) {
      var user = (args.filter(function (a) { return a[0] !== '-'; })[0] || 'root').replace(/@.*$/, '');
      if (user === state.user) { print('You are already ' + user + '.', 't-dim'); return; }
      if (user === 'guest') { COMMANDS.exit(); return; }
      if (user === 'root') {
        print('Password: ');
        print('su: Authentication failure', 't-err');
        print('(Root has its own password, and nobody wrote that one down. Find another way in.)', 't-dim');
        return;
      }
      if (user === 'tommy') { print('su: Authentication failure (tommy uses a hardware key, which you do not have)', 't-err'); return; }
      if (user === 'ci-bot' || user === 'backup-bot') { print('su: ' + user + ' is a service account and cannot log in', 't-err'); return; }
      if (user !== 'admin') { print('su: user ' + user + ' does not exist', 't-err'); return; }
      if (state.user === 'root') { print('Root does not need passwords. Stay root, though; it suits you.', 't-dim'); return; }
      pendingUser = user;
      mode = 'password';
    },

    base64: function (args) {
      var decode = args.indexOf('-d') !== -1 || args.indexOf('--decode') !== -1;
      var file = args.filter(function (a) { return a[0] !== '-'; })[0];
      if (!file) { print('usage: base64 -d <file>', 't-err'); return; }
      var r = resolveFor('base64', file, 'file');
      if (!r) return;
      if (!decode) { print(btoa(r.node.content).match(/.{1,48}/g).join('\n')); return; }
      var text;
      try { text = atob(r.node.content.replace(/\s+/g, '')); } catch (e) { print('base64: invalid input', 't-err'); return; }
      print(text);
      if (text.indexOf('KEY FRAGMENT 2/5') !== -1) reveal(2);
    },

    scan: function (args) {
      if (state.user === 'guest') { print('scan: permission denied (guest accounts cannot scan the network)', 't-err'); return; }
      var target = args[0];
      if (!target) { print('usage: scan <host>   or   scan 10.0.7.0/24', 't-err'); return; }
      if (/^10\.0\.7\.0\/24$/.test(target)) {
        print('Scanning 10.0.7.0/24 ...', 't-dim');
        Object.keys(HOSTS).forEach(function (h) { print('  ' + (HOSTS[h].ip + '            ').slice(0, 12) + h + '   up'); });
        return;
      }
      var name = hostName(target);
      if (!name) { print('scan: ' + target + ': host not found. `cat /etc/hosts` lists the known hosts.', 't-err'); return; }
      print('Scanning ' + name + ' (' + HOSTS[name].ip + ') ...', 't-dim');
      print('PORT      STATE      SERVICE');
      HOSTS[name].ports.forEach(function (p) {
        print((p[0] + '/tcp          ').slice(0, 10) + (p[1] + '           ').slice(0, 11) + p[2], p[1] === 'open' ? 't-ok' : 't-dim');
      });
      state.scanned[name] = true;
    },

    connect: function (args) {
      if (state.user === 'guest') { print('connect: permission denied (guest accounts cannot open connections)', 't-err'); return; }
      var name = hostName(args[0] || '');
      var port = parseInt(args[1], 10);
      if (!name || !port) { print('usage: connect <host> <port>', 't-err'); return; }
      var entry = HOSTS[name].ports.filter(function (p) { return p[0] === port; })[0];
      if (!entry || entry[1] !== 'open') { print('connect: ' + name + ':' + port + ': Connection refused', 't-err'); return; }
      if (name === 'db.srath') {
        if (!state.scanned['db.srath'] && state.readFirewall) achieve('logdiver');
        state.dbConnected = true;
        print('Connected to db.srath:5433', 't-dim');
        print('srath-db 4.1 ready. Authenticated as admin (read-only).');
        print('Type `sql` to open the query console.');
        print('Session token: KEY FRAGMENT 3/5: 2B8D');
        reveal(3);
      } else if (name === 'mail.srath') {
        print('220 mail.srath ESMTP ready', 't-dim');
        print('1 new message for admin:');
        print('  From: tommy@srath');
        print('  Subject: note to self: the vault table');
        print('  Locked the vault table down. It only returns rows when you filter by owner,');
        print('  so it is safe unless someone knows my username. Which is in the users table. Hm. -- T');
        print('221 Bye', 't-dim');
      } else if (name === 'releases.srath') {
        releases();
      } else {
        print('SSH-2.0-OpenSSH_9.6  (password authentication is disabled)', 't-dim');
      }
    },

    sql: function () {
      if (!state.dbConnected) { print('sql: not connected to a database. Find the database server first.', 't-err'); return; }
      mode = 'sql';
      print('srath-db console. Statements end with ;  Type `exit` to leave.', 't-dim');
    },

    ps: function () {
      print('  PID USER     COMMAND');
      var procs = [[1, 'root', 'init'], [212, 'root', 'sshd'], [530, 'admin', 'srath-db --port 5433']];
      if (state.watchdog) procs.push([417, 'admin', 'watchdog --guard sentinel']);
      if (state.sentinel) procs.push([state.sentinelPid, 'admin', 'sentinel --protect /root']);
      procs.push([999, state.user, 'ps']);
      procs.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (p) {
        print(String(p[0]).padStart(5) + ' ' + (p[1] + '         ').slice(0, 9) + p[2]);
      });
    },

    kill: function (args) {
      var pid = parseInt(args.filter(function (a) { return a[0] !== '-'; })[0], 10);
      if (!pid) { print('usage: kill <pid>   (`ps` lists the pids)', 't-err'); return; }
      if (pid === 1) { print('kill: you cannot kill init. Nice try, though.', 't-err'); return; }
      if (pid === 212) { print('kill: (212) - Operation not permitted', 't-err'); return; }
      if (pid === 530) { print('srath-db: refusing to die. It holds all the good stuff.', 't-warn'); return; }
      if (pid === 999) { print('ps already finished. It was a good process.', 't-dim'); return; }
      if (state.user === 'guest') { print('kill: (' + pid + ') - Operation not permitted', 't-err'); return; }
      if (pid === 417 && state.watchdog) { stopWatchdog(); return; }
      if (pid === state.sentinelPid && state.sentinel) { stopSentinel(); return; }
      print('kill: (' + pid + ') - No such process', 't-err');
    },

    systemctl: function (args) {
      var action = args[0], unit = (args[1] || '').replace(/\.service$/, '');
      if (action === 'status') { print('watchdog  ' + (state.watchdog ? 'active' : 'inactive')); print('sentinel  ' + (state.sentinel ? 'active' : 'inactive')); return; }
      if (action !== 'stop' || !unit) { print('usage: systemctl stop <unit>   |   systemctl status', 't-err'); return; }
      if (state.user === 'guest') { print('systemctl: Access denied', 't-err'); return; }
      if (unit === 'watchdog') { if (state.watchdog) stopWatchdog(); else print('watchdog is not running.', 't-dim'); return; }
      if (unit === 'sentinel') { if (state.sentinel) stopSentinel(); else print('sentinel is not running.', 't-dim'); return; }
      print('systemctl: unit ' + unit + ' not found', 't-err');
    },

    caesar: function (args) {
      var file = args[args.length - 1];
      var r = file && resolveFor('caesar', file, 'file');
      if (!r) { if (!file) print('usage: caesar <shift|--all> <file>', 't-err'); return; }
      if (args[0] === '--all') {
        for (var s = 1; s < 26; s++) print(String(s).padStart(2) + ': ' + shift(r.node.content.split('\n')[0], s));
        print('None of these read like English. Probably not a simple shift.', 't-dim');
        achieve('brute');
        return;
      }
      var n = parseInt(args[0], 10);
      if (isNaN(n)) { print('usage: caesar <shift|--all> <file>', 't-err'); return; }
      print(shift(r.node.content, n));
    },

    decrypt: function (args) {
      var key = (args[0] || '').toUpperCase().replace(/[^A-Z]/g, '');
      var file = args[1];
      if (!key || !file) { print('usage: decrypt <KEY> <file>', 't-err'); return; }
      var r = resolveFor('decrypt', file, 'file');
      if (!r) return;
      var text = vigenere(r.node.content, key);
      print(text);
      if (text.indexOf('KEY FRAGMENT 5/5') !== -1) reveal(5);
      else print('That does not look like English. Wrong key?', 't-dim');
    },

    submit: function (args) {
      var code = (args.join('') || '').toUpperCase().replace(/[^0-9A-F]/g, '');
      if (!code) { print('usage: submit <fragment>', 't-err'); return; }
      if (code === FULL_KEY.replace(/-/g, '')) { COMMANDS.unlock(args); return; }
      var i = FRAGMENTS.indexOf(code);
      if (i === -1) { print('submit: ' + code + ' is not a valid fragment.', 't-err'); return; }
      if (state.found[i]) { print('You already have fragment ' + (i + 1) + '.', 't-dim'); return; }
      print('Fragment accepted.', 't-ok');
      achieve('oldschool');
      reveal(i + 1);
    },

    unlock: function (args) {
      if (state.done) { print('Root is already unlocked.', 't-dim'); return; }
      if (state.level < 6) { print('unlock: the root lock ignores you. Finish the earlier missions first (`mission`).', 't-err'); return; }
      var key = args.join('').toUpperCase().replace(/[^0-9A-F]/g, '');
      if (!key) { print('usage: unlock <full access key>', 't-err'); return; }
      if (state.sentinel) {
        print('SENTINEL: intrusion detected. Unlock aborted.', 't-err');
        print('(The sentinel is still running. `ps` shows it.)', 't-dim');
        return;
      }
      if (key !== FULL_KEY.replace(/-/g, '')) { print('ACCESS DENIED. The fragments must be complete and in order.', 't-err'); return; }
      win();
    },

    man: function (args) {
      var pages = {
        ls: 'ls [-a] [-l] [path]\nLists files. -a includes hidden files (names that start with a dot). -l shows owners.',
        cat: 'cat <file>\nPrints a file to the screen.',
        su: 'su <user>\nSwitch user: asks for that user\'s password and makes you them. Plain `su` means root. `exit` switches back.',
        cd: 'cd <path>\nChanges folder. `cd ..` goes up, `cd ~` goes home, `cd /` goes to the top.',
        grep: 'grep [-r] [-i] <text> [path]\nPrints lines that contain <text>. -r searches every file below a folder. -i ignores case.',
        find: 'find [path] [-name pattern]\nLists files whose name matches the pattern. * matches anything.',
        base64: 'base64 -d <file>\nBase64 turns bytes into letters and digits. -d turns them back.',
        scan: 'scan <host>\nLists the ports of a host and whether they are open. `scan 10.0.7.0/24` lists the hosts that are up.',
        connect: 'connect <host> <port>\nOpens a connection to an open port and shows what answers.',
        sql: 'sql\nOpens the srath-db console. Supports SHOW TABLES, DESCRIBE <table> and SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT.',
        decrypt: 'decrypt <KEY> <file>\nDecrypts a Vigenere cipher. Each letter of the key shifts the letters of the message by a different amount.',
        caesar: 'caesar <shift> <file>\nShifts every letter by the same amount. `caesar --all <file>` tries every shift.',
        kill: 'kill <pid>\nStops a process. `ps` lists them.',
        unlock: 'unlock <key>\nUnlocks root. The key is the five fragments in order, for example AAAA-BBBB-CCCC-DDDD-EEEE.',
        submit: 'submit <fragment>\nIf you decoded a fragment yourself, outside the game, hand it in here.',
      };
      var page = pages[args[0]];
      if (page) print(page); else print('No manual entry for ' + (args[0] || 'nothing') + '. Try `help`.', 't-dim');
    },

    reset: function (args) {
      if (args[0] !== 'confirm') { print('This erases all progress and achievements. Type `reset confirm` to do it.', 't-warn'); return; }
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      state = freshState();
      log.innerHTML = '';
      renderBar();
      boot();
    },

    // Easter eggs ------------------------------------------------------------
    sudo: function (args) {
      if (state.user === 'root') { print('You are already root. With great power, etc.'); return; }
      if (args[0] === 'make' && args[1] === 'me' && args[2] === 'a' && args[3] === 'sandwich') print('Okay.', 't-ok');
      else print(state.user + ' is not in the sudoers file. This incident will be reported.', 't-err');
      achieve('sudo');
    },
    rm: function (args) {
      if (args.join(' ').replace(/\s+/g, ' ').indexOf('-rf /') !== -1 || (args.indexOf('-rf') !== -1 && args.indexOf('/') !== -1)) {
        busy = true;
        slow([['Deleting /bin ...', 't-err'], ['Deleting /etc ...', 't-err'], ['Deleting /home ...', 't-err'], ['Deleting /usr/share/sense-of-humour ...', 't-err'], ['', ''], ['Just kidding. SRATH is fine. You are on a watch list now, though.', 't-warn']], 260).then(function () {
          achieve('rmrf'); busy = false; save(); renderPrompt();
        });
        return;
      }
      print('rm: this is someone else\'s computer. Let\'s not.', 't-err');
    },
    hack: function () { print('That is not how any of this works. Try `mission`.', 't-dim'); },
    exit: function () {
      if (state.user === 'admin') {
        state.user = 'guest';
        state.cwd = '/home/guest';
        print('logout', 't-dim');
        return;
      }
      if (state.user === 'root') { print('You are root. Why would you ever leave?', 't-dim'); return; }
      print('There is no exit. Only root.', 't-dim');
    },
    vim: function () { print('You are now trapped in vim. Just kidding: there is no vim here. You are free.', 't-dim'); },
    nano: function () { print('nano: editing is disabled. This is a read-only adventure.', 't-dim'); },
    ping: function (args) {
      var name = hostName(args[0] || '');
      if (!name) { print('ping: unknown host', 't-err'); return; }
      print('64 bytes from ' + HOSTS[name].ip + ': time=0.4 ms\n64 bytes from ' + HOSTS[name].ip + ': time=0.3 ms\n--- ' + name + ' is alive ---');
    },
    coffee: function () { print('Brewing... ☕ Error 418: I\'m a teapot.', 't-dim'); },
  };

  var ALIASES = { login: 'su', logout: 'exit', ssh: 'su', dir: 'ls', type: 'cat', less: 'cat', more: 'cat', head: 'cat', nmap: 'scan', nc: 'connect', telnet: 'connect', '?': 'help', cls: 'clear', quit: 'exit', logoff: 'exit', vi: 'vim' };

  function hostName(target) {
    target = (target || '').toLowerCase();
    if (HOSTS[target]) return target;
    if (HOSTS[target + '.srath']) return target + '.srath';
    return Object.keys(HOSTS).filter(function (h) { return HOSTS[h].ip === target; })[0] || null;
  }

  function shift(text, n) {
    return text.replace(/[A-Z]/g, function (c) { return String.fromCharCode(((c.charCodeAt(0) - 65 + n) % 26 + 26) % 26 + 65); });
  }
  function vigenere(text, key) {
    var j = 0;
    return text.replace(/[A-Z]/g, function (c) {
      var k = key.charCodeAt(j++ % key.length) - 65;
      return String.fromCharCode((c.charCodeAt(0) - 65 - k + 26) % 26 + 65);
    });
  }

  function stopWatchdog() {
    state.watchdog = false;
    print('watchdog (417) stopped.', 't-ok');
    if (state.sentinel) print('The sentinel is unguarded now.', 't-dim');
  }
  function stopSentinel() {
    if (state.watchdog) {
      state.sentinelPid++;
      print('sentinel stopped... watchdog restarted it as pid ' + state.sentinelPid + '.', 't-warn');
      return;
    }
    state.sentinel = false;
    print('sentinel (' + state.sentinelPid + ') stopped. Nothing is watching /root anymore.', 't-ok');
  }

  // The release server lists SRATH's real projects. Update it when a project is added.
  function releases() {
    print('220 releases.srath FTP (anonymous access, read-only)', 't-dim');
    print('Listing /pub ...', 't-dim');
    print('');
    print('Everything SRATH has shipped or is working on:', 't-head');
    print('');
    print('  ever-after/      a wedding planner for Android        [[srath.dk/apps/ever-after|/apps/ever-after/]]');
    print('  kvit-og-frit/    a receipt and warranty keeper        [[srath.dk/apps/kvit-og-frit|/apps/kvit-og-frit/]]');
    print('  regnorm/         plant care that follows the weather  [[srath.dk/apps/regnorm|/apps/regnorm/]]');
    print('  gridword/        a daily five-letter word game        [[srath.dk/games/gridword|/games/gridword/]]');
    print('  baiganyo/        a webshop, opening soon              [[baiganyo.dk|https://baiganyo.dk]]');
    print('  breach/          [classified]', 't-dim');
    print('');
    print('226 Transfer complete. (None of this helps with the mission. Worth a look, though.)', 't-dim');
    achieve('archivist');
  }

  async function win() {
    busy = true;
    state.done = true;
    state.user = 'root';
    state.cwd = '/root';
    await slow([
      ['Verifying access key ...', 't-dim'],
      ['  ' + FRAGMENTS[0] + '  ok', 't-ok'], ['  ' + FRAGMENTS[1] + '  ok', 't-ok'], ['  ' + FRAGMENTS[2] + '  ok', 't-ok'],
      ['  ' + FRAGMENTS[3] + '  ok', 't-ok'], ['  ' + FRAGMENTS[4] + '  ok', 't-ok'],
      ['', ''],
    ], 220);
    print([
      ' ____   ___    ___   _____',
      '|  _ \\ / _ \\  / _ \\ |_   _|',
      '| |_) | | | || | | |  | |',
      '|  _ <| |_| || |_| |  | |',
      '|_| \\_\\\\___/  \\___/   |_|',
    ].join('\n'), 't-key br-art');
    await sleep(300);
    print('');
    print('ROOT ACCESS GRANTED. You found the access key.', 't-ok');
    print('Time ' + clock(state.elapsed) + '   ·   hints used ' + state.hintsUsed + '   ·   ' + Object.keys(state.achievements).length + ' achievements before this');
    if (!state.hintsUsed) achieve('ghost');
    if (state.elapsed < 15 * 60) achieve('speed');
    print('');
    print('The vault is open: [[open the vault|' + VAULT_URL + ']]', 't-head');
    print('You are root now. Look around (`ls /root`), check `achievements`, or `reset confirm` to play again.', 't-dim');
    renderBar();
    busy = false;
    save();
    renderPrompt();
  }

  // ---------------------------------------------------------------------------
  // SQL console

  function sqlStatement(text) {
    var q = text.trim().replace(/;+\s*$/, '').trim();
    if (!q) return;
    if (/^(exit|quit|\\q)$/i.test(q)) { mode = 'shell'; print('Bye.', 't-dim'); return; }
    if (/^help$/i.test(q)) { print('SHOW TABLES;  DESCRIBE <table>;  SELECT <columns|*> FROM <table> [WHERE ...] [ORDER BY col] [LIMIT n];  exit', 't-dim'); return; }
    if (/^(drop|delete|update|insert|alter|truncate)\b/i.test(q)) { print('ERROR: read-only connection. (Also: rude.)', 't-err'); return; }
    if (/^show\s+tables$/i.test(q)) { table(['table'], Object.keys(DB).map(function (t) { return [t]; })); return; }
    var m = q.match(/^(?:describe|desc)\s+(\w+)$/i);
    if (m) {
      var t = DB[m[1].toLowerCase()];
      if (!t) { print('ERROR: no such table: ' + m[1], 't-err'); return; }
      table(['column'], t.cols.map(function (c) { return [c]; }));
      return;
    }
    m = q.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i);
    if (!m) { print('ERROR: syntax error. Type `help` for what this console understands.', 't-err'); return; }
    var name = m[2].toLowerCase(), tbl = DB[name];
    if (!tbl) { print('ERROR: no such table: ' + m[2], 't-err'); return; }
    var cols = m[1].trim() === '*' ? tbl.cols : m[1].split(',').map(function (c) { return c.trim().toLowerCase(); });
    for (var i = 0; i < cols.length; i++) if (tbl.cols.indexOf(cols[i]) === -1) { print('ERROR: no such column: ' + cols[i], 't-err'); return; }
    if (name === 'vault' && !m[3]) { print('ERROR: row-level security. The vault only returns rows filtered by owner (WHERE owner = ...).', 't-err'); return; }

    var rows = tbl.rows.slice(), cheated = false;
    if (m[3]) {
      var where;
      try { where = parseWhere(m[3], tbl); } catch (e) { print('ERROR: ' + e.message, 't-err'); return; }
      cheated = where.tautology;
      rows = rows.filter(where.test);
    }
    if (m[4]) {
      var ci = tbl.cols.indexOf(m[4].toLowerCase());
      if (ci === -1) { print('ERROR: no such column: ' + m[4], 't-err'); return; }
      var dir = (m[5] || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      rows.sort(function (a, b) { return a[ci] > b[ci] ? dir : a[ci] < b[ci] ? -dir : 0; });
    }
    if (m[6]) rows = rows.slice(0, parseInt(m[6], 10));
    table(cols, rows.map(function (r) { return cols.map(function (c) { return r[tbl.cols.indexOf(c)]; }); }));
    if (name === 'vault' && cheated && rows.length) achieve('bobby');
    if (name === 'vault' && rows.some(function (r) { return String(r[2]).indexOf('KEY FRAGMENT 4/5') !== -1; }) && cols.indexOf('fragment') !== -1) reveal(4);
  }

  // WHERE with =, !=, <>, <, >, <=, >=, LIKE, joined by AND / OR (AND binds tighter).
  function parseWhere(text, tbl) {
    var tautology = false;
    var groups = text.split(/\s+or\s+/i).map(function (group) {
      return group.split(/\s+and\s+/i).map(function (cond) {
        var c = cond.trim().match(/^(\w+|'[^']*'|"[^"]*"|\d+)\s*(=|==|!=|<>|<=|>=|<|>|like)\s*('[^']*'|"[^"]*"|[\w.]+)$/i);
        if (!c) throw new Error('cannot understand condition: ' + cond.trim());
        var left = operand(c[1], tbl), right = operand(c[3], tbl);
        if (left.literal && right.literal) tautology = tautology || compare(left.value, c[2], right.value);
        return function (row) { return compare(left.get(row), c[2], right.get(row)); };
      });
    });
    return {
      tautology: tautology,
      test: function (row) { return groups.some(function (g) { return g.every(function (f) { return f(row); }); }); },
    };
  }
  function operand(token, tbl) {
    if (/^['"]/.test(token)) { var s = token.slice(1, -1); return { literal: true, value: s, get: function () { return s; } }; }
    if (/^\d+$/.test(token)) { var n = Number(token); return { literal: true, value: n, get: function () { return n; } }; }
    var i = tbl.cols.indexOf(token.toLowerCase());
    if (i === -1) throw new Error('no such column: ' + token);
    return { literal: false, get: function (row) { return row[i]; } };
  }
  function compare(a, op, b) {
    op = op.toLowerCase();
    if (op === 'like') return new RegExp('^' + String(b).replace(/[.+^${}()|[\]\\*?]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(String(a));
    if (typeof a === 'number' || typeof b === 'number') { a = Number(a); b = Number(b); } else { a = String(a).toLowerCase(); b = String(b).toLowerCase(); }
    switch (op) {
      case '=': case '==': return a === b;
      case '!=': case '<>': return a !== b;
      case '<': return a < b; case '>': return a > b;
      case '<=': return a <= b; case '>=': return a >= b;
    }
    return false;
  }

  function table(cols, rows) {
    var widths = cols.map(function (c, i) {
      return Math.max(String(c).length, Math.max.apply(null, rows.map(function (r) { return String(r[i]).length; }).concat(0)));
    });
    var rule = '+' + widths.map(function (w) { return '-'.repeat(w + 2); }).join('+') + '+';
    var fmt = function (r) { return '| ' + r.map(function (v, i) { return (String(v) + ' '.repeat(widths[i])).slice(0, widths[i]); }).join(' | ') + ' |'; };
    print([rule, fmt(cols), rule].concat(rows.map(fmt), [rule]).join('\n'));
    print(rows.length + ' row' + (rows.length === 1 ? '' : 's'), 't-dim');
  }

  // ---------------------------------------------------------------------------
  // Running commands

  var busy = false;
  var historyIndex = null;

  function tokenize(text) {
    var out = [], m, re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    while ((m = re.exec(text))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
    return out;
  }

  function run(text) {
    var echo = el('div', 'br-row br-echo');
    echo.innerHTML = '<span class="br-p">' + escapeHtml(promptText()) + '</span>' + escapeHtml(mode === 'password' ? '•'.repeat(text.length) : text);
    log.appendChild(echo);

    if (mode === 'password') {
      mode = 'shell';
      if (text === ADMIN_PASSWORD) {
        state.user = pendingUser;
        state.cwd = homeOf(pendingUser);
        print('You have new mail in /var/mail/admin.');
        print('admin session key: KEY FRAGMENT 1/5: 7F3A');
        reveal(1);
      } else {
        print('su: Authentication failure', 't-err');
      }
      return;
    }

    if (text.trim()) {
      state.history.push(text);
      if (state.history.length > 200) state.history.shift();
    }
    if (mode === 'sql') { sqlStatement(text); return; }

    var args = tokenize(text);
    if (!args.length) return;
    var name = args.shift().toLowerCase();
    name = ALIASES[name] || name;
    var cmd = COMMANDS[name];
    if (!cmd) { print(name + ': command not found. Type `help` for the list.', 't-err'); return; }
    achieve('first');
    cmd(args);
  }

  function submitLine() {
    if (busy) return;
    var text = input.value;
    input.value = '';
    historyIndex = null;
    run(text);
    renderPrompt();
    save();
    scrollDown();
  }

  // Tab completion for commands, paths and hosts.
  function complete() {
    var value = input.value;
    var parts = value.split(' ');
    var word = parts[parts.length - 1];
    var options;
    if (mode !== 'shell') return;
    if (parts.length === 1) {
      options = Object.keys(COMMANDS).filter(function (c) { return c.indexOf(word) === 0; });
    } else if (/^(scan|connect|nc|telnet|nmap|ping)$/.test(parts[0])) {
      options = Object.keys(HOSTS).filter(function (h) { return h.indexOf(word) === 0; });
    } else {
      var slash = word.lastIndexOf('/');
      var dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
      var base = word.slice(slash + 1);
      var dir = lookup(normalize(dirPart || '.'));
      if (!dir || dir.type !== 'dir' || !canRead(dir)) return;
      options = Object.keys(dir.children)
        .filter(function (n) { return n.indexOf(base) === 0 && (base[0] === '.' || n[0] !== '.'); })
        .map(function (n) { return dirPart + n + (dir.children[n].type === 'dir' ? '/' : ''); });
    }
    if (!options.length) return;
    if (options.length === 1) {
      parts[parts.length - 1] = options[0] + (options[0].slice(-1) === '/' ? '' : ' ');
      input.value = parts.join(' ');
      return;
    }
    // Several matches: complete the common prefix and list them.
    var prefix = options.reduce(function (a, b) { var i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
    if (prefix.length > word.length) { parts[parts.length - 1] = prefix; input.value = parts.join(' '); }
    else print(options.join('   '), 't-dim');
  }

  function recall(dir) {
    if (!state.history.length || mode === 'password') return;
    if (historyIndex === null) historyIndex = state.history.length;
    historyIndex = Math.max(0, Math.min(state.history.length, historyIndex + dir));
    input.value = state.history[historyIndex] || '';
    setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
  }

  input.addEventListener('keydown', function (e) {
    if (busy && e.key !== 'Enter') { fast = true; }
    if (e.key === 'Enter') { e.preventDefault(); submitLine(); }
    else if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); recall(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); recall(1); }
    else if (e.key === 'Escape' && mode === 'password') { mode = 'shell'; print('su: cancelled', 't-dim'); renderPrompt(); }
    else if (e.key.toLowerCase() === 'l' && e.ctrlKey) { e.preventDefault(); log.innerHTML = ''; }
    else if (e.key.toLowerCase() === 'c' && e.ctrlKey && !e.shiftKey && !hasSelection()) { e.preventDefault(); interrupt(); }
  });

  // Text selected in the input or the output means Ctrl+C should copy it, as usual.
  function hasSelection() {
    return input.selectionStart !== input.selectionEnd || String(window.getSelection()).length > 0;
  }

  // Ctrl+C: abandon the current line like a real shell, showing ^C and a fresh prompt.
  function interrupt() {
    if (busy) { fast = true; return; }
    var echo = el('div', 'br-row br-echo');
    var typed = mode === 'password' ? '' : input.value;
    echo.innerHTML = '<span class="br-p">' + escapeHtml(promptText()) + '</span>' + escapeHtml(typed) + '<span class="t-dim">^C</span>';
    log.appendChild(echo);
    input.value = '';
    historyIndex = null;
    if (mode === 'password') mode = 'shell';
    renderPrompt();
    scrollDown();
  }

  keys.addEventListener('click', function (e) {
    var b = e.target.closest('.br-key');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'tab') complete();
    else if (act === 'up') recall(-1);
    else if (act === 'down') recall(1);
    else { input.value = act; submitLine(); }
    input.focus();
  });

  // Clicking anywhere on the screen focuses the prompt, unless the visitor is selecting text or clicking a link.
  screen.addEventListener('click', function (e) {
    if (e.target.closest('a') || String(window.getSelection())) return;
    input.focus({ preventScroll: true });
  });

  // Count playing time only while the page is visible and the game is unfinished.
  setInterval(function () {
    if (!document.hidden && state.booted && !state.done && state.history.length) {
      state.elapsed++;
      if (state.elapsed % 10 === 0) save();
    }
  }, 1000);

  // ---------------------------------------------------------------------------
  // Start

  async function boot() {
    busy = true;
    fast = false;
    renderPrompt();
    await slow([
      ['BREACH:// v1.0', 't-key'],
      ['Opening tunnel to 10.0.7.5 ...', 't-dim'],
      ['Connected to srath. You are logged in as guest.', 't-dim'],
      ['', ''],
    ], 260);
    print(FS.children.home.children.guest.children['README.txt'].content);
    print('');
    showMission();
    print('Tip: start with `ls` and `cat README.txt`. Press Tab to complete names.', 't-dim');
    state.booted = true;
    busy = false;
    save();
    renderPrompt();
  }

  function resume() {
    print('BREACH:// session restored.', 't-key');
    print('Logged in as ' + state.user + '. Time so far ' + clock(state.elapsed) + '.', 't-dim');
    print('');
    showMission();
    renderPrompt();
  }

  renderBar();
  if (state.booted) resume(); else boot();
  if (window.matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
})();
