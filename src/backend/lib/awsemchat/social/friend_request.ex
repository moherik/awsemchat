defmodule AwsemChat.Social.FriendRequest do
  @moduledoc """
  A PIN-addressed friend request and its one-way lifecycle.

  A row is created `:pending` by the sender, then answered once by the
  recipient (`:accepted` / `:declined`) or withdrawn by the sender
  (`:cancelled`). Answered rows are retained as history; only `:pending` rows
  are constrained to one per direction.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @states [:pending, :accepted, :declined, :cancelled]
  @terminal_states [:accepted, :declined, :cancelled]

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "friend_requests" do
    field :state, Ecto.Enum, values: @states, default: :pending

    belongs_to :sender, User
    belongs_to :recipient, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc false
  def create_changeset(request, %User{} = sender, %User{} = recipient) do
    request
    |> cast(%{sender_id: sender.id, recipient_id: recipient.id, state: :pending}, [
      :sender_id,
      :recipient_id,
      :state
    ])
    |> validate_required([:sender_id, :recipient_id, :state])
    |> foreign_key_constraint(:sender_id)
    |> foreign_key_constraint(:recipient_id)
    |> unique_constraint([:sender_id, :recipient_id],
      name: :friend_requests_pending_sender_recipient_index
    )
  end

  @doc false
  def state_changeset(request, state) when state in @terminal_states do
    request
    |> change(state: state)
    |> validate_required([:state])
  end

  @doc "Whether the request has already been answered or withdrawn."
  def answered?(%__MODULE__{state: state}), do: state in @terminal_states
end
