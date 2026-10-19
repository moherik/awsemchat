defmodule AwsemChat.Accounts.PIN do
  @moduledoc """
  Six-character `A-Z0-9` account identifier, unique per user.

  The PIN is how a person adds a friend, so uniqueness is a real constraint:
  `users.pin` carries a unique index and `generate/0` checks for an existing
  user before handing a candidate back.
  """

  import Ecto.Query

  alias AwsemChat.Repo
  alias AwsemChat.Accounts.User

  @alphabet ~c"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  @length 6
  @max_attempts 10

  @doc "Generates a six-character PIN, unique across existing users."
  def generate do
    generate(@max_attempts)
  end

  defp generate(0), do: raise("could not generate a unique PIN")

  defp generate(attempts) do
    candidate = random_pin()

    if Repo.exists?(from u in User, where: u.pin == ^candidate) do
      generate(attempts - 1)
    else
      candidate
    end
  end

  defp random_pin do
    for _ <- 1..@length, into: "", do: <<Enum.random(@alphabet)>>
  end
end
