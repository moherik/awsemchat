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
  plug CORSPlug,
    origin: [
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      ~r/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:8081$/,
      ~r/^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:8081$/
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Authorization", "Content-Type"]

  plug AwsemChatWeb.Router
end
