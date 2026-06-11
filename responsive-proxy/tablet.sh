#!/usr/bin/env bash
# ==========================================================================
# tablet.sh — Ver tus proyectos LOCALES en una o VARIAS tablets (Android) por WiFi.
#
# Dos archivos de configuracion:
#   devices.env -> que tablets (whitelist:  nombre | serial | ip:puerto)
#   urls.env    -> que URLs/proyectos locales exponer (la url que abris en local)
#
#   ./tablet.sh         -> levanta el proxy (si hace falta), RECONECTA las tablets
#                          del whitelist, y reenvia TODOS los puertos de urls.env.
#   ./tablet.sh pair    -> vincula una tablet NUEVA y la agrega a devices.env.
#   ./tablet.sh status  -> muestra estado sin tocar nada.
#
# En la tablet abris la MISMA url que en tu local (es localhost via adb).
# ==========================================================================
set -uo pipefail
cd "$(dirname "$0")"
ENVF="devices.env"
URLF="urls.env"
PROXY_PORT="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' proxy.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')"
PROXY_PORT="${PROXY_PORT:-8090}"
SCAN_RANGE="${SCAN_RANGE:-30000-65535}"

command -v adb >/dev/null 2>&1 || { echo "  [x] Falta adb: sudo apt install -y android-tools-adb"; exit 1; }
[ -f "$ENVF" ] || printf '# nombre | serial | ip:puerto\n' > "$ENVF"
[ -f "$URLF" ] || printf '# URLs/puertos locales a exponer (una por linea)\nhttp://localhost:%s/App/#/login\n' "$PROXY_PORT" > "$URLF"

