defmodule AwsemChatWeb.ConversationsController do
  @moduledoc """
  Private conversation open plus message list and send.

  `POST /conversations` opens (or returns) the private conversation with a peer
  who is an accepted friend. Messages are read with a keyset cursor and sent
  with an idempotent `clientOpId`. Both rules — audience at send time, history
  readable after a friendship ends — live in `AwsemChat.Chat`.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Social
  alias AwsemChatWeb.{ConversationJSON, ErrorJSON, MessageJSON}

  def create(conn, %{"peerUserId" => peer_id}) do
    user = conn.assigns.current_user

    case Accounts.get_by_id(peer_id) do
      nil ->
        error(conn, :not_found, :user_not_found)

      %{} = peer ->
        if Social.send_allowed?(user, peer) do
          {:ok, conversation} = Social.private_conversation(user, peer)
          json(conn, ConversationJSON.data(conversation, peer: peer))
        else
          error(conn, :forbidden, :not_friends)
        end
    end
  end

  def create(conn, _params), do: error(conn, :bad_request, :peer_user_id_required)

  def list_messages(conn, %{"conversationId" => conversation_id} = params) do
    case Chat.list_messages(conn.assigns.current_user, conversation_id, params) do
      {:ok, page} -> json(conn, MessageJSON.page(page))
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def send_message(conn, %{"conversationId" => conversation_id} = params) do
    case Chat.send_message(conn.assigns.current_user, conversation_id, params) do
      {:ok, message} -> conn |> put_status(:created) |> json(MessageJSON.data(message))
      {:error, reason} -> render_error(conn, reason)
    end
  end

  # A row that exists but is not mine is 403; one that does not exist is 404.
  defp render_error(conn, :not_found), do: error(conn, :not_found, :not_found)
  defp render_error(conn, :not_member), do: error(conn, :forbidden, :not_member)

  defp render_error(conn, :conversation_read_only),
    do: error(conn, :conflict, :conversation_read_only)

  defp render_error(conn, :blocked), do: error(conn, :forbidden, :blocked)

  defp render_error(conn, :payload_too_large),
    do: error(conn, :request_entity_too_large, :payload_too_large)

  defp render_error(conn, :invalid_kind), do: error(conn, :unprocessable_entity, :invalid_kind)

  defp render_error(conn, :invalid_client_op_id),
    do: error(conn, :unprocessable_entity, :invalid_client_op_id)

  defp render_error(conn, :invalid_cursor), do: error(conn, :bad_request, :invalid_cursor)

  defp render_error(conn, :invalid_payload),
    do: error(conn, :unprocessable_entity, :invalid_payload)

  defp render_error(conn, _reason), do: error(conn, :internal_server_error, :internal_error)

  defp error(conn, status, code) do
    conn |> put_status(status) |> json(ErrorJSON.error(code))
  end
end
