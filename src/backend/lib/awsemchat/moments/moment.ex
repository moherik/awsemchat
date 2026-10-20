defmodule AwsemChat.Moments.Moment do
  @moduledoc """
  A moment in a conversation.

  Moments have their own audience boundary: only members who joined before or at
  the moment's creation can see them (`joined_at <= created_at`).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @kinds [:text, :media, :sticker]

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "moments" do
    field :kind, Ecto.Enum, values: @kinds
    field :payload, :map, default: %{}
    field :source_message_id, :binary_id
    field :deleted_at, :utc_datetime

    belongs_to :conversation, Conversation
    belongs_to :author, User

    field :created_at, :utc_datetime_usec
  end

  @doc false
  def changeset(moment, attrs) do
    moment
    |> cast(attrs, [
      :conversation_id,
      :author_id,
      :kind,
      :payload,
      :source_message_id,
      :deleted_at
    ])
    |> validate_required([:conversation_id, :author_id, :kind, :payload])
    |> put_created_at()
    |> foreign_key_constraint(:conversation_id)
    |> foreign_key_constraint(:author_id)
  end

  defp put_created_at(%{data: %{created_at: nil}} = changeset) do
    put_change(changeset, :created_at, DateTime.utc_now())
  end

  defp put_created_at(changeset), do: changeset
end
