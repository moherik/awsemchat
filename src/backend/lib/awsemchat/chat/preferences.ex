defmodule AwsemChat.Chat.Preferences do
  @moduledoc """
  Per-user conversation preferences.
  """
  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "conversation_preferences" do
    field :pinned, :boolean, default: false
    field :pin_order, :integer, default: 0
    field :muted, :boolean, default: false
    field :archived, :boolean, default: false

    belongs_to :conversation, Conversation
    belongs_to :user, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc false
  def changeset(preferences, attrs) do
    preferences
    |> cast(attrs, [:conversation_id, :user_id, :pinned, :pin_order, :muted, :archived])
    |> validate_required([:conversation_id, :user_id])
    |> unique_constraint([:conversation_id, :user_id])
    |> foreign_key_constraint(:conversation_id)
    |> foreign_key_constraint(:user_id)
  end
end
