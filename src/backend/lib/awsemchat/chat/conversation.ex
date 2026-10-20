defmodule AwsemChat.Chat.Conversation do
  @moduledoc """
  A conversation: private (two people) or circle (a named group, Task 6).

  Private conversations carry a `private_key` — the two participant ids sorted
  lexicographically and joined — so the same pair always maps to exactly one
  row, whichever side opened it first (`Social.private_conversation/2`).
  Circles leave it null.

  A private conversation row is never deleted when a friendship ends: unfriend
  and block keep the row so history stays readable, and only new sends are
  refused (`Chat.send_message/3` returns `:conversation_read_only`).
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @types [:private, :circle]

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "conversations" do
    field :type, Ecto.Enum, values: @types
    field :private_key, :string
    field :name, :string
    field :description, :string
    field :avatar_media_id, :binary_id

    belongs_to :creator, User, foreign_key: :created_by

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc "The canonical key for a private pair: the two ids sorted and joined."
  def private_key(%User{id: a}, %User{id: b}), do: private_key(a, b)

  def private_key(a, b) when is_binary(a) and is_binary(b) do
    [a, b] |> Enum.sort() |> Enum.join(":")
  end

  @doc """
  The two participant ids in a private conversation's key, or `nil` for a
  circle (or a malformed key).
  """
  def participant_ids(%__MODULE__{private_key: nil}), do: nil

  def participant_ids(%__MODULE__{private_key: key}) do
    case String.split(key, ":") do
      [a, b] -> [a, b]
      _ -> nil
    end
  end

  @doc false
  def private_changeset(conversation, %User{} = a, %User{} = b) do
    conversation
    |> cast(%{type: :private, private_key: private_key(a, b), created_by: a.id}, [
      :type,
      :private_key,
      :created_by
    ])
    |> validate_required([:type, :private_key])
    |> foreign_key_constraint(:created_by)
    |> unique_constraint(:private_key)
  end

  def changeset(conversation, attrs) do
    conversation
    |> cast(attrs, [:type, :name, :description, :avatar_media_id, :private_key, :created_by])
    |> validate_required([:type])
  end
end
