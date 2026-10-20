defmodule AwsemChatWeb.UserChannel do
  @moduledoc """
  The per-user channel, topic `"user:" <> id`.

  This is the privacy boundary of the realtime layer: `join/3` accepts only the
  topic for the id the socket authenticated as, so a user cannot subscribe to
  another user's stream by naming their id. The topic is derived from
  `socket.assigns.user_id` (set by `UserSocket.connect/3` from a verified
  token), never from anything the client sends on the topic itself.

  Client → server: `"message:ack"` `%{"messageId" => id}` — device receipt for
  one message. The ack flips the caller's *own* pending delivery row and tells
  the sender; see `AwsemChat.Chat.ack_delivered/2`.
  """

  use AwsemChatWeb, :channel

  alias AwsemChat.Accounts
  alias AwsemChat.Chat

  @impl true
  def join("user:" <> user_id, _payload, socket) do
    if user_id == socket.assigns.user_id do
      {:ok, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "unauthorized"}}

  @impl true
  def handle_in("message:ack", %{"messageId" => message_id}, socket)
      when is_binary(message_id) and byte_size(message_id) > 0 do
    case Accounts.get_by_id(socket.assigns.user_id) do
      %{} = user ->
        :ok = Chat.ack_delivered(user, message_id)
        {:reply, :ok, socket}

      nil ->
        {:reply, {:error, %{reason: "unauthorized"}}, socket}
    end
  end

  def handle_in("message:ack", _payload, socket) do
    {:reply, {:error, %{reason: "bad_request"}}, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
