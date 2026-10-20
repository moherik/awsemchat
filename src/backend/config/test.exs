import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :awsemchat, AwsemChat.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  port: 5433,
  database: "awsemchat_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :awsemchat, AwsemChatWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "Tve0wm5vQuVOKD90dHUPifTRfzkJDti5HdiqwKuUFARfdPKIats4udFEG51f0xl+",
  server: false

config :awsemchat, :otp,
  provider: AwsemChat.Accounts.DevOtp,
  ttl_seconds: 1

# Tests drive the responder with an injected zero delay; the supervised
# instance subscribes to no seed topics in a fresh test database.
config :awsemchat, :bots,
  phones: [],
  reply_delay_ms: 0

# Print only warnings and errors during test
config :logger, level: :warning

# Route the deliberately-raising controller so the unhandled-exception test can
# hit it. See `AwsemChatWeb.ErrorProbeController`.
config :awsemchat, test_error_routes: true

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime
