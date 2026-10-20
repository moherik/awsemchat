defmodule AwsemChat.Social.Blocking do
  @moduledoc """
  One directed block: `blocker` refuses `blocked`.

  The block is asymmetric in the data (only the blocker's choice is recorded),
  but every check in `Social` is the symmetric `blocked_either?/2`: a block in
  either direction stops requests and private sends for the pair. That is the
  product rule — the person who was blocked must not be able to tell, so both
  directions must behave identically.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "blockings" do
    belongs_to :blocker, User
    belongs_to :blocked, User

    timestamps(type: :utc_datetime, inserted_at: :created_at, updated_at: false)
  end

  @doc false
  def changeset(blocking, %User{} = blocker, %User{} = blocked) do
    blocking
    |> cast(%{blocker_id: blocker.id, blocked_id: blocked.id}, [:blocker_id, :blocked_id])
    |> validate_required([:blocker_id, :blocked_id])
    |> foreign_key_constraint(:blocker_id)
    |> foreign_key_constraint(:blocked_id)
    |> unique_constraint([:blocker_id, :blocked_id])
  end
end