# ---------- helpers ----------
env_lines()  { grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$ENVF"; }
url_lines()  { grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$URLF"; }
trim()       { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
hw_serial()  { adb -s "$1" shell getprop ro.serialno 2>/dev/null | tr -d '\r\n'; }

extract_port() {  # url o puerto -> numero de puerto
  local s; s="$(echo "$1" | tr -d '[:space:]')"
  if   [[ "$s" =~ :([0-9]+) ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ "$s" =~ ^[0-9]+$ ]];  then echo "$s"
  elif [[ "$s" =~ ^https ]];    then echo 443
  elif [[ "$s" =~ ^http ]];     then echo 80
  fi
}
exposed_ports() { url_lines | while read -r l; do extract_port "$l"; done | sort -un; }

connected_ep_for() {
  local d state _ hw
  while read -r d state _; do
    [ "$state" = "device" ] || continue
    hw="$(hw_serial "$d")"; [ "$hw" = "$1" ] && { echo "$d"; return 0; }
  done < <(adb devices | tail -n +2)
  return 1
}
update_endpoint() {  # $1=serial $2=nuevo_ip:puerto
  local tmp; tmp="$(mktemp)"
  awk -F'|' -v s="$1" -v e="$2" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    { ser=$2; gsub(/[[:space:]]/,"",ser)
      if (ser==s){ nm=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",nm); printf "%s | %s | %s\n", nm, s, e } else print }' \
    "$ENVF" > "$tmp" && mv "$tmp" "$ENVF"
}
scan_connect() {  # $1=serial $2=ip
  command -v nmap >/dev/null 2>&1 || return 1
  local ip="$2" port ep
  for port in $(nmap -Pn -p "$SCAN_RANGE" --open -T4 -n "$ip" 2>/dev/null | grep -oE '^[0-9]+/tcp' | cut -d/ -f1); do
    ep="$ip:$port"; adb connect "$ep" >/dev/null 2>&1; sleep 1
    [ "$(hw_serial "$ep")" = "$1" ] && { echo "$ep"; return 0; }
    adb disconnect "$ep" >/dev/null 2>&1
  done
  return 1
}

# ---------- proxy (solo si su puerto esta en urls.env) ----------
ensure_proxy() {
  exposed_ports | grep -qx "$PROXY_PORT" || return 0   # nadie usa el proxy -> no lo levanto
  if ! curl -s -o /dev/null --max-time 3 "http://localhost:$PROXY_PORT/App/"; then
    echo "  Levantando el proxy (:$PROXY_PORT)..."
    nohup node proxy.js >/tmp/responsive-proxy.log 2>&1 &
    sleep 1
  fi
  curl -s -o /dev/null --max-time 3 "http://localhost:$PROXY_PORT/App/" \
    && echo "  Proxy OK (:$PROXY_PORT)" || echo "  [!] proxy no responde (tail /tmp/responsive-proxy.log)"
}

# ---------- reconectar las tablets del whitelist que esten caidas ----------
reconnect_all() {
  local name serial ep ip newep
  while IFS='|' read -r name serial ep; do
    name="$(trim "$name")"; serial="$(trim "$serial")"; ep="$(trim "$ep")"
    [ -z "$serial" ] && continue
    connected_ep_for "$serial" >/dev/null && continue
    ip="${ep%%:*}"
    echo "  Reconectando $name ($serial) -> $ep ..."
    if adb connect "$ep" >/dev/null 2>&1 && sleep 1 && connected_ep_for "$serial" >/dev/null; then
      echo "   conectado."; continue
    fi
    echo "   endpoint guardado no responde. Escaneando $ip ..."
    newep="$(scan_connect "$serial" "$ip")"
    if [ -n "$newep" ]; then update_endpoint "$serial" "$newep"; echo "   reconectado por escaneo: $newep (env actualizado)"; continue; fi
    echo "   [!] no lo encontre (cambio la IP?). En la tablet: Depuracion inalambrica -> 'Direccion IP y puerto'."
    read -rp "       Nuevo IP:PUERTO de $name (vacio = saltar): " NEW
    [ -z "${NEW:-}" ] && { echo "   saltado."; continue; }
    if adb connect "$NEW" >/dev/null 2>&1 && sleep 1 && connected_ep_for "$serial" >/dev/null; then
      update_endpoint "$serial" "$NEW"; echo "   conectado y env actualizado."
    else echo "   [x] no conecto a $NEW (re-vincula: ./tablet.sh pair)."; fi
  done < <(env_lines)
}

# ---------- reenviar TODOS los puertos de urls.env a cada tablet ----------
sync_devices() {
  local any=0 d state _ hw matched name ep p ports
  ports="$(exposed_ports)"
  while read -r d state _; do
    [ "$state" = "device" ] || continue
    hw="$(hw_serial "$d")"
    matched=""; name=""; ep=""
    while IFS='|' read -r n s e; do
      [ "$(trim "$s")" = "$hw" ] && { matched=1; name="$(trim "$n")"; ep="$(trim "$e")"; break; }
    done < <(env_lines)
    if [ -n "$matched" ]; then
      echo "   [OK] ${name:-?} ($hw):"
      for p in $ports; do
        if [ "$p" -lt 1024 ]; then echo "        - $p OMITIDO (Android no permite <1024; usa el proxy)"; continue; fi
        adb -s "$d" reverse tcp:$p tcp:$p >/dev/null 2>&1 && echo "        - puerto $p OK" || echo "        - puerto $p [x] fallo"
      done
      any=1
      [ "$ep" != "$d" ] && update_endpoint "$hw" "$d"
    else
      adb disconnect "$d" >/dev/null 2>&1
      echo "   [--] $hw no esta en $ENVF -> DESCONECTADO"
    fi
  done < <(adb devices | tail -n +2)
  [ "$any" = "1" ] || echo "   (ninguna tablet autorizada conectada)"
}

print_urls() {
  echo ""
  echo "  =================================================================="
  echo "    En la tablet (Chrome), abri la MISMA url que en tu local:"
  url_lines | while read -r l; do echo "        $(trim "$l")"; done
  echo "  =================================================================="
}

case "${1:-}" in
  pair)
    echo "  -- Vincular tablet NUEVA --"
    read -rp "  1) IP:PUERTO del cartel de vincular: " PAIR_EP
    read -rp "  2) Codigo de 6 digitos: " CODE
    adb pair "$PAIR_EP" "$CODE" || { echo "  [x] pairing fallo (el codigo expira en ~1 min)."; exit 1; }
    read -rp "  3) IP:PUERTO de la PANTALLA PRINCIPAL (con ':' no '.'): " CONN_EP
    adb connect "$CONN_EP" || { echo "  [x] no conecto a $CONN_EP"; exit 1; }
    sleep 1
    HW="$(hw_serial "$CONN_EP")"
    read -rp "  Nombre para esta tablet (ej tablet-grande): " NAME
    [ -z "${NAME:-}" ] && NAME="device-$HW"
    if env_lines | awk -F'|' -v s="$HW" '{gsub(/[[:space:]]/,"",$2)} $2==s{f=1} END{exit !f}'; then
      echo "  Ya estaba; actualizo endpoint."; update_endpoint "$HW" "$CONN_EP"
    else echo "$NAME | $HW | $CONN_EP" >> "$ENVF"; echo "  Agregada: $NAME | $HW | $CONN_EP"; fi
    ensure_proxy; sync_devices; print_urls
    ;;
  status)
    echo "  --- Tablets ($ENVF) ---"; env_lines || echo "  (vacio)"
    echo "  --- URLs a exponer ($URLF) ---"; url_lines || echo "  (vacio)"
    echo "  --- Conectadas ahora ---"; adb devices | tail -n +2
    ;;
  "")
    ensure_proxy; reconnect_all; sync_devices; print_urls
    ;;
  *)
    adb connect "$1" >/dev/null 2>&1 && sleep 1
    ensure_proxy; reconnect_all; sync_devices; print_urls
    ;;
esac
