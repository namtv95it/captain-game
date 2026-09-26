/**
 * server.js - TikTok Live Bridge Server + Static File Server
 * Chay: node server.js
 *
 * Port 3456 -> API Bridge (SSE + REST)
 * Port 5500 -> Phuc vu file HTML (control.html, index.html, ...)
 *
 * Su dung TikTokLiveConnection (tiktok-live-connector v2.x) - giong dancing-tiktok
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

const API_PORT = 3456;
const WEB_PORT = 5500;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

var tiktokConnection = null;
var currentUsername = null;
var sseClients = [];

function broadcast(eventType, data) {
  var payload = 'event: ' + eventType + '\ndata: ' + JSON.stringify(data) + '\n\n';
  sseClients = sseClients.filter(function(res) {
    try { res.write(payload); return true; } catch(e) { return false; }
  });
}

function connectToLive(username) {
  // Ngat ket noi cu
  if (tiktokConnection) {
    try {
      tiktokConnection.removeAllListeners();
      tiktokConnection.disconnect();
    } catch(e) {}
    tiktokConnection = null;
  }

  currentUsername = username;
  broadcast('status', { state: 'connecting', username: username });
  console.log('[TikTok] Dang ket noi toi @' + username + '...');

  // Dung TikTokLiveConnection (v2.x) - giong dancing-tiktok da hoat dong
  tiktokConnection = new TikTokLiveConnection(username, {});

  tiktokConnection.connect()
    .then(function(state) {
      console.log('[TikTok] Da ket noi @' + username + ' | Room ID: ' + (state.roomId || '?'));
      broadcast('status', { state: 'connected', username: username, roomId: state.roomId });
    })
    .catch(function(err) {
      console.error('[TikTok] Loi ket noi @' + username + ':', err.message);
      broadcast('status', { state: 'failed', username: username, error: err.message });
      tiktokConnection = null;
    });

  // Helper lay thong tin user tu payload v2.x
  function getUserInfo(data) {
    var u = data.user || data;
    var uniqueId = u.displayId || u.uniqueId || u.id || ('user_' + Date.now());
    var nickname = u.nickname || uniqueId;
    return { uniqueId: uniqueId, nickname: nickname };
  }

  // FOLLOW (social event chua follow hoac member)
  tiktokConnection.on(WebcastEvent.FOLLOW, function(data) {
    var u = getUserInfo(data);
    console.log('[Follow] @' + u.uniqueId + ' (' + u.nickname + ')');
    broadcast('follow', { uniqueId: u.uniqueId, nickname: u.nickname });
  });

  tiktokConnection.on('follow', function(data) {
    var u = getUserInfo(data);
    console.log('[Follow] @' + u.uniqueId);
    broadcast('follow', { uniqueId: u.uniqueId, nickname: u.nickname });
  });

  // SHARE
  tiktokConnection.on(WebcastEvent.SHARE, function(data) {
    var u = getUserInfo(data);
    console.log('[Share] @' + u.uniqueId);
    broadcast('share', { uniqueId: u.uniqueId, nickname: u.nickname });
  });

  tiktokConnection.on('share', function(data) {
    var u = getUserInfo(data);
    console.log('[Share] @' + u.uniqueId);
    broadcast('share', { uniqueId: u.uniqueId, nickname: u.nickname });
  });

  // GIFT
  tiktokConnection.on(WebcastEvent.GIFT, function(data) {
    if (data.giftType === 1 && !data.repeatEnd) return;
    var u = getUserInfo(data);
    var repeat = data.repeatCount || 1;
    var diamonds = data.diamondCount || 0;
    var coins = diamonds * repeat;
    if (coins <= 0) coins = repeat; // default it nhat 1 xu
    var giftName = data.extendedGiftInfo?.name || data.giftName || data.name || 'Quà';
    console.log('[Gift] @' + u.uniqueId + ' tang ' + giftName + ' x' + repeat + ' = ' + coins + ' xu');
    broadcast('gift', {
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      giftName: giftName,
      giftId: data.giftId,
      repeatCount: repeat,
      diamondCount: diamonds,
      totalCoins: coins,
    });
  });

  // COMMENT (CHAT)
  tiktokConnection.on(WebcastEvent.CHAT, function(data) {
    var u = getUserInfo(data);
    var commentText = data.content || data.comment || '';
    console.log('[Chat] @' + u.uniqueId + ': ' + commentText);
    broadcast('comment', {
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      comment: commentText,
    });
  });

  // LIKE
  tiktokConnection.on(WebcastEvent.LIKE, function(data) {
    var u = getUserInfo(data);
    var count = data.likeCount || 1;
    broadcast('like', {
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      likeCount: count,
    });
  });

  tiktokConnection.on('disconnected', function() {
    console.log('[TikTok] Da ngat ket noi @' + username);
    broadcast('status', { state: 'disconnected', username: username });
    tiktokConnection = null;
  });

  tiktokConnection.on('error', function(err) {
    console.error('[TikTok] Loi:', err.message || err);
    broadcast('error', { message: err.message || String(err) });
  });
}

// API Server (port 3456)
var apiServer = http.createServer(function(req, res) {
  var url = new URL(req.url, 'http://localhost:' + API_PORT);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    var initData = JSON.stringify({ state: tiktokConnection ? 'connected' : 'disconnected', username: currentUsername });
    res.write('event: status\ndata: ' + initData + '\n\n');
    var hb = setInterval(function() { try { res.write(': heartbeat\n\n'); } catch(e) { clearInterval(hb); } }, 15000);
    sseClients.push(res);
    req.on('close', function() { clearInterval(hb); sseClients = sseClients.filter(function(c) { return c !== res; }); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/connect') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var parsed = JSON.parse(body);
        var username = parsed.username;
        if (!username || !username.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Thieu username' }));
          return;
        }
        connectToLive(username.trim().replace(/^@/, ''));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/disconnect') {
    if (tiktokConnection) {
      try { tiktokConnection.removeAllListeners(); tiktokConnection.disconnect(); } catch(e) {}
      tiktokConnection = null;
    }
    broadcast('status', { state: 'disconnected', username: currentUsername });
    currentUsername = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, connected: !!tiktokConnection, username: currentUsername, clients: sseClients.length }));
    return;
  }

  // POST /test - Gui su kien gia de kiem tra SSE pipeline
  if (req.method === 'POST' && url.pathname === '/test') {
    var body2 = '';
    req.on('data', function(chunk) { body2 += chunk; });
    req.on('end', function() {
      try {
        var d = JSON.parse(body2);
        var type = d.type || 'comment';
        var user = d.uniqueId || 'test_viewer';
        if (type === 'comment') {
          broadcast('comment', { uniqueId: user, nickname: d.nickname || user, comment: d.comment || 'Hello test!' });
        } else if (type === 'follow') {
          broadcast('follow', { uniqueId: user, nickname: d.nickname || user });
        } else if (type === 'gift') {
          broadcast('gift', { uniqueId: user, nickname: d.nickname || user, giftName: d.giftName || 'Rose', totalCoins: d.totalCoins || 1, repeatCount: 1, diamondCount: 1 });
        } else if (type === 'share') {
          broadcast('share', { uniqueId: user, nickname: d.nickname || user });
        }
        console.log('[TEST] Broadcast su kien:', type, 'tu @' + user + ' -> ' + sseClients.length + ' clients');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, type: type, clients: sseClients.length }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Static File Server (port 5500)
var webServer = http.createServer(function(req, res) {
  var urlPath = new URL(req.url, 'http://localhost:' + WEB_PORT).pathname;
  if (urlPath === '/' || urlPath === '') urlPath = '/control.html';

  var filePath = path.join(__dirname, urlPath);
  if (urlPath === '/captain.png' || urlPath === '/../captain.png') {
    filePath = path.join(__dirname, 'captain.png');
  } else if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, function(err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found: ' + urlPath); return; }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

apiServer.listen(API_PORT, function() {
  console.log('');
  console.log('========================================================');
  console.log('   TikTok Live Bridge - Game Xep Bong');
  console.log('========================================================');
  console.log('  Bang dieu khien -> http://localhost:' + WEB_PORT + '/control.html');
  console.log('  Man hinh game   -> http://localhost:' + WEB_PORT + '/index.html');
  console.log('  API Bridge      -> http://localhost:' + API_PORT);
  console.log('========================================================');
  console.log('');
});

webServer.listen(WEB_PORT, function() {
  console.log('[Web] Phuc vu file tai http://localhost:' + WEB_PORT);
});

process.on('SIGINT', function() {
  console.log('\nDang tat server...');
  if (tiktokConnection) { try { tiktokConnection.disconnect(); } catch(e) {} }
  process.exit(0);
});