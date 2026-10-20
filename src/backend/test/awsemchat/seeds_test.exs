defmodule AwsemChat.SeedsTest do
  @moduledoc """
  The seed roster's invariants: three bots with the agreed phones, PINs and cast,
  and a second run that refreshes rather than duplicates.

  The seed is what makes the app non-empty on first run, so the properties worth
  pinning are the ones a re-run could quietly break: the exact roster values, and
  idempotence (the same rows, edited in place, never appended).
  """

  use AwsemChat.DataCase, async: true

  alias AwsemChat.{Accounts, Seeds}
  alias AwsemChat.Accounts.User

  @expected [
    %{
      phone: "0811110001",
      pin: "BOTPN1",
      display_name: "Naya",
      status_text: "Taking the scenic route"
    },
    %{phone: "0811110002", pin: "BOTPN2", display_name: "Raka", status_text: "One more song"},
    %{phone: "0811110003", pin: "BOTPN3", display_name: "Sari", status_text: "Back in the garden"}
  ]

  test "test_seed_creates_the_three_bots" do
    seeds = Seeds.seed()

    assert length(seeds) == 3

    for expected <- @expected do
      bot = Accounts.get_by_phone(expected.phone)

      assert bot, "no bot seeded for #{expected.phone}"
      assert bot.display_name == expected.display_name
      assert bot.status_text == expected.status_text
      assert bot.pin == expected.pin
      # Six characters is the account identifier's own rule, which the bleed of
      # a longer roster label would otherwise violate.
      assert String.length(bot.pin) == 6
      assert bot.pin =~ ~r/\A[A-Z0-9]{6}\z/
    end
  end

  test "test_seed_is_idempotent" do
    Seeds.seed()
    Seeds.seed()

    assert bot_count() == 3

    assert Enum.sort(Seeds.bot_phones()) ==
             Enum.sort(Enum.map(@expected, & &1.phone))
  end

  test "test_seed_repairs_a_drifted_pin" do
    Seeds.seed()

    bot = Accounts.get_by_phone("0811110001")

    {:ok, _} =
      bot
      |> Ecto.Changeset.change(display_name: "Renamed", status_text: nil)
      |> Repo.update()

    Seeds.seed()

    repaired = Accounts.get_by_phone("0811110001")
    assert repaired.id == bot.id
    assert repaired.display_name == "Naya"
    assert repaired.status_text == "Taking the scenic route"
    assert bot_count() == 3
  end

  # Counts only the roster's phones so an unrelated row in the database cannot
  # make an idempotence assertion fail.
  defp bot_count do
    phones = Enum.map(@expected, & &1.phone)

    Repo.aggregate(from(u in User, where: u.phone in ^phones), :count)
  end
end
