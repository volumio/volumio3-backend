'use strict';

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = parseArgs(process.argv.slice(2));
const DEPTH = num(args.depth, 3);
const FANOUT = num(args.fanout, 10);
const COUNT = num(args.count, 1000);
const MAX_PAGES = num(args['max-pages'], 200);
const MAX_REQUESTS = num(args['max-requests'], 3000);
const TIMEOUT = num(args.timeout, 60000);
const MAX_BYTES = num(args['max-mb'], 300) * 1048576;
let written = 0;
const VOLUMIO_UA = 'Android UPnP/1.0 DLNADOC/1.50';

function parseArgs (argv) {
  const out = { location: [], id: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    if (Array.isArray(out[key])) out[key].push(val); else out[key] = val;
  }
  return out;
}

function num (v, d) {
  const n = parseInt(v, 10);
  return isNaN(n) ? d : n;
}

function log (msg) {
  process.stderr.write(msg + '\n');
}

function discover (ms) {
  return new Promise((resolve) => {
    const found = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const msg = Buffer.from([
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      'MX: 3',
      'ST: urn:schemas-upnp-org:device:MediaServer:1',
      '', ''
    ].join('\r\n'));
    sock.on('message', (buf) => {
      const m = /^location:\s*(.+)$/im.exec(buf.toString());
      if (m) found.add(m[1].trim());
    });
    sock.on('error', (e) => log('SSDP error: ' + e.message));
    sock.bind(() => {
      sock.send(msg, 1900, '239.255.255.250');
      setTimeout(() => sock.send(msg, 1900, '239.255.255.250'), 1000);
    });
    setTimeout(() => {
      sock.close();
      resolve(Array.from(found));
    }, ms);
  });
}

function request (u, opts, body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request(u, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        ms: Date.now() - t0
      }));
      res.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('timeout after ' + TIMEOUT + ' ms')));
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
    if (body) req.write(body);
    req.end();
  });
}

function tag (xml, name) {
  const m = new RegExp('<(?:[\\w-]+:)?' + name + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>').exec(xml);
  return m ? m[1].trim() : '';
}

function unescapeXml (s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)).replace(/&amp;/g, '&');
}

function escapeXml (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseDescription (location, xml) {
  const services = [];
  const re = /<service>([\s\S]*?)<\/service>/g;
  let m;
  while ((m = re.exec(xml))) {
    services.push({ type: tag(m[1], 'serviceType'), controlURL: tag(m[1], 'controlURL') });
  }
  const cd = services.find((s) => /ContentDirectory:\d/.test(s.type));
  const loc = new URL(location);
  const base = tag(xml, 'URLBase') || location;
  return {
    friendlyName: unescapeXml(tag(xml, 'friendlyName')),
    manufacturer: unescapeXml(tag(xml, 'manufacturer')),
    modelName: unescapeXml(tag(xml, 'modelName')),
    modelNumber: unescapeXml(tag(xml, 'modelNumber')),
    udn: tag(xml, 'UDN'),
    contentDirectoryType: cd ? cd.type : null,
    controlURL: cd ? cd.controlURL : null,
    controlUrlSpec: cd ? new URL(cd.controlURL, base).toString() : null,
    controlUrlVolumio: cd ? 'http://' + loc.hostname + ':' + loc.port + cd.controlURL : null
  };
}

function browseXml (id, flag, start, count) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">' +
    '<ObjectID>' + escapeXml(id) + '</ObjectID>' +
    '<BrowseFlag>' + flag + '</BrowseFlag>' +
    '<Filter>*</Filter>' +
    '<StartingIndex>' + start + '</StartingIndex>' +
    '<RequestedCount>' + count + '</RequestedCount>' +
    '<SortCriteria></SortCriteria>' +
    '</u:Browse></s:Body></s:Envelope>';
}

