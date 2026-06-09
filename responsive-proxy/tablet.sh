#!/usr/bin/env bash
# ==========================================================================
# tablet.sh — Ver la app LOCAL en la tablet (Android) por WiFi.
#
# Hace TODO de una:
#   1) Levanta el proxy (:8090) si no esta corriendo.
#   2) Conecta la tablet por adb (WiFi) — reconecta solo si ya vinculaste.
#   3) Reenvia el puerto del proxy -> la tablet lo ve como localhost.
#   => En la tablet:  http://localhost:8090/App/#/login
#      (la tablet ES "localhost": no redirige, Moodle anda y el chat carga)
#
# USO:
#   ./tablet.sh          -> dia a dia (reconecta + arma todo)
#   ./tablet.sh pair     -> PRIMERA VEZ (vincular con codigo de la tablet)
#   ./tablet.sh IP:PUERTO-> conectar a un endpoint concreto
# ==========================================================================
set -uo pipefail
cd "$(dirname "$0")"
PORT=8090

command -v adb >/dev/null 2>&1 || { echo "  [x] Falta adb: sudo apt install -y android-tools-adb"; exit 1; }

# --- 1) proxy arriba? ------------------------------------------------------
if ! curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/App/"; then
  echo "  Levantando el proxy (:$PORT)..."
  nohup node proxy.js >/tmp/responsive-proxy.log 2>&1 &
  sleep 1
fi
if curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/App/"; then
  echo "  Proxy OK (:$PORT)"
else
  echo "  [!] El proxy no responde. Revisa: tail /tmp/responsive-proxy.log"
fi

# chequeo de backends que el proxy necesita
A="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:80/App/    --max-time 4)"
C="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/chatkit --max-time 4)"
[ "$A" = "200" ] || echo "  [!] App(:80) no responde 200 — levantala."
case "$C" in 000|"") echo "  [!] chatkit(:8000) caido — levantalo o el chat no carga.";; esac

# --- 2) conexion adb -------------------------------------------------------
connected() { adb get-state >/dev/null 2>&1; }

do_reverse_and_url() {
  adb reverse tcp:$PORT tcp:$PORT >/dev/null 2>&1 && echo "  reverse $PORT OK" || echo "  [x] fallo reverse $PORT"
  echo ""
  echo "  =================================================================="
  echo "    En la tablet (Chrome) abri:"
  echo "        http://localhost:$PORT/App/#/login"
  echo "  =================================================================="
}

if connected; then
  echo "  Tablet ya conectada ($(adb devices | awk 'NR==2{print $1}'))."
  do_reverse_and_url; exit 0
fi

case "${1:-}" in
  pair)
    echo "  -- PRIMERA VEZ: vincular --"
    echo "  Tablet: Depuracion inalambrica -> 'Vincular dispositivo con codigo'."
    read -rp "  1) IP:PUERTO del cartel de vincular: " PAIR_EP
    read -rp "  2) Codigo de 6 digitos: " CODE
    adb pair "$PAIR_EP" "$CODE" || { echo "  [x] Pairing fallo (el codigo expira en ~1 min, reintenta)."; exit 1; }
    read -rp "  3) IP:PUERTO de la PANTALLA PRINCIPAL (puerto DISTINTO, con ':' no '.'): " CONN_EP
    adb connect "$CONN_EP" || { echo "  [x] No conecto."; exit 1; }
    sleep 1; do_reverse_and_url
    ;;
  "")
    echo "  Buscando la tablet (mDNS)..."
    EP="$(adb mdns services 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+' | head -1)"
    if [ -n "$EP" ] && adb connect "$EP" >/dev/null 2>&1 && sleep 1 && connected; then
      do_reverse_and_url
    else
      echo "  No la encontre sola."
      echo "    Primera vez:        ./tablet.sh pair"
      echo "    Ya vinculada antes: ./tablet.sh IP:PUERTO   (la de la pantalla principal)"
      exit 1
    fi
    ;;
  *)
    adb connect "$1" || { echo "  [x] No conecto a $1"; exit 1; }
    sleep 1; do_reverse_and_url
    ;;
esac
