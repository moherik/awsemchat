defmodule AwsemChatWeb.MediaController do
  @moduledoc """
  Authenticated upload and download for the media the app shares.

  Upload stores metadata plus bytes behind the `Store` behaviour and answers with
  an id; download streams the bytes back only to someone `Media.authorized?/2`
  accepts. Both routes sit behind the `Auth` plug, so an absent or dead token is
  a 401 before the action runs.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Media
  alias AwsemChatWeb.Errors

  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    case Media.upload(conn.assigns.current_user, upload) do
      {:ok, media} -> conn |> put_status(:created) |> json(%{mediaId: media.id})
      {:error, :too_large} -> Errors.render(conn, :too_large)
      {:error, :unsupported} -> Errors.render(conn, :unsupported_media_type)
      {:error, _reason} -> Errors.render(conn, :internal_error)
    end
  end

  def create(conn, _params), do: Errors.render(conn, :missing_file)

  def show(conn, %{"id" => media_id}) do
    media = Media.fetch!(media_id)

    if Media.authorized?(conn.assigns.current_user, media) do
      send_media(conn, media)
    else
      Errors.render(conn, :forbidden)
    end
  rescue
    Ecto.NoResultsError -> Errors.render(conn, :media_not_found)
    Ecto.Query.CastError -> Errors.render(conn, :media_not_found)
  end

  defp send_media(conn, media) do
    case Media.open(media.storage_path) do
      {:ok, device} ->
        conn
        |> put_resp_header("content-type", media.mime)
        |> send_chunked(200)
        |> stream_body(device)

      {:error, _reason} ->
        Errors.render(conn, :media_not_found)
    end
  end

  # Reads a chunk at a time so a large file never sits in memory as one binary.
  defp stream_body(conn, device) do
    case IO.binread(device, 64 * 1024) do
      chunk when is_binary(chunk) ->
        case chunk(conn, chunk) do
          {:ok, conn} -> stream_body(conn, device)
          {:error, _reason} -> close(device, conn)
        end

      _eof_or_error ->
        close(device, conn)
    end
  end

  defp close(device, conn) do
    File.close(device)
    conn
  end
end
