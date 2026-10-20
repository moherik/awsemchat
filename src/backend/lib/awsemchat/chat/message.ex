defmodule AwsemChat.Chat.Message do
  @moduledoc """
  One message: server-read metadata plus an opaque `payload`.

  The server stores `payload` as jsonb and never reads, validates, or rewrites
  what is inside it. The only content check is the encoded-size cap
  (`Chat.send_message/3`, 256 KB) so one message cannot exhaust the row budget;
  every message kind's inner shape belongs to the client encoder, which is what
  keeps the later E2E stage a client-only change.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @kinds [:text, :media, :sticker, :moment_ref]

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "messages" do
    field :client_op_id, :binary_id
    field :kind, Ecto.Enum, values: @kinds
    field :payload, :map, default: %{}
    field :reply_to_message_id, :binary_id
    field :reply_to_moment_id, :binary_id

    belongs_to :conversation, Conversation
    belongs_to :sender, User

    # Microsecond precision: keyset pagination orders on `(created_at, id)`, and
    # second precision would collapse a burst of messages into one timestamp,
    # leaving the cursor unable to tell them apart.
    field :created_at, :utc_datetime_usec
  end

  @doc false
  def changeset(message, attrs) do
    message
    |> cast(attrs, [
      :conversation_id,
      :sender_id,
      :client_op_id,
      :kind,
      :payload,
      :reply_to_message_id,
      :reply_to_moment_id
    ])
    |> validate_required([:conversation_id, :sender_id, :client_op_id, :kind, :payload])
    |> put_created_at()
    |> foreign_key_constraint(:conversation_id)
    |> foreign_key_constraint(:sender_id)
    |> unique_constraint([:sender_id, :client_op_id])
  end

  # `created_at` is the message's own timestamp (design doc §5) rather than
  # Ecto's default `inserted_at`; nothing ever updates it.
  defp put_created_at(%{data: %{created_at: nil}} = changeset) do
    put_change(changeset, :created_at, DateTime.utc_now())
  end

  defp put_created_at(changeset), do: changeset
end
