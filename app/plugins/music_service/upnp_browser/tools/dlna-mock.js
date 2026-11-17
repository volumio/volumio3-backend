'use strict';

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const os = require('os');

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const basePort = parseInt((flags.find((f) => f.startsWith('--port=')) || '--port=8200').split('=')[1], 10);
const realLatency = flags.indexOf('--latency') >= 0;
const ssdp = flags.indexOf('--no-ssdp') < 0;

if (!files.length) {
  console.error('usage: node dlna-mock.js <capture.json>... [--port=8200] [--latency] [--no-ssdp]');
  process.exit(1);
}

function tag (xml, name) {
  const m = new RegExp('<(?:[\\w-]+:)?' + name + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>').exec(xml);
  return m ? m[1].trim() : '';
}

function unescapeXml (s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function localIp () {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

const fault = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>701</errorCode><errorDescription>No such object (not in capture)</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>';

const servers = files.map((file, i) => {
  const cap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exchanges = fs.readFileSync(file.replace(/capture\.json$/, 'exchanges.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const port = basePort + i;
  const udn = 'uuid:mock-' + i + '-' + cap.info.udn.replace(/^uuid:/, '');
  const description = cap.description
    .replace(/<UDN>[^<]*<\/UDN>/, '<UDN>' + udn + '</UDN>')
    .replace(/<friendlyName>([^<]*)<\/friendlyName>/, '<friendlyName>$1 (mock)</friendlyName>')
    .replace(/<URLBase>[^<]*<\/URLBase>/, '');
  const exact = new Map();
  const loose = new Map();
  exchanges.forEach((x) => {
    exact.set([x.objectId, x.browseFlag, x.startingIndex, x.requestedCount].join('|'), x);
    loose.set([x.objectId, x.browseFlag, x.startingIndex].join('|'), x);
  });

  http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
      return res.end(description);
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const id = unescapeXml(tag(body, 'ObjectID'));
      const flag = tag(body, 'BrowseFlag');
      const start = parseInt(tag(body, 'StartingIndex'), 10) || 0;
      const count = parseInt(tag(body, 'RequestedCount'), 10) || 0;
      const x = exact.get([id, flag, start, count].join('|')) || loose.get([id, flag, start].join('|'));
      console.log((x ? 'HIT ' : 'MISS') + ' ' + cap.info.friendlyName + ' ' + flag + ' id=' + id + ' start=' + start + ' count=' + count);
      const send = () => {
        if (!x || x.error) {
          res.writeHead(500, { 'Content-Type': 'text/xml; charset="utf-8"' });
          return res.end(fault);
        }
        res.writeHead(x.status, { 'Content-Type': (x.headers && x.headers['content-type']) || 'text/xml; charset="utf-8"' });
        res.end(x.body);
      };
      setTimeout(send, realLatency && x ? x.ms : 0);
    });
  }).listen(port, () => console.log('mock "' + cap.info.friendlyName + '" on http://' + localIp() + ':' + port + '/description.xml'));

  return { port: port, udn: udn };
});

if (ssdp) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (buf, rinfo) => {
    const msg = buf.toString();
    if (!/^M-SEARCH/i.test(msg)) return;
    const st = ((/^st:\s*(.+)$/im.exec(msg) || [])[1] || '').trim();
    if (!/^(ssdp:all|upnp:rootdevice|urn:schemas-upnp-org:device:MediaServer:1)$/.test(st)) return;
    servers.forEach((s) => {
      const reply = [
        'HTTP/1.1 200 OK',
        'CACHE-CONTROL: max-age=1800',
        'EXT:',
        'LOCATION: http://' + localIp() + ':' + s.port + '/description.xml',
        'SERVER: Linux UPnP/1.0 dlna-mock/1',
        'ST: ' + st,
        'USN: ' + s.udn + '::' + st,
        '', ''
      ].join('\r\n');
      sock.send(reply, rinfo.port, rinfo.address);
    });
  });
  sock.on('error', (e) => console.error('SSDP: ' + e.message + ' (use --no-ssdp and point the client at the URL)'));
  sock.bind(1900, () => sock.addMembership('239.255.255.250'));
}