function parseBrowse (body) {
  let didl = tag(body, 'Result');
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(didl);
  didl = cdata ? cdata[1] : unescapeXml(didl);
  const containers = [];
  const re = /<container\b([^>]*)>([\s\S]*?)<\/container>/g;
  let m;
  while ((m = re.exec(didl))) {
    const id = /\bid="([^"]*)"/.exec(m[1]);
    const cc = /\bchildCount="(\d+)"/.exec(m[1]);
    containers.push({
      id: id ? unescapeXml(id[1]) : '',
      title: unescapeXml(tag(m[2], 'title')),
      childCount: cc ? parseInt(cc[1], 10) : null
    });
  }
  return {
    returned: num(tag(body, 'NumberReturned'), null),
    total: num(tag(body, 'TotalMatches'), null),
    items: (didl.match(/<item\b/g) || []).length,
    containers: containers
  };
}

function pick (children, n) {
  if (children.length <= n) return children;
  const half = Math.ceil(n / 2);
  const biggest = children.slice().sort((a, b) => (b.childCount || 0) - (a.childCount || 0)).slice(0, half);
  const out = children.slice(0, n - half);
  biggest.forEach((c) => { if (out.indexOf(c) < 0) out.push(c); });
  return out;
}

async function captureServer (location, outDir) {
  const desc = await request(location, { headers: { 'User-Agent': VOLUMIO_UA } });
  if (desc.error || desc.status !== 200) {
    log('  cannot read description: ' + (desc.error || 'HTTP ' + desc.status));
    return null;
  }
  const info = parseDescription(location, desc.body);
  if (args.server && info.friendlyName.toLowerCase().indexOf(String(args.server).toLowerCase()) < 0) return null;
  log('\n== ' + info.friendlyName + ' (' + info.manufacturer + ' ' + info.modelName + ' ' + info.modelNumber + ')');
  if (!info.controlUrlSpec) {
    log('  no ContentDirectory service, skipping');
    return null;
  }

  const slug = (info.friendlyName || 'server').replace(/[^\w.-]+/g, '_').slice(0, 40) + '_' + new URL(location).hostname + '_' + (new URL(location).port || 80);
  const dir = path.join(outDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const exchangesFile = path.join(dir, 'exchanges.jsonl');
  const capture = { tool: 'dlna-capture/2', date: new Date().toISOString(), location: location, info: info, description: desc.body, args: args, containers: [] };
  let requests = 0;

  async function browse (id, flag, start, count) {
    const body = browseXml(id, flag, start, count);
    const r = await request(info.controlUrlSpec, {
      method: 'POST',
      headers: {
        'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'Content-Type': 'text/xml',
        'User-Agent': VOLUMIO_UA
      }
    }, body);
    requests++;
    const line = JSON.stringify({ objectId: id, browseFlag: flag, startingIndex: start, requestedCount: count, status: r.status, error: r.error, ms: r.ms, headers: r.headers, body: r.body }) + '\n';
    fs.appendFileSync(exchangesFile, line);
    written += line.length;
    return r;
  }

  const queue = [{ id: '0', title: 'root', depth: 0 }].concat(args.id.map((id) => ({ id: id, title: 'requested', depth: DEPTH })));
  const seen = new Set();

  while (queue.length && requests < MAX_REQUESTS && written < MAX_BYTES) {
    const node = queue.shift();
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    await browse(node.id, 'BrowseMetadata', 0, COUNT);

    const summary = { id: node.id, title: node.title, depth: node.depth, pages: [], stop: '' };
    const children = [];
    let start = 0;
    let lastBody = null;
    for (;;) {
      const r = await browse(node.id, 'BrowseDirectChildren', start, COUNT);
      if (r.error || r.status !== 200) {
        summary.stop = r.error || 'HTTP ' + r.status;
        break;
      }
      if (r.body === lastBody) {
        summary.stop = 'server ignored StartingIndex (same page twice)';
        break;
      }
      lastBody = r.body;
      const p = parseBrowse(r.body);
      summary.pages.push({ start: start, returned: p.returned, total: p.total, containers: p.containers.length, items: p.items, ms: r.ms });
      children.push.apply(children, p.containers);
      if (!p.returned) {
        summary.stop = 'NumberReturned 0';
        break;
      }
      start += p.returned;
      if (p.total && start >= p.total) {
        summary.stop = 'complete';
        break;
      }
      if (summary.pages.length >= MAX_PAGES) {
        summary.stop = 'max-pages reached';
        break;
      }
      if (requests >= MAX_REQUESTS) {
        summary.stop = 'max-requests reached';
        break;
      }
      if (written >= MAX_BYTES) {
        summary.stop = 'max-mb reached';
        break;
      }
    }
    capture.containers.push(summary);
    const first = summary.pages[0] || {};
    log('  [' + node.depth + '] ' + node.title + ': first page ' + first.returned + '/' + first.total +
      ', ' + summary.pages.length + ' page(s), ' + children.length + ' containers, ' + summary.stop);

    if (node.depth < DEPTH) {
      pick(children, FANOUT).forEach((c) => queue.push({ id: c.id, title: c.title, depth: node.depth + 1 }));
    }
  }

  fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(capture));
  return { name: info.friendlyName, info: info, containers: capture.containers, requests: requests };
}

