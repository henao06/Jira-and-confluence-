#!/usr/bin/env bash
# ==========================================================================
# tablet.sh — Ver la app LOCAL en una o VARIAS tablets (Android) por WiFi.
#
# Fuente de verdad: devices.env  (whitelist:  nombre | serial | ip:puerto)
#
#   ./tablet.sh         -> levanta proxy, RECONECTA solo los del env, arma el
#                          reverse, y DESCONECTA los que borraste del archivo.
#   ./tablet.sh pair    -> vincula uno NUEVO y lo agrega solo a devices.env.
#   ./tablet.sh status  -> muestra estado sin tocar nada.
#
# Reconexion AUTOMATICA:
#   1) reusa el endpoint guardado (sin codigo).
#   2) si el puerto rotó (reinicio), ESCANEA la IP con nmap y encuentra el
#      puerto nuevo solo, se conecta y actualiza el env.
#   3) si ni asi (IP cambio / nmap no esta), te pide el IP:PUERTO una vez.
#
# En cada tablet:  http://localhost:8090/App/#/login
# ==========================================================================
set -uo pipefail
cd "$(dirname "$0")"
PORT=8090
ENVF="devices.env"
SCAN_RANGE="${SCAN_RANGE:-30000-65535}"   # rango de puertos a escanear con nmap

command -v adb >/dev/null 2>&1 || { echo "  [x] Falta adb: sudo apt install -y android-tools-adb"; exit 1; }
[ -f "$ENVF" ] || printf '# nombre | serial | ip:puerto\n' > "$ENVF"

