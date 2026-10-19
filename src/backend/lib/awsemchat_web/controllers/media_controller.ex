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
  alias AwsemChatWeb.ErrorJSON

  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    case Media.upload(conn.assigns.current_user, upload) do
      {:ok, media} -> conn |> put_status(:created) |> json(%{mediaId: media.id})
      {:error, :too_large} -> error(conn, :request_entity_too_large, :too_large)
      {:error, :unsupported} -> error(conn, :unsupported_media_type, :unsupported_media_type)
      {:error, _reason} -> error(conn, :internal_server_error, :internal_error)
    end
  end

  def create(conn, _params) do
    error(conn, :bad_request, :missing_file)
  end

  def show(conn, %{"id" => media_id}) do
    media = Media.fetch!(media_id)

    if Media.authorized?(conn.assigns.current_user, media) do
      send_media(conn, media)
    else
      error(conn, :forbidden, :forbidden)
    end
  rescue
    Ecto.NoResultsError -> error(conn, :not_found, :media_not_found)
    Ecto.Query.CastError -> error(conn, :not_found, :media_not_found)
  end

  defp send_media(conn, media) do
    case Media.open(media.storage_path) do
      {:ok, device} ->
        conn
        |> put_resp_header("content-type", media.mime)
        |> put_resp_header("content-length", Integer.to_string(media.byte_size))
        |> send_chunked(200)
        |> stream_body(device)

      {:error, _reason} ->
        error(conn, :not_found, :media_not_found)
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

  defp error(conn, status, code) do
    conn
    |> put_status(status)
    |> json(ErrorJSON.error(code))
  end
end
