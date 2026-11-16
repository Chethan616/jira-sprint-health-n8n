// Minimal SMTP sink for tests: accepts any login, stores every message, and can
// be told to reject the next N messages (to test the email-failure path).
//   SMTP on :2525, control HTTP on :2526
//   GET  /messages            -> stored messages
//   POST /__control {"reset":true} | {"rejectNext":2}
const net = require('net');
const http = require('http');

const SMTP_PORT = Number(process.env.SINK_SMTP_PORT || 2525);
const HTTP_PORT = Number(process.env.SINK_HTTP_PORT || 2526);
let messages = [];
let rejectNext = 0;
let events = [];

net.createServer((sock) => {
  let buf = '';
  let mode = 'cmd';
  let cur = null;
  let authStep = null;
  const say = (s) => sock.write(s + '\r\n');
  say('220 smtp-sink ESMTP ready');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    while (true) {
      if (mode === 'data') {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        const raw = buf.slice(0, end);
        buf = buf.slice(end + 5);
        mode = 'cmd';
        const head = raw.split('\r\n\r\n')[0];
        const subject = (head.match(/^Subject: (.*(?:\r\n[ \t].*)*)/mi) || [])[1] || '';
        messages.push({ from: cur.from, to: cur.to, subject: subject.replace(/\r\n[ \t]/g, ' '), size: raw.length, receivedAt: new Date().toISOString(), raw });
        events.push({ at: new Date().toISOString(), event: 'accepted', subject: messages[messages.length - 1].subject });
        say('250 2.0.0 queued');
        continue;
      }
      const nl = buf.indexOf('\r\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      if (authStep === 'user') { authStep = 'pass'; say('334 UGFzc3dvcmQ6'); continue; }
      if (authStep === 'pass' || authStep === 'plain') { authStep = null; say('235 2.7.0 Authentication successful'); continue; }
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO') { say('250-smtp-sink'); say('250-AUTH PLAIN LOGIN'); say('250 8BITMIME'); }
      else if (cmd === 'HELO') say('250 smtp-sink');
      else if (cmd === 'AUTH') {
        const [, mech, initial] = line.split(' ');
        if (/LOGIN/i.test(mech)) { authStep = 'user'; say('334 VXNlcm5hbWU6'); }
        else if (initial) say('235 2.7.0 Authentication successful');
        else { authStep = 'plain'; say('334 '); }
      } else if (cmd === 'MAIL') { cur = { from: line.slice(10).trim(), to: [] }; say('250 OK'); }
      else if (cmd === 'RCPT') { cur.to.push(line.slice(8).trim()); say('250 OK'); }
      else if (cmd === 'DATA') {
        if (rejectNext > 0) { rejectNext -= 1; events.push({ at: new Date().toISOString(), event: 'rejected', to: cur.to }); say('554 5.7.1 mock: message rejected'); }
        else { mode = 'data'; say('354 End data with <CR><LF>.<CR><LF>'); }
      } else if (cmd === 'RSET' || cmd === 'NOOP') say('250 OK');
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('502 not implemented');
    }
  });
  sock.on('error', () => {});
}).listen(SMTP_PORT, () => console.log(`smtp sink on :${SMTP_PORT}`));

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/events')) return res.end(JSON.stringify(events));
    if (req.url.startsWith('/messages')) return res.end(JSON.stringify(messages));
    if (req.url.startsWith('/__control')) {
      const c = JSON.parse(body || '{}');
      if (c.reset) { messages = []; rejectNext = 0; events = []; }
      if (c.rejectNext != null) rejectNext = c.rejectNext;
      return res.end(JSON.stringify({ ok: true, rejectNext }));
    }
    res.statusCode = 404; res.end('{}');
  });
}).listen(HTTP_PORT, () => console.log(`smtp sink control on :${HTTP_PORT}`));
