/**
 * Proxy de responsividad — Hybred
 * ------------------------------------------------------------------
 * Expone la app LOCAL bajo la IP de tu LAN para testear en tablets,
 * SIN que la app redirija al entorno por defecto (ClaseWeb) y SIN
 * tocar el codigo de la app, de Moodle ni del chatkit.
 * CORRE = cd /home/sebastian/Jira-and-confluence-/responsive-proxy
 * Como funciona (3 trucos):
 *  1. Host spoof: a Moodle/Apache les reenvia "Host: localhost", asi
 *     responden como si fuera acceso local -> no redirige, da JSON limpio.
 *  2. CORS: el proxy inyecta el header CORS en TODA respuesta -> el
 *     chatkit deja de bloquear (su CORS_ORIGINS pasa a ser irrelevante).
 *  3. Rewrite al vuelo: reescribe SOLO el bundle JS de la app para que,
 *     cuando el hostname no sea localhost, apunte Moodle y chatkit al
 *     MISMO origen del proxy (relativos) en vez de a localhost fijo.
 *
 * Todo es en memoria/al vuelo: NO modifica ningun archivo del sistema.
 *
 * Uso:
 *   node proxy.js            (o ./start.sh)
 *   En la tablet (misma WiFi):  http://<IP-de-tu-PC>:8090/App/#/login
 * 
 * 
 * 
 * 
 * 
 * 2. En la tablet Android:
  - Ajustes → Acerca del dispositivo → tocá "Número de compilación" 7 veces (activa modo desarrollador).
  - Ajustes → Opciones de desarrollador → Depuración USB: ON.
  - Conectala por cable USB a la PC → aceptá el popup "¿Permitir depuración USB?".

 * 
 * 
 */

const http = require('http');

const LISTEN_PORT  = parseInt(process.env.PROXY_PORT || '8090', 10);
const BIND         = '0.0.0.0';        // escucha en todas las interfaces (LAN incluida)

// Backends locales que vamos a unificar bajo el origen del proxy
const APP_PORT     = 80;               // App + Moodle + assets + pluginfile
const CHATKIT_PORT = 8000;             // backend del chatkit

// Reescritura del bundle: en el fallback (hostname != localhost) la app se va
// a ClaseWeb (xa.lpv). Lo cambiamos para que clone el entorno Local pero con
// Moodle y chatkit apuntando al MISMO origen (el del proxy).
// Forzamos a que la app SIEMPRE use su propio origen (el del proxy) para
// Moodle y chatkit, sin importar el hostname. Asi, entrando por localhost:8090
// (via adb reverse), el chatkit ve "localhost" y carga, y todo va por el proxy.
const REWRITE_FROM = 'n==="localhost"||n==="127.0.0.1"?xa.localhost:xa.lpv}';
const REWRITE_TO   =
  '{...xa.localhost,wwwroot:window.location.origin+"/moodle",' +
  'chatkitUrl:window.location.origin+"/chatkit"}}';

function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'access-control-allow-origin':      origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods':     'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'access-control-allow-headers':
      req.headers['access-control-request-headers'] ||
      'Content-Type, Authorization, X-Atlassian-Token',
  };
}

const server = http.createServer((req, res) => {
  // Preflight CORS: lo contesta el proxy directo
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const toChatkit = req.url.startsWith('/chatkit');
  const port      = toChatkit ? CHATKIT_PORT : APP_PORT;
  const isBundle  = /^\/App\/assets\/.*\.js(\?|$)/.test(req.url);

  // Reenviamos los headers del cliente pero con Host=localhost (el truco clave)
  // y sin gzip, para poder reescribir el bundle y simplificar el streaming.
  const headers = { ...req.headers, host: 'localhost', 'accept-encoding': 'identity' };

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const opts = { hostname: '127.0.0.1', port, path: req.url, method: req.method, headers };

    const up = http.request(opts, upRes => {
      const cors = corsHeaders(req);

      if (isBundle) {
        // Bufferear -> reescribir -> enviar con el largo corregido
        const buf = [];
        upRes.on('data', c => buf.push(c));
        upRes.on('end', () => {
          let js = Buffer.concat(buf).toString('utf8');
          if (js.includes(REWRITE_FROM)) js = js.replace(REWRITE_FROM, REWRITE_TO);
          const out = Buffer.from(js, 'utf8');
          const h = { ...upRes.headers };
          delete h['content-encoding'];
          delete h['transfer-encoding'];
          delete h['access-control-allow-origin'];
          delete h['access-control-allow-credentials'];
          Object.assign(h, cors, { 'content-length': out.length, 'cache-control': 'no-store' });
          res.writeHead(upRes.statusCode, h);
          res.end(out);
        });
        return;
      }

      // Passthrough (incluye streaming del chatkit) con CORS del proxy
      const h = { ...upRes.headers };
      delete h['access-control-allow-origin'];
      delete h['access-control-allow-credentials'];
      Object.assign(h, cors);
      res.writeHead(upRes.statusCode, h);
      upRes.pipe(res);
    });

    up.on('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain', ...corsHeaders(req) });
      res.end('Proxy error: ' + err.message);
    });

    if (body.length) up.write(body);
    up.end();
  });
});

server.listen(LISTEN_PORT, BIND, () => {
  console.log('');
  console.log('  Proxy de responsividad corriendo');
  console.log(`  En esta PC:  http://localhost:${LISTEN_PORT}/App/#/login`);
  console.log(`  En la tablet: http://<IP-de-tu-PC>:${LISTEN_PORT}/App/#/login`);
  console.log('');
});
