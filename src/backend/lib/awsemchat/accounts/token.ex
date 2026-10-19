defmodule AwsemChat.Accounts.Token do
  @moduledoc """
  Auth token schema.

  A issued token is 32 random bytes, base64url-encoded for the client. Only its
  SHA-256 hash is persisted, so reading the database cannot recover a live
  token. A single row per login; revocation stamps `revoked_at`.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @token_bytes 32

  schema "auth_tokens" do
    field :token_hash, :string
    field :revoked_at, :utc_datetime
    field :last_used_at, :utc_datetime

    belongs_to :user, User

    timestamps(type: :utc_datetime)
  end

  @doc "Mints a new plaintext token for the client."
  def generate do
    @token_bytes
    |> :crypto.strong_rand_bytes()
    |> Base.url_encode64(padding: false)
  end

  @doc "Hashes a plaintext token for storage and lookup."
  def hash(token) when is_binary(token) do
    :sha256
    |> :crypto.hash(token)
    |> Base.encode16(case: :lower)
  end

  @doc false
  def create_changeset(user, token) do
    %__MODULE__{}
    |> cast(%{user_id: user.id}, [:user_id])
    |> put_change(:token_hash, hash(token))
    |> validate_required([:token_hash, :user_id])
    |> unique_constraint(:token_hash)
  end
end
