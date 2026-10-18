const http = require('http');
const fs = require('fs');
const source = 'C:/Users/Zerbeo Elnew/.codex/visualizations/2026/10/17/01a14909-7e15-7843-a593-04f61c507020/youcut-splice-desk.html';
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#151515}</style>' + fs.readFileSync(source, 'utf8'));
}).listen(5411, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:5411'));
