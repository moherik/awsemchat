defmodule AwsemChatWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :awsemchat

  # The session will be stored in the cookie and signed,
  # this means its contents can be read but not tampered with.
  # Set :encryption_salt if you would also like to encrypt it.
  @session_options [
    store: :cookie,
    key: "_awsemchat_key",
    signing_salt: "KOPpi6CJ",
    same_site: "Lax"
  ]

  # socket "/live", Phoenix.LiveView.Socket,
  #   websocket: [connect_info: [session: @session_options]],
  #   longpoll: [connect_info: [session: @session_options]]

  socket "/socket", AwsemChatWeb.UserSocket,
    websocket: true,
    longpoll: false

  # Serve at "/" the static files from "priv/static" directory.
  #
  # You should set gzip to true if you are running phx.digest
  # when deploying your static files in production.
  plug Plug.Static,
    at: "/",
    from: :awsemchat,
    gzip: false,
    only: AwsemChatWeb.static_paths()

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :awsemchat
  end

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug Plug.Session, @session_options

  # Browser clients reach this API cross-origin: the Expo web build dev
  # server runs on 8081, and a device on the LAN opens the API by the host's
  # address rather than localhost. `check_origin: false` in dev does not cover
  # CORS, which the browser enforces separately, so these are the origins the
  # API answers a preflight for. A native build sends no Origin and is
  # unaffected.
  #
  # This is the REST API's CORS, not the channel's: `socket "/socket"` above is
  # `longpoll: false`, so the browser opens a websocket, which CORS does not
  # gate. If a long-poll transport is ever enabled, it needs its own origin
  # rule here.
  plug CORSPlug,
    origin: [
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      ~r/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:8081$/,
      ~r/^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:8081$/
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Authorization", "Content-Type"]

  # Unhandled exceptions are caught here, not inside a controller. `use
  # Phoenix.Endpoint` installs `Phoenix.Endpoint.RenderErrors`, which wraps
  # `call/2`: on a raise it renders `500.json` through `render_errors` (that is
  # `AwsemChatWeb.ErrorJSON`, which answers the API envelope
  # `{"error": {"code": "internal_error"}}`) and logs the exception at `:error`,
  # then **re-raises**. The re-raise is the point: a bug still crashes the caller
  # (and the test) instead of being swallowed into a quiet 500. `debug_errors` is
  # off in dev so `Plug.Debugger`, which would shadow this with an HTML page
  # carrying the stacktrace, is not installed.
  plug AwsemChatWeb.Router
end
