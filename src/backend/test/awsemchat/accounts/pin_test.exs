defmodule AwsemChat.Accounts.PINTest do
  @moduledoc """
  `PIN.generate/0` hands back a six-character candidate, and returns
  `{:error, :pin_exhausted}` instead of raising when it cannot find a free one.
  The distinction matters at the sign-in endpoint: a raise there is a 500 with a
  stack trace, while an error tuple is something the caller can act on.
  """

  use AwsemChat.DataCase, async: false

  import Ecto.Query

  alias AwsemChat.Accounts.PIN
  alias AwsemChat.Accounts.User
  alias AwsemChat.Repo

  test "generate/0 returns six uppercase alphanumeric characters" do
    assert {:ok, pin} = PIN.generate()
    assert pin =~ ~r/\A[A-Z0-9]{6}\z/
  end

  test "generate/0 is unique against existing users" do
    {:ok, existing} = PIN.generate()

    insert_user("+15550999901", existing)

    {:ok, candidate} = PIN.generate()
    refute candidate == existing
  end

  test "generate/0 returns an error tuple instead of raising when the pool is empty" do
    # A one-character alphabet leaves exactly one candidate; claiming it makes
    # every draw collide, which is the same state as a genuinely full pool.
    {:ok, only} = PIN.generate(alphabet: ~c"A")
    assert only == "AAAAAA"

    insert_user("+15550999902", only)

    assert PIN.generate(alphabet: ~c"A") == {:error, :pin_exhausted}
  end

  test "an exhausted pool does not raise through generate/0" do
    {:ok, only} = PIN.generate(alphabet: ~c"0")
    insert_user("+15550999903", only)

    # The old implementation raised here, so this asserts the shape a caller can
    # pattern-match rather than a message a client never sees.
    assert {:error, :pin_exhausted} = PIN.generate(alphabet: ~c"0")

    assert Repo.aggregate(from(u in User, where: u.pin == ^only), :count) == 1
  end

  defp insert_user(phone, pin) do
    %User{}
    |> Ecto.Changeset.change(phone: phone, pin: pin)
    |> Repo.insert!()
  end
end
