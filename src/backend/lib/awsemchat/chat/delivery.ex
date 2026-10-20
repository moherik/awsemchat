defmodule AwsemChat.Chat.Delivery do
  @moduledoc """
  One intended recipient of a message, created pending at send time.

  Rows are written when the message is accepted, from the audience captured at
  that moment — the same set the media reference uses. Task 5 flips
  `delivered_at` when a recipient's device acks receipt; `reachable` lets a
  recipient who can no longer receive (left a circle, unfriended) be resolved
  without leaving a row pending forever, so "Delivered" is never shown falsely
  complete.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Message

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "deliveries" do
    belongs_to :message, Message
    belongs_to :user, User

    field :delivered_at, :utc_datetime
    field :reachable, :boolean, default: true

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc false
  def changeset(delivery, message_id, user_id) do
    delivery
    |> cast(%{message_id: message_id, user_id: user_id}, [:message_id, :user_id])
    |> validate_required([:message_id, :user_id])
    |> foreign_key_constraint(:message_id)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:message_id, :user_id])
  end
end
