defmodule AwsemChat.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      AwsemChatWeb.Telemetry,
      AwsemChat.Repo,
      AwsemChat.Accounts.DevOtp,
      {DNSCluster, query: Application.get_env(:awsemchat, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: AwsemChat.PubSub},
      # Start to serve requests, typically the last entry
      AwsemChatWeb.Endpoint,
      # Subscribes to the seeded bots' user topics, so it starts after the
      # Endpoint its `subscribe/2` reads the PubSub server from — starting it
      # earlier crashes boot with "the table identifier does not refer to an
      # existing ETS table".
      AwsemChat.Bots
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: AwsemChat.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    AwsemChatWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
