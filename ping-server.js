const http = require('http');
const net  = require('net');
const { exec } = require('child_process');

const PORT = 7789;

// ─── 工具函数 ──────────────────────────────────────────────────

function pingOne(ip) {
  return new Promise(resolve => {
    const cmd = process.platform === 'win32'
      ? `ping -n 1 -w 2000 ${ip}`
      : `ping -c 1 -W 2 ${ip}`;
    const start = Date.now();
    exec(cmd, (err, stdout) => {
      const ms = Date.now() - start;
      const alive = !err && (
        process.platform === 'win32'
          ? stdout.includes('TTL=') || stdout.includes('ttl=')
          : stdout.includes('1 received') || stdout.includes('1 packets received')
      );
      resolve({ alive, ms: alive ? ms : null });
    });
  });
}

function checkTcpPort(ip, port, timeoutMs = 2000) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = open => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ open });
    };
    socket.setTimeout(timeoutMs);
    socket.connect(port, ip, () => finish(true));
    socket.on('error',   () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

// 并发限流：把数组分批，每批最多 concurrency 个任务同时跑
async function pLimit(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await fn(items[idx]);
    await next();
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ─── HTTP 服务 ─────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 单个 ping：/ping?ip=10.1.6.44
  if (url.pathname === '/ping') {
    const ip = url.searchParams.get('ip');
    if (!ip || !/^[\d.]+$/.test(ip)) {
      res.writeHead(400); res.end(JSON.stringify({ error: '无效IP' })); return;
    }
    const result = await pingOne(ip);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip, ...result }));
    return;
  }

  // 批量 ping：/pingall?ips=10.1.6.44,10.1.6.11,...
  if (url.pathname === '/pingall') {
    const ips = (url.searchParams.get('ips') || '').split(',').filter(ip => /^[\d.]+$/.test(ip.trim()));
    if (ips.length === 0) { res.writeHead(400); res.end(JSON.stringify({ error: '无IP' })); return; }
    const entries = await pLimit(ips, 12, async ip => {
      ip = ip.trim();
      return [ip, await pingOne(ip)];
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(entries)));
    return;
  }

  // 综合检测：/checkall?ips=10.1.6.44,...&port=5900
  // 返回 { "ip": { ping:{alive,ms}, vnc:{open} } }
  if (url.pathname === '/checkall') {
    const ips  = (url.searchParams.get('ips') || '').split(',').filter(ip => /^[\d.]+$/.test(ip.trim()));
    const port = parseInt(url.searchParams.get('port') || '5900');
    if (ips.length === 0) { res.writeHead(400); res.end(JSON.stringify({ error: '无IP' })); return; }

    const entries = await pLimit(ips, 12, async rawIp => {
      const ip = rawIp.trim();
      const [ping, vnc] = await Promise.all([
        pingOne(ip),
        checkTcpPort(ip, port),
      ]);
      return [ip, { ping, vnc }];
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(entries)));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Ping 服务已启动，端口 ${PORT}`);
  console.log(`   支持接口：/ping  /pingall  /checkall`);
  console.log(`   按 Ctrl+C 停止`);
});
