defmodule AwsemChat.Accounts.PIN do
  @moduledoc """
  Six-character `A-Z0-9` account identifier, unique per user.

  The PIN is how a person adds a friend, so uniqueness is a real constraint:
  `users.pin` carries a unique index and `generate/0` checks for an existing
  user before handing a candidate back.

  ## When the pool runs out

  Ten collisions in a row is unlikely but not impossible, and it is not the
  caller's mistake. `generate/0` answers `{:error, :pin_exhausted}` rather than
  raising, so the sign-in path can carry it as a normal error instead of
  turning it into a 500 with a stack trace. `AwsemChat.Accounts` retries its own
  uniques; an exhausted generator is reported up rather than retried, because
  retrying a pool with nothing left just burns the same ten draws again.

  ## The alphabet

  `generate/1` takes the candidate alphabet as an option. Production never
  passes it; the test that has to reach exhaustion does, because the only other
  way to exhaust a 36^6 space is to fill two billion rows.
  """

  import Ecto.Query

  alias AwsemChat.Repo
  alias AwsemChat.Accounts.User

  @alphabet ~c"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  @length 6
  @max_attempts 10

  @doc """
  Generates a six-character PIN unique across existing users.

  Returns `{:ok, pin}`, or `{:error, :pin_exhausted}` after `@max_attempts`
  collisions. `:alphabet` overrides the character set (tests only).
  """
  def generate(opts \\ []) do
    alphabet = Keyword.get(opts, :alphabet, @alphabet)
    generate(@max_attempts, alphabet)
  end

  defp generate(0, _alphabet), do: {:error, :pin_exhausted}

  defp generate(attempts, alphabet) do
    candidate = random_pin(alphabet)

    if Repo.exists?(from u in User, where: u.pin == ^candidate) do
      generate(attempts - 1, alphabet)
    else
      {:ok, candidate}
    end
  end

  defp random_pin(alphabet) do
    for _ <- 1..@length, into: "", do: <<Enum.random(alphabet)>>
  end
end
