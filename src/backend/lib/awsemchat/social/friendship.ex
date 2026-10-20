defmodule AwsemChat.Social.Friendship do
  @moduledoc """
  An accepted friendship, stored as **one row per direction**.

  `Social` writes both `(a -> b)` and `(b -> a)` on accept and deletes both on
  unfriend. The alternative — a single canonical sorted-pair row — needs an
  `OR`/`UNION` or a sorted-pair key on every read; a directed row keeps the
  common query ("is `a` friends with `b`") a single indexed lookup and makes
  "what are `a`'s friends" a plain join. The cost is that the two rows must
  always be written and removed together, which is enforced by doing it inside
  one transaction and by the unique `(user_id, friend_id)` index that makes a
  second write a no-op rather than a duplicate.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "friendships" do
    belongs_to :user, User
    belongs_to :friend, User

    timestamps(type: :utc_datetime, inserted_at: :created_at, updated_at: false)
  end

  @doc false
  def changeset(friendship, %User{} = user, %User{} = friend) do
    friendship
    |> cast(%{user_id: user.id, friend_id: friend.id}, [:user_id, :friend_id])
    |> validate_required([:user_id, :friend_id])
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:friend_id)
    |> unique_constraint([:user_id, :friend_id])
  end
end
