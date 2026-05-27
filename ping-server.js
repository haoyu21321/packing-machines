const http = require('http');
const { exec } = require('child_process');

const PORT = 7789;

const server = http.createServer((req, res) => {
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
    const cmd = process.platform === 'win32'
      ? `ping -n 1 -w 1000 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    const start = Date.now();
    exec(cmd, (err, stdout) => {
      const ms = Date.now() - start;
      const alive = !err && (
        process.platform === 'win32'
          ? stdout.includes('TTL=') || stdout.includes('ttl=')
          : stdout.includes('1 packets transmitted, 1 packets received') || stdout.includes('1 packets transmitted, 1 received') || stdout.includes('1 received')
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ip, alive, ms: alive ? ms : null }));
    });
    return;
  }

  // 批量 ping：/pingall?ips=10.1.6.44,10.1.6.11,...
  if (url.pathname === '/pingall') {
    const ips = (url.searchParams.get('ips') || '').split(',').filter(ip => /^[\d.]+$/.test(ip.trim()));
    if (ips.length === 0) { res.writeHead(400); res.end(JSON.stringify({ error: '无IP' })); return; }

    let done = 0;
    const results = {};
    ips.forEach(ip => {
      ip = ip.trim();
      const cmd = process.platform === 'win32'
        ? `ping -n 1 -w 1000 ${ip}`
        : `ping -c 1 -W 1 ${ip}`;
      const start = Date.now();
      exec(cmd, (err, stdout) => {
        const ms = Date.now() - start;
        const alive = !err && (
          process.platform === 'win32'
            ? stdout.includes('TTL=') || stdout.includes('ttl=')
            : stdout.includes('1 packets transmitted, 1 packets received') || stdout.includes('1 packets transmitted, 1 received') || stdout.includes('1 received')
        );
        results[ip] = { alive, ms: alive ? ms : null };
        done++;
        if (done === ips.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        }
      });
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Ping 服务已启动，端口 ${PORT}`);
  console.log(`   打开打包机管理页面即可使用 ping 检测功能`);
  console.log(`   按 Ctrl+C 停止`);
});