function report (results) {
  const lines = [];
  results.forEach((r) => {
    lines.push('# ' + r.name + ' (' + r.info.manufacturer + ' ' + r.info.modelName + ' ' + r.info.modelNumber + ')');
    lines.push('control URL: ' + r.info.controlUrlSpec + (r.info.controlUrlSpec !== r.info.controlUrlVolumio ? '  (Volumio builds: ' + r.info.controlUrlVolumio + ')' : ''));
    lines.push('requests: ' + r.requests);
    r.containers.forEach((c) => {
      const first = c.pages[0] || {};
      const got = c.pages.reduce((s, p) => s + (p.returned || 0), 0);
      const paged = c.pages.length > 1 ? '  <-- PAGINATED, Volumio shows ' + first.returned + ' of ' + got : '';
      lines.push('  ' + '  '.repeat(c.depth) + c.title + ': ' + got + ' children in ' + c.pages.length + ' page(s), ' + c.stop + paged);
    });
    lines.push('');
  });
  return lines.join('\n');
}

async function main () {
  if (args.help) {
    log('usage: node dlna-capture.js [--location URL]... [--server NAME] [--id OBJECTID]... [--depth 3] [--fanout 10] [--max-pages 200] [--max-requests 3000] [--max-mb 300] [--out DIR]');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = args.out || path.join(os.homedir(), 'dlna-capture-' + stamp);
  fs.mkdirSync(outDir, { recursive: true });

  let locations = args.location;
  if (!locations.length) {
    log('Searching for media servers (5 s)...');
    locations = await discover(5000);
  }
  if (!locations.length) {
    log('No media server found. Pass its description URL with --location http://IP:PORT/description.xml');
    process.exit(1);
  }
  log('Found ' + locations.length + ' server(s):\n  ' + locations.join('\n  '));

  const results = [];
  for (const loc of locations) {
    const r = await captureServer(loc, outDir).catch((e) => log('  failed: ' + e.message));
    if (r) results.push(r);
  }

  const text = report(results);
  fs.writeFileSync(path.join(outDir, 'summary.txt'), text);
  log('\n' + text);

  const archive = outDir + '.tar.gz';
  execFileSync('tar', ['czf', archive, '-C', path.dirname(outDir), path.basename(outDir)]);
  log('Saved ' + archive + ' (' + Math.round(fs.statSync(archive).size / 1024) + ' KB).');
  log('It contains folder/artist/album/track names and the server\'s LAN address, nothing else.');
  if (args.serve !== 'false') serve(archive, num(args.port, 8099));
}

function serve (file, port) {
  const name = path.basename(file);
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="' + name + '"' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => {
    const ips = [];
    Object.values(os.networkInterfaces()).forEach((list) => list.forEach((a) => {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }));
    log('\nDownload it from your computer\'s browser:');
    ips.forEach((ip) => log('  http://' + ip + ':' + port + '/'));
    log('then attach it to a private message on the forum. Press Ctrl+C here when done.');
  });
}

main();
