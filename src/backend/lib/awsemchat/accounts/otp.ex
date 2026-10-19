defmodule AwsemChat.Accounts.Otp do
  @moduledoc """
  Behaviour for one-time-code delivery.

  The dev provider stores codes in memory for developer convenience. A real SMS
  provider implements the same behaviour, so nothing above this boundary changes
  when it lands.
  """

  @doc """
  Issues a code for `phone`.

  Returns `:ok`; the raw code never travels back through this call — the client
  supplies it on verify.
  """
  @callback request(phone :: String.t()) :: :ok

  @doc """
  Fetches the outstanding code for `phone`.

  `{:error, :expired}` covers both an unknown phone and a code past its TTL, so
  callers cannot probe which phones have requested a code.
  """
  @callback fetch(phone :: String.t()) :: {:ok, String.t()} | {:error, :expired}
end
