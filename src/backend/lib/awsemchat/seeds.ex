defmodule AwsemChat.Seeds do
  @moduledoc """
  The demo cast the app is not empty without: three bot accounts the owner can
  add as friends and talk to, each auto-replied to by `AwsemChat.Bots`.

  ## The roster

  Phones are the fixed `0811110001..3` so a signed-in-as-bot session is
  reachable, and PINs are the stable `BOTPN1..3` so the owner can add a bot by
  hand without reading ids out of the database. The PIN must be exactly six
  `A-Z0-9` characters (`Accounts.User.create_changeset/1` enforces it), and
  "BOTPIN1" is seven, so the roster spells them `BOTPN1..3` — the same label at
  the length the account identifier allows. Display names and status lines are
  the same cast the approved mobile sample data renders (Naya, Raka, Sari), so
  the demo's conversation list looks like the design it was approved against.

  ## Idempotence

  Seeding is keyed on `phone`: an existing account is reused and its profile and
  PIN are brought back to the roster values, so re-running repairs a hand-edited
  row instead of failing on the unique index or duplicating a user. The bots are
  not befriended to each other — only to whoever adds them — so a re-run does not
  manufacture relationships the owner did not ask for.
  """

  alias AwsemChat.Accounts.User
  alias AwsemChat.Repo

  @bots [
    %{
      phone: "0811110001",
      pin: "BOTPN1",
      display_name: "Naya",
      status_text: "Taking the scenic route"
    },
    %{phone: "0811110002", pin: "BOTPN2", display_name: "Raka", status_text: "One more song"},
    %{
      phone: "0811110003",
      pin: "BOTPN3",
      display_name: "Sari",
      status_text: "Back in the garden"
    }
  ]

  @pin_format ~r/\A[A-Z0-9]{6}\z/

  @doc "The bot roster: phone, PIN, display name and status line."
  def bots, do: @bots

  @doc "The bot phones, in roster order — the same list `Bots` subscribes to."
  def bot_phones, do: Enum.map(@bots, & &1.phone)

  @doc """
  Creates or refreshes the roster and returns the users in roster order.

  Safe to run repeatedly: existing rows are updated in place, never duplicated.
  """
  def seed do
    Enum.map(@bots, &upsert_bot/1)
  end

  defp upsert_bot(%{phone: phone} = attrs) do
    profile = %{display_name: attrs.display_name, status_text: attrs.status_text, pin: attrs.pin}

    case Repo.get_by(User, phone: phone) do
      %User{} = user ->
        user |> changeset(Map.merge(profile, %{phone: phone})) |> Repo.update!()

      nil ->
        %User{} |> changeset(Map.put(profile, :phone, phone)) |> Repo.insert!()
    end
  end

  # The account changeset, so the roster can never write a row the accounts
  # context would refuse — a PIN that is not six `A-Z0-9` characters, a missing
  # phone, or one that collides fails here rather than entering the database.
  defp changeset(user, attrs) do
    user
    |> Ecto.Changeset.change(attrs)
    |> Ecto.Changeset.validate_required([:phone, :pin])
    |> Ecto.Changeset.validate_format(:pin, @pin_format)
    |> Ecto.Changeset.unique_constraint(:phone)
    |> Ecto.Changeset.unique_constraint(:pin)
  end
end
