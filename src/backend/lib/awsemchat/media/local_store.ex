defmodule AwsemChat.Media.LocalStore do
  @moduledoc """
  Development `Store`: files under `priv/media/`.

  Keys are server-generated (`media/<uuid>`) and the filename comes from
  `Plug.Upload.path`, not from the client-supplied `filename` — a client can
  send `../../etc/passwd` and it never touches a path.

  Swapped for object storage in the media stage; the interface is the
  `AwsemChat.Media.Store` behaviour.
  """

  @behaviour AwsemChat.Media.Store

  @prefix "media"

  @impl AwsemChat.Media.Store
  def put(%Plug.Upload{path: source_path}) do
    key = key()
    destination = Path.join(root(), key)

    with :ok <- File.mkdir_p(Path.dirname(destination)),
         :ok <- File.cp(source_path, destination) do
      {:ok, Path.join(@prefix, key)}
    end
  end

  @impl AwsemChat.Media.Store
  def open(path) do
    path
    |> absolute()
    |> File.open([:read, :binary])
  end

  @impl AwsemChat.Media.Store
  def delete(path), do: File.rm(absolute(path))

  @doc "Lists stored keys. Test-only convenience for asserting what was written."
  def list do
    case File.ls(root()) do
      {:ok, entries} -> {:ok, Enum.sort(Enum.map(entries, &Path.join(@prefix, &1)))}
      {:error, :enoent} -> {:ok, []}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Removes every stored object. Test-only; the app has no delete path."
  def clear do
    File.rm_rf(root())
    :ok
  end

  @doc false
  def root, do: Application.app_dir(:awsemchat, "priv/media")

  defp key, do: Ecto.UUID.generate()

  # A stored key is always our own uuid under `media/`; anything else (an
  # absolute path, a `..` segment) is rejected rather than resolved.
  defp absolute(path) do
    case Path.split(path) do
      [@prefix, file] when file != ".." -> Path.join(root(), file)
      _ -> Path.join(root(), "__invalid__")
    end
  end
end
