defmodule AwsemChat.Chat.Position do
  @moduledoc """
  Per-user conversation position (last seen message).
  """
  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "conversation_positions" do
    field :last_seen_message_id, :binary_id

    belongs_to :conversation, Conversation
    belongs_to :user, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc false
  def changeset(position, attrs) do
    position
    |> cast(attrs, [:conversation_id, :user_id, :last_seen_message_id])
    |> validate_required([:conversation_id, :user_id])
    |> unique_constraint([:conversation_id, :user_id])
    |> foreign_key_constraint(:conversation_id)
    |> foreign_key_constraint(:user_id)
  end
end
