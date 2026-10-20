defmodule AwsemChat.Chat.CircleInvitation do
  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @states [:pending, :accepted, :declined, :revoked]

  schema "circle_invitations" do
    field :state, Ecto.Enum, values: @states

    belongs_to :circle, Conversation, foreign_key: :circle_id
    belongs_to :inviter, User
    belongs_to :invitee, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def create_changeset(invitation, attrs) do
    invitation
    |> cast(attrs, [:circle_id, :inviter_id, :invitee_id, :state])
    |> validate_required([:circle_id, :inviter_id, :invitee_id, :state])
    |> validate_inclusion(:state, @states)
    |> foreign_key_constraint(:circle_id)
    |> foreign_key_constraint(:inviter_id)
    |> foreign_key_constraint(:invitee_id)
    # The partial unique index over pending invitations: one pending invite per
    # (circle, invitee). Declaring it here turns a second invite into an error
    # tuple the invite path maps to `:already_invited`, rather than a raise.
    |> unique_constraint([:circle_id, :invitee_id],
      name: :circle_invitations_circle_id_invitee_id_index
    )
  end

  def state_changeset(invitation, state) do
    invitation
    |> change(state: state)
    |> validate_inclusion(:state, @states)
  end
end
