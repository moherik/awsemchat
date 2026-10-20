defmodule AwsemChat.Chat.CircleMembership do
  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @roles [:owner, :admin, :member]
  @states [:active, :left, :removed]

  schema "circle_memberships" do
    field :role, Ecto.Enum, values: @roles
    field :state, Ecto.Enum, values: @states
    field :joined_at, :utc_datetime_usec
    field :left_at, :utc_datetime_usec

    belongs_to :circle, Conversation, foreign_key: :circle_id
    belongs_to :user, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def create_changeset(membership, attrs) do
    membership
    |> cast(attrs, [:circle_id, :user_id, :role, :state, :joined_at, :left_at])
    |> validate_required([:circle_id, :user_id, :role, :state])
    |> validate_inclusion(:role, @roles)
    |> validate_inclusion(:state, @states)
    |> foreign_key_constraint(:circle_id)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:circle_id, :user_id],
      name: :circle_memberships_circle_id_user_id_index
    )
  end
end
