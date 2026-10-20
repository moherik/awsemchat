defmodule AwsemChat.Reactions.Reaction do
  @moduledoc false

  use Ecto.Schema
  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "reactions" do
    field :target_type, Ecto.Enum, values: [:message, :moment]
    field :target_id, :binary_id
    field :emoji, :string

    belongs_to :user, User

    field :created_at, :utc_datetime_usec
  end

  @doc false
  def changeset(reaction, attrs) do
    reaction
    |> cast(attrs, [:target_type, :target_id, :user_id, :emoji])
    |> validate_required([:target_type, :target_id, :user_id, :emoji])
    |> put_created_at()
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:user_id, :target_type, :target_id])
  end

  defp put_created_at(%{data: %{created_at: nil}} = changeset) do
    put_change(changeset, :created_at, DateTime.utc_now())
  end

  defp put_created_at(changeset), do: changeset
end
