defmodule AwsemChat.Accounts.DevOtp do
  @moduledoc """
  Development OTP provider: a fixed code, kept in ETS, logged on request.

  `AwsemChat.Application` starts the table. The fixed code is the recorded dev
  UX decision (design doc section 3) so the emulator flow is completable without
  a real SMS provider.
  """

  @behaviour AwsemChat.Accounts.Otp

  require Logger

  @table :awsemchat_dev_otp
  @code "123456"
  @default_ttl_seconds 300

  @doc "Creates the ETS table and returns the child spec for the app supervisor."
  def child_spec(_opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, []}
    }
  end

  @doc false
  def start_link do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    :ignore
  end

  @impl AwsemChat.Accounts.Otp
  def request(phone) when is_binary(phone) do
    Logger.info("DevOtp code for #{phone}: #{@code}")
    :ets.insert(@table, {phone, @code, expires_at()})
    :ok
  end

  @impl AwsemChat.Accounts.Otp
  def fetch(phone) when is_binary(phone) do
    case :ets.lookup(@table, phone) do
      [{^phone, code, expires_at}] ->
        if DateTime.compare(DateTime.utc_now(), expires_at) == :lt do
          {:ok, code}
        else
          {:error, :expired}
        end

      [] ->
        {:error, :expired}
    end
  end

  defp expires_at do
    DateTime.add(DateTime.utc_now(), ttl_seconds(), :second)
  end

  defp ttl_seconds do
    Application.get_env(:awsemchat, :otp, [])
    |> Keyword.get(:ttl_seconds, @default_ttl_seconds)
  end
end
