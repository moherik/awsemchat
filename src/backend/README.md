# AwsemChat backend

The Phoenix API behind the chat app: accounts and sign-in, friends and blocks,
private and circle conversations, media, moments, and reactions. REST lives
under `/api/v1` and the realtime channel under `/socket`. Elixir 1.14+ and a
Postgres 16 are all it needs.

## Run it

The database runs in Docker; the app runs on the host.

```sh
cd src/backend
docker compose up -d          # Postgres 16 on localhost:5433
mix deps.get
mix ecto.create               # first run only
mix ecto.migrate
mix run priv/repo/seeds.exs   # or: mix awsemchat.seed (prints the roster)
mix phx.server                # http://localhost:4000
```

`mix setup` does `deps.get`, `ecto.create`, `ecto.migrate` and the seed in one
go, so the four commands above collapse to `mix setup && mix phx.server` once
Docker is up.

`mix ecto.reset` drops and rebuilds the database, then seeds it again. Use it
whenever the schema moved; the seed is idempotent, so re-running alone is safe.

### Bot credentials

The seed creates three bot accounts. `AwsemChat.Bots` subscribes to each of
them at boot and answers a private message automatically, so a conversation
with a bot is a real conversation with something on the other end.

| Name | Phone        | PIN    | Status               |
| ---- | ------------ | ------ | -------------------- |
| Naya | `0811110001` | BOTPN1 | Taking the scenic route |
| Raka | `0811110002` | BOTPN2 | One more song        |
| Sari | `0811110003` | BOTPN3 | Back in the garden   |

Sign in as one with its phone (the dev OTP is `123456`) to see the conversation
from the bot's side, or add one by PIN from your own account and send it a
message. `mix awsemchat.seed` prints this same table.

### Emulator and device URLs

- **Android emulator:** `http://10.0.2.2:4000`. `10.0.2.2` is the emulator's
  alias for the host loopback; `localhost` inside the emulator is the emulator
  itself and will not reach the server.
- **iOS simulator:** `http://localhost:4000` works, because the simulator shares
  the host network.
- **Physical device on the LAN:** `http://<your-host-ip>:4000`. Dev binds to
  `127.0.0.1` by default, so change `http: [ip: {127, 0, 0, 1}, port: 4000]` to
  `ip: {0, 0, 0, 0}` in `config/dev.exs` before starting the server.

The mobile app reads its base URL from `EXPO_PUBLIC_API_URL`, so point that at
whichever URL above matches where you are running.

Cross-origin browser clients are allowed from the origins the dev web build
uses: `http://localhost:8081`, `http://127.0.0.1:8081`, and any `192.168.x.x` or
`10.x.x.x` host on port 8081. See the `CORSPlug` plug in
`lib/awsemchat_web/endpoint.ex`. A native build sends no `Origin` and is
unaffected.

## Tests

```sh
cd src/backend
mix test
```

`mix test` creates and migrates the `awsemchat_test` database (override the port
with `MIX_TEST_PARTITION`), then runs the suite against the Postgres sandbox, so
tests do not see each other's rows and the dev database is untouched. Postgres
must be up (`docker compose up -d`).

Two stricter runs worth having in CI:

```sh
MIX_ENV=test mix compile --force --warnings-as-errors
mix format --check-formatted
```

The first fails on a warning (unused variable, unused alias, a default argument
nothing uses), the second on a file `mix format` would rewrite.

## Smoke test

`scripts/smoke.sh` walks the whole sign-in and chat path against a running dev
server with `curl`: request a code, verify it, read `/me`, request a friend by
the seed PIN, accept it as the bot, send a message, and list the messages back.

```sh
mix phx.server &          # or in another terminal
bash scripts/smoke.sh
```

It reads the bot PIN from the seed, not from you, so no token is copied by hand
between steps. Set `BASE_URL` to point it somewhere other than
`http://localhost:4000`:

```sh
BASE_URL=http://10.0.2.2:4000 bash scripts/smoke.sh
```

## Error codes

Every API error is `{"error": {"code": "<snake_case>"}}`. The code is the
contract the client maps to a snackbar or an empty state; the HTTP status is
part of the same row in `lib/awsemchat_web/errors.ex`, which is the only place
a code becomes a response. A code the table does not know is `internal_error`
with status 500, and nothing about the error behind it is echoed back.
