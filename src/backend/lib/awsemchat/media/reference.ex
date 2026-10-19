defmodule AwsemChat.Media.Reference do
  @moduledoc """
  A message that carries media, along with the audience that may read it.

  Chat writes one row per `(message, media)` pair at send time. Keeping the
  audience here (rather than joining to messages and memberships) preserves the
  join-boundary rule: a person who joins a Circle after the message was sent is
  not in `user_ids`, so `Media.authorized?/2` stays false for them even though
  they are now a member.

  `message_id` and `conversation_id` carry no foreign keys while the messages
  and conversations tables do not exist; Task 4 adds them.
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "message_media" do
    field :message_id, :binary_id
    field :conversation_id, :binary_id
    field :user_ids, {:array, :binary_id}, default: []

    belongs_to :media, AwsemChat.Media.Media

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(reference, attrs) do
    reference
    |> cast(attrs, [:media_id, :message_id, :conversation_id, :user_ids])
    |> validate_required([:media_id, :message_id, :conversation_id])
    |> update_change(:user_ids, &Enum.uniq/1)
    |> foreign_key_constraint(:media_id)
    |> unique_constraint([:media_id, :message_id])
  end
end
