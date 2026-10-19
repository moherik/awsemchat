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
      # Start a worker by calling: AwsemChat.Worker.start_link(arg)
      # {AwsemChat.Worker, arg},
      # Start to serve requests, typically the last entry
      AwsemChatWeb.Endpoint
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
