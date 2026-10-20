#!/usr/bin/env bash
#
# Exercises the signed-in chat path against a running dev server.
#
#   bash scripts/smoke.sh
#   BASE_URL=http://10.0.2.2:4000 bash scripts/smoke.sh
#
# It carries its own tokens between steps: every value one call needs is read
# out of the previous call's JSON, so nothing is copied by hand. It leaves two
# accounts behind (a fresh one and the seeded bot it befriends), which is the
# point: run `mix ecto.reset` to clear them.
#
# Requires: curl, and jq or python3 for JSON parsing.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
API="$BASE_URL/api/v1"
DEV_OTP="123456"
BOT_PHONE="${BOT_PHONE:-0811110001}"
BOT_PIN="${BOT_PIN:-BOTPN1}"

# A phone the run has not used before, so a second run does not trip over an
# existing friendship. The last six digits come from the clock.
ME_PHONE="+1555$(date +%H%M%S)"

# --- plumbing ---------------------------------------------------------------

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "smoke: $1 is required" >&2
    exit 2
  }
}

need curl

if command -v jq >/dev/null 2>&1; then
  # Paths are written as `user.id`, `messages[0].id`.
  json() { jq -r ".$1"; }
  json_dump() { jq -c . 2>/dev/null || cat; }
elif command -v python3 >/dev/null 2>&1; then
  # Fallback so the script runs on a box without jq.
  json() {
    python3 -c 'import json,sys
path = sys.argv[1].replace("[", ".").replace("]", "").split(".")
data = json.load(sys.stdin)
for key in path:
    data = data[int(key)] if isinstance(data, list) else data[key]
print(data)' "$1"
  }
  json_dump() { python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' 2>/dev/null || cat; }
else
  echo "smoke: jq or python3 is required" >&2
  exit 2
fi

step=0
say() {
  step=$((step + 1))
  printf '\n\033[1m[%02d] %s\033[0m\n' "$step" "$1"
}

# Prints the status and body, and fails the run on a status outside 2xx.
call() {
  local method="$1" url="$2" body="${3:-}" auth="${4:-}"
  local args=(-sS -X "$method" "$url" -H 'Accept: application/json' -w '\n%{http_code}')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer $auth")

  local out status payload
  out="$(curl "${args[@]}")"
  status="${out##*$'\n'}"
  payload="${out%$'\n'*}"

  printf '  %s %s -> %s\n' "$method" "${url#"$BASE_URL"}" "$status"
  # One compact line of the body, so a failure is readable in the log without
  # swallowing the whole run.
  if [ -n "$payload" ]; then
    printf '  %s\n' "$(printf '%s' "$payload" | json_dump)"
  fi
  printf '%s' "$payload" >/tmp/smoke-body.$$

  if [ "${status:0:1}" != "2" ]; then
    echo "smoke: HTTP $status from $method ${url#"$BASE_URL"}" >&2
    exit 1
  fi
}

body() { cat /tmp/smoke-body.$$; }
cleanup() { rm -f /tmp/smoke-body.$$; }
trap cleanup EXIT

# A v4 UUID for clientOpId (the API requires one and rejects a retry it has
# already seen, so a fresh value per run is what makes the send idempotent-safe).
uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    python3 -c 'import uuid; print(uuid.uuid4())'
  fi
}

# --- the walk ---------------------------------------------------------------

echo "AwsemChat smoke test against $BASE_URL"
echo "signing in as $ME_PHONE, befriending the seeded bot $BOT_PHONE ($BOT_PIN)"

say "Request a sign-in code for $ME_PHONE"
call POST "$API/auth/request_code" "{\"phone\":\"$ME_PHONE\"}"
REQUEST_ID="$(body | json requestId)"
echo "  requestId: $REQUEST_ID"

say "Verify the dev code ($DEV_OTP)"
call POST "$API/auth/verify_code" "{\"phone\":\"$ME_PHONE\",\"code\":\"$DEV_OTP\"}"
TOKEN="$(body | json token)"
MY_ID="$(body | json user.id)"
MY_PIN="$(body | json user.pin)"
echo "  token: ${TOKEN:0:12}...  userId: $MY_ID  myPin: $MY_PIN"

say "GET /me"
call GET "$API/me" "" "$TOKEN"
[ "$(body | json id)" = "$MY_ID" ] || {
  echo "smoke: /me returned a different id than sign-in did" >&2
  exit 1
}

say "Send a friend request to the seed PIN $BOT_PIN"
call POST "$API/friends/requests" "{\"pin\":\"$BOT_PIN\"}" "$TOKEN"
REQUEST_PK="$(body | json id)"
STATE="$(body | json state)"
echo "  friendRequestId: $REQUEST_PK  state: $STATE"

say "Sign in as the bot and accept the request"
call POST "$API/auth/request_code" "{\"phone\":\"$BOT_PHONE\"}"
call POST "$API/auth/verify_code" "{\"phone\":\"$BOT_PHONE\",\"code\":\"$DEV_OTP\"}"
BOT_TOKEN="$(body | json token)"
BOT_ID="$(body | json user.id)"
echo "  botUserId: $BOT_ID"

call POST "$API/friends/requests/$REQUEST_PK/accept" "" "$BOT_TOKEN"

say "Open the private conversation with the bot"
call POST "$API/conversations" "{\"peerUserId\":\"$BOT_ID\"}" "$TOKEN"
CONVERSATION_ID="$(body | json id)"
echo "  conversationId: $CONVERSATION_ID"

say "Send a message"
CLIENT_OP_ID="$(uuid)"
call POST "$API/conversations/$CONVERSATION_ID/messages" \
  "{\"clientOpId\":\"$CLIENT_OP_ID\",\"kind\":\"text\",\"payload\":{\"v\":1,\"text\":\"smoke test hello\"}}" \
  "$TOKEN"
MESSAGE_ID="$(body | json id)"
echo "  messageId: $MESSAGE_ID"

say "List the messages back"
call GET "$API/conversations/$CONVERSATION_ID/messages" "" "$TOKEN"
FOUND="$(body | json "messages[0].id")"
[ "$FOUND" = "$MESSAGE_ID" ] || {
  echo "smoke: newest message id $FOUND is not the one just sent ($MESSAGE_ID)" >&2
  exit 1
}

say "Wait for the bot's auto-reply"
# The responder answers after a short delay, so give it a few tries before
# calling it a miss.
REPLY=""
for _ in $(seq 1 15); do
  call GET "$API/conversations/$CONVERSATION_ID/messages" "" "$TOKEN"
  REPLY="$(body | json "messages[0].senderId")"
  [ "$REPLY" = "$BOT_ID" ] && break
  sleep 1
done
[ "$REPLY" = "$BOT_ID" ] || {
  echo "smoke: the bot did not reply within 15s" >&2
  exit 1
}
echo "  reply from bot: $(body | json "messages[0].payload.text")"

printf '\n\033[1;32mOK\033[0m: sign in, friend request, accept, send, list, bot reply all passed.\n'
