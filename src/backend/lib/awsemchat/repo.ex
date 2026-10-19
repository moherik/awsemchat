defmodule AwsemChat.Repo do
  use Ecto.Repo,
    otp_app: :awsemchat,
    adapter: Ecto.Adapters.Postgres
end
