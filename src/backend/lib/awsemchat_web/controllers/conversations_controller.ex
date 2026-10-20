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
  alias AwsemChatWeb.{ConversationJSON, Errors, MessageJSON, SharedMediaJSON}

  def create(conn, %{"peerUserId" => peer_id}) do
    user = conn.assigns.current_user

    case Accounts.get_by_id(peer_id) do
      nil ->
        Errors.render(conn, :user_not_found)

      %{} = peer ->
        if Social.send_allowed?(user, peer) do
          {:ok, conversation} = Social.private_conversation(user, peer)
          json(conn, ConversationJSON.data(conversation, peer: peer))
        else
          Errors.render(conn, :not_friends)
        end
    end
  end

  def create(conn, _params), do: Errors.render(conn, :peer_user_id_required)

  # Opening metadata for a conversation the caller can already see, including a
  # read-only one: after unfriend/block `POST /conversations` is refused (it
  # gates on `Social.send_allowed?/2`), so without this the client could not read
  # the conversation's own metadata. Visibility is `Chat.get_conversation/2` —
  # the same rule the message list uses — so this adds no new access.
  def show(conn, %{"conversationId" => conversation_id}) do
    user = conn.assigns.current_user

    case Chat.get_conversation(user, conversation_id) do
      nil ->
        Errors.render(conn, not_found_or_forbidden(conversation_id))

      conversation ->
        json(conn, ConversationJSON.data(conversation, peer_opts(user, conversation)))
    end
  end

  defp not_found_or_forbidden(conversation_id) do
    case Chat.get_conversation_row(conversation_id) do
      nil -> :not_found
      _ -> :not_member
    end
  end

  defp peer_opts(%{id: user_id}, %{type: :private} = conversation) do
    case Chat.peer_id(conversation, user_id) do
      nil -> []
      peer_id -> [peer: Accounts.get_by_id(peer_id)]
    end
  end

  defp peer_opts(_user, _conversation), do: []

  def list_messages(conn, %{"conversationId" => conversation_id} = params) do
    case Chat.list_messages(conn.assigns.current_user, conversation_id, params) do
      {:ok, page} ->
        json(conn, MessageJSON.page(page))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def send_message(conn, %{"conversationId" => conversation_id} = params) do
    case Chat.send_message(conn.assigns.current_user, conversation_id, params) do
      {:ok, message} ->
        conn |> put_status(:created) |> json(MessageJSON.data(message))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  # The shared-media grid: photos the conversation's messages carry, newest
  # first, with the same keyset cursor as the message list. Membership and the
  # circle join boundary are `Chat.list_shared_media/3`'s, so a non-member is
  # refused exactly as they are for messages.
  def list_media(conn, %{"id" => conversation_id} = params) do
    case Chat.list_shared_media(conn.assigns.current_user, conversation_id, params) do
      {:ok, page} ->
        json(conn, SharedMediaJSON.page(page))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def index(conn, params) do
    case Chat.list_conversations(conn.assigns.current_user, params) do
      {:ok, page} ->
        json(conn, ConversationJSON.page(page))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def update_preferences(conn, %{"id" => conversation_id} = params) do
    attrs = Map.drop(params, ["id"])

    case Chat.put_preferences(conn.assigns.current_user, conversation_id, attrs) do
      {:ok, _pref} ->
        json(conn, %{ok: true})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def update_position(conn, %{"id" => conversation_id} = params) do
    message_id = params["messageId"] || params["message_id"] || params["lastSeenMessageId"]

    case Chat.put_position(conn.assigns.current_user, conversation_id, message_id) do
      {:ok, _pos} ->
        json(conn, %{ok: true})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end
end