# ---------- helpers del env ----------
env_lines()    { grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$ENVF"; }
trim()         { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
hw_serial()    { adb -s "$1" shell getprop ro.serialno 2>/dev/null | tr -d '\r\n'; }

connected_ep_for() {  # adb-serial (ip:puerto) de un device CONECTADO con serial hw $1
  local d state _ hw
  while read -r d state _; do
    [ "$state" = "device" ] || continue
    hw="$(hw_serial "$d")"
    [ "$hw" = "$1" ] && { echo "$d"; return 0; }
  done < <(adb devices | tail -n +2)
  return 1
}

update_endpoint() {  # $1=serial  $2=nuevo_ip:puerto
  local tmp; tmp="$(mktemp)"
  awk -F'|' -v s="$1" -v e="$2" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    { ser=$2; gsub(/[[:space:]]/,"",ser)
      if (ser==s) { nm=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",nm); printf "%s | %s | %s\n", nm, s, e }
      else print }' "$ENVF" > "$tmp" && mv "$tmp" "$ENVF"
}

# escanea la IP buscando el puerto de adb del dispositivo con serial $1; conecta y echo del endpoint
scan_connect() {  # $1=serial  $2=ip
  command -v nmap >/dev/null 2>&1 || return 1
  local ip="$2" port ep
  for port in $(nmap -Pn -p "$SCAN_RANGE" --open -T4 -n "$ip" 2>/dev/null | grep -oE '^[0-9]+/tcp' | cut -d/ -f1); do
    ep="$ip:$port"
    adb connect "$ep" >/dev/null 2>&1; sleep 1
    if [ "$(hw_serial "$ep")" = "$1" ]; then echo "$ep"; return 0; fi
    adb disconnect "$ep" >/dev/null 2>&1
  done
  return 1
}

# ---------- proxy ----------
ensure_proxy() {
  if ! curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/App/"; then
    echo "  Levantando el proxy (:$PORT)..."
    nohup node proxy.js >/tmp/responsive-proxy.log 2>&1 &
    sleep 1
  fi
  curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/App/" \
    && echo "  Proxy OK (:$PORT)" || echo "  [!] proxy no responde (tail /tmp/responsive-proxy.log)"
}

# ---------- reconectar los del env que esten caidos ----------
reconnect_all() {
  local name serial ep ip newep
  while IFS='|' read -r name serial ep; do
    name="$(trim "$name")"; serial="$(trim "$serial")"; ep="$(trim "$ep")"
    [ -z "$serial" ] && continue
    connected_ep_for "$serial" >/dev/null && continue   # ya conectado
    ip="${ep%%:*}"
    echo "  Reconectando $name ($serial) -> $ep ..."
    if adb connect "$ep" >/dev/null 2>&1 && sleep 1 && connected_ep_for "$serial" >/dev/null; then
      echo "   conectado."
      continue
    fi
    # puerto rotó -> escaneo automatico
    echo "   endpoint guardado no responde. Escaneando $ip (puede tardar unos segundos)..."
    newep="$(scan_connect "$serial" "$ip")"
    if [ -n "$newep" ]; then
      update_endpoint "$serial" "$newep"
      echo "   reconectado por escaneo: $newep  (devices.env actualizado)"
      continue
    fi
    # ni asi -> pedir manual (IP cambio, o nmap no esta)
    echo "   [!] no lo encontre por escaneo (cambio la IP?). En la tablet:"
    echo "       Depuracion inalambrica -> 'Direccion IP y puerto'."
    read -rp "       Nuevo IP:PUERTO de $name (vacio = saltar): " NEW
    [ -z "${NEW:-}" ] && { echo "   saltado."; continue; }
    if adb connect "$NEW" >/dev/null 2>&1 && sleep 1 && connected_ep_for "$serial" >/dev/null; then
      update_endpoint "$serial" "$NEW"; echo "   conectado y devices.env actualizado."
    else
      echo "   [x] no conecto a $NEW (si sigue, re-vincula: ./tablet.sh pair)."
    fi
  done < <(env_lines)
}

# ---------- activar (reverse) y limpiar no-autorizados ----------
sync_devices() {
  local any=0 d state _ hw matched name ep
  while read -r d state _; do
    [ "$state" = "device" ] || continue
    hw="$(hw_serial "$d")"
    matched=""; name=""; ep=""
    while IFS='|' read -r n s e; do
      [ "$(trim "$s")" = "$hw" ] && { matched=1; name="$(trim "$n")"; ep="$(trim "$e")"; break; }
    done < <(env_lines)
    if [ -n "$matched" ]; then
      if adb -s "$d" reverse tcp:$PORT tcp:$PORT >/dev/null 2>&1; then
        echo "   [OK] ${name:-?} ($hw) -> activo"; any=1
        [ "$ep" != "$d" ] && update_endpoint "$hw" "$d"
      else
        echo "   [x] fallo reverse en ${name:-$hw}"
      fi
    else
      adb disconnect "$d" >/dev/null 2>&1
      echo "   [--] $hw no esta en $ENVF -> DESCONECTADO"
    fi
  done < <(adb devices | tail -n +2)
  [ "$any" = "1" ] || echo "   (ningun dispositivo autorizado conectado)"
}

print_url() {
  echo ""
  echo "  =================================================================="
  echo "    En cada tablet (Chrome):  http://localhost:$PORT/App/#/login"
  echo "  =================================================================="
}

case "${1:-}" in
  pair)
    echo "  -- Vincular dispositivo NUEVO --"
    read -rp "  1) IP:PUERTO del cartel de vincular: " PAIR_EP
    read -rp "  2) Codigo de 6 digitos: " CODE
    adb pair "$PAIR_EP" "$CODE" || { echo "  [x] pairing fallo (el codigo expira en ~1 min)."; exit 1; }
    read -rp "  3) IP:PUERTO de la PANTALLA PRINCIPAL (con ':' no '.'): " CONN_EP
    adb connect "$CONN_EP" || { echo "  [x] no conecto a $CONN_EP"; exit 1; }
    sleep 1
    HW="$(hw_serial "$CONN_EP")"
    read -rp "  Nombre para este dispositivo (ej tablet-grande): " NAME
    [ -z "${NAME:-}" ] && NAME="device-$HW"
    if env_lines | awk -F'|' -v s="$HW" '{gsub(/[[:space:]]/,"",$2)} $2==s{f=1} END{exit !f}'; then
      echo "  Ya estaba en $ENVF; actualizo su endpoint."; update_endpoint "$HW" "$CONN_EP"
    else
      echo "$NAME | $HW | $CONN_EP" >> "$ENVF"; echo "  Agregado: $NAME | $HW | $CONN_EP"
    fi
    ensure_proxy; sync_devices; print_url
    ;;
  status)
    echo "  --- Autorizados en $ENVF ---"; env_lines || echo "  (vacio)"
    echo "  --- Conectados ahora ---"; adb devices | tail -n +2
    ;;
  "")
    ensure_proxy; reconnect_all; sync_devices; print_url
    ;;
  *)
    adb connect "$1" >/dev/null 2>&1 && sleep 1
    ensure_proxy; reconnect_all; sync_devices; print_url
    ;;
esac
