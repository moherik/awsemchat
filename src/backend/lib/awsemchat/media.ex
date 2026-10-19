defmodule AwsemChat.Media do
  @moduledoc """
  Media upload and retrieval.

  Bytes live behind an `AwsemChat.Media.Store` (local disk this stage); the
  database row carries only metadata and the store's own key. Clients never
  choose a path, and a client-supplied filename never reaches the filesystem.

  Reads are authorized: an uploader can always read their own media, and media
  referenced by a message becomes readable by that conversation's members
  (`record_message_reference/1`, called by Chat in the next task).
  """

  import Ecto.Query

  alias AwsemChat.Accounts.User
  alias AwsemChat.Media.{LocalStore, Media, Reference}
  alias AwsemChat.Repo

  @default_limit 10 * 1024 * 1024
  @default_allowed_mime ~w(image/jpeg image/png image/webp image/gif)

  @doc """
  Stores `upload` on behalf of `owner` and records its metadata.

  The size and content type are checked before the bytes are copied, so a
  rejected upload leaves nothing on disk. Errors: `{:error, :too_large}` past
  the configured cap, `{:error, :unsupported}` for a content type outside the
  allow-list.
  """
  def upload(%User{} = owner, %Plug.Upload{} = upload) do
    with :ok <- check_content_type(upload),
         :ok <- check_size(upload) do
      persist(owner, upload)
    end
  end

  @doc "Loads a media row by id, or raises `Ecto.NoResultsError`."
  def fetch!(media_id) when is_binary(media_id) do
    Repo.get!(Media, media_id)
  end

  @doc """
  Whether `user` may read `media`.

  True for the uploader, or for a user named in `message_references.users` for a
  media row that a message actually references. A row with no references is
  owner-only — until Chat starts recording references in Task 4 that is every
  row, which is the intended degradation.
  """
  def authorized?(%User{} = user, %Media{} = media) do
    user.id == media.owner_id or referenced_by?(user, media)
  end

  def authorized?(_user, _media), do: false

  defp referenced_by?(%User{id: user_id}, %Media{id: media_id}) do
    from(r in Reference, where: r.media_id == ^media_id and ^user_id in r.user_ids)
    |> Repo.exists?()
  end

  @doc "Opens stored bytes for reading. The controller streams from the returned device."
  def open(path) when is_binary(path), do: store().open(path)

  @doc """
  Records that a message references this media, capturing the audience that may
  read it.

  `user_ids` is every participant who could see the message when it was sent
  (the sender plus intended recipients). Called by Chat; until then no
  references exist and `authorized?/2` is owner-only.
  """
  def record_message_reference(%{
        media_id: media_id,
        message_id: message_id,
        conversation_id: conversation_id,
        user_ids: user_ids
      }) do
    %Reference{}
    |> Reference.changeset(%{
      media_id: media_id,
      message_id: message_id,
      conversation_id: conversation_id,
      user_ids: user_ids
    })
    |> Repo.insert(
      on_conflict: :nothing,
      conflict_target: [:media_id, :message_id]
    )
  end

  defp persist(owner, upload) do
    case store().put(upload) do
      {:ok, path} -> insert_row(owner, upload, path)
      {:error, reason} -> {:error, reason}
    end
  end

  # A metadata failure must not leave bytes behind with no row pointing at them.
  defp insert_row(owner, upload, path) do
    case %Media{} |> Media.create_changeset(owner, upload, path) |> Repo.insert() do
      {:ok, media} ->
        {:ok, media}

      {:error, changeset} ->
        store().delete(path)
        {:error, changeset}
    end
  end

  defp check_content_type(%Plug.Upload{content_type: content_type}) do
    if content_type in allowed_mime(), do: :ok, else: {:error, :unsupported}
  end

  defp check_size(%Plug.Upload{path: path}) do
    limit = limit()

    case File.stat(path) do
      {:ok, %{size: size}} when size <= limit -> :ok
      {:ok, _stat} -> {:error, :too_large}
      {:error, reason} -> {:error, reason}
    end
  end

  defp store, do: config(:store, LocalStore)
  defp limit, do: config(:limit, @default_limit)
  defp allowed_mime, do: config(:allowed_mime, @default_allowed_mime)

  defp config(key, default) do
    :awsemchat
    |> Application.get_env(__MODULE__, [])
    |> Keyword.get(key, default)
  end
end
