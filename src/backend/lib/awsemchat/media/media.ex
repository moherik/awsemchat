defmodule AwsemChat.Media.Media do
  @moduledoc """
  One stored upload: metadata plus the store's key for the bytes.

  `storage_path` is the store's own key, never a client filename and never an
  absolute OS path — a differently-located store keeps the same row shape.
  `width`/`height` are reserved for the shared-media grid; nothing fills them
  yet.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias AwsemChat.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "media" do
    field :mime, :string
    field :byte_size, :integer
    field :width, :integer
    field :height, :integer
    field :storage_path, :string

    belongs_to :owner, User, type: :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def create_changeset(media, %User{} = owner, %Plug.Upload{} = upload, path) do
    media
    |> cast(
      %{
        mime: upload.content_type,
        byte_size: byte_size_of(upload),
        storage_path: path,
        owner_id: owner.id
      },
      [:mime, :byte_size, :storage_path, :owner_id]
    )
    |> validate_required([:mime, :byte_size, :storage_path, :owner_id])
    |> foreign_key_constraint(:owner_id)
  end

  defp byte_size_of(%Plug.Upload{path: path}) do
    case File.stat(path) do
      {:ok, %{size: size}} -> size
      {:error, _reason} -> nil
    end
  end
end
