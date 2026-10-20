# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :awsemchat,
  namespace: AwsemChat,
  ecto_repos: [AwsemChat.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :awsemchat, :otp,
  provider: AwsemChat.Accounts.DevOtp,
  ttl_seconds: 300

# Seeded bot accounts (`mix awsemchat.seed`) and the auto-reply responder.
# `Bots` subscribes to each phone's account topic at boot and answers private
# messages; the phones here and the seed roster are the same list.
config :awsemchat, :bots,
  phones: ["0811110001", "0811110002", "0811110003"],
  reply_delay_ms: {800, 2000}

# Configures the endpoint
config :awsemchat, AwsemChatWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: AwsemChatWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: AwsemChat.PubSub,
  live_view: [signing_salt: "qcGEbbHS"]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
