defmodule AwsemChat.Accounts.User do
  @moduledoc """
  A chat account: phone identity plus the profile fields the UI renders.

  `avatar_media_id` intentionally carries no database foreign key — the media
  table arrives in a later stage and the check is application-level until then.
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @profile_fields ~w(display_name status_text avatar_media_id)a
  @profile_param_names %{
    "displayName" => :display_name,
    "statusText" => :status_text,
    "avatarMediaId" => :avatar_media_id
  }

  schema "users" do
    field :phone, :string
    field :display_name, :string
    field :status_text, :string
    field :avatar_media_id, :binary_id
    field :pin, :string
    field :now_playing, :string

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for a new account.

  The caller supplies a unique `:pin` (see `AwsemChat.Accounts.PIN`); this
  changeset only shapes and validates it.
  """
  def create_changeset(attrs) do
    %__MODULE__{}
    |> cast(attrs, [:phone, :display_name, :pin])
    |> validate_required([:phone, :pin])
    |> validate_format(:pin, ~r/\A[A-Z0-9]{6}\z/)
    |> unique_constraint(:phone)
    |> unique_constraint(:pin)
  end

  @doc false
  def profile_changeset(user, attrs) do
    user
    |> cast(normalize_profile_params(attrs), @profile_fields)
    |> validate_length(:display_name, max: 100)
    |> validate_length(:status_text, max: 200)
  end

  # The API speaks camelCase; keep that translation at the schema boundary so
  # the context stays free of wire naming.
  defp normalize_profile_params(attrs) do
    Map.new(attrs, fn {key, value} -> {profile_param_name(key), value} end)
  end

  defp profile_param_name(key) when is_binary(key),
    do: Map.get(@profile_param_names, key, safe_existing_atom(key))

  defp profile_param_name(key) when is_atom(key),
    do: Map.get(@profile_param_names, Atom.to_string(key), key)

  defp profile_param_name(key), do: key

  defp safe_existing_atom(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> key
  end
end
