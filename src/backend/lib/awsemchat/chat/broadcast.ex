defmodule AwsemChat.Chat.Broadcast do
  @moduledoc """
  The one place the chat layer pushes to the `"user:<id>"` topics.

  Contexts call these helpers *after* their transaction has committed, so a
  client never receives an event for a write that then rolls back.

  **Authorization is re-checked here, at fan-out time.** `message_new/1` does
  not read the `deliveries` rows the send created; it recomputes who may see the
  conversation right now (membership intact, not blocked either way, still
  visible). A recipient captured in the send-time snapshot who has since been
  blocked — or, in a circle, removed — does not receive the message. Reading the
  snapshot would leak a message to someone who lost access between the write and
  the push.

  Each event is delivered to a user's topic as many times as that user may
  receive it; a user with two devices has both connections on the same topic and
  each gets its own copy.
  """

  alias AwsemChat.Chat
  alias AwsemChat.Chat.{Envelope, Message}

  @doc """
  Pushes `message:new` (the envelope) to every member of the message's
  conversation whose authorization still holds.
  """
  def message_new(%Message{} = message) do
    payload = Envelope.render(message)

    message.conversation_id
    |> Chat.authorized_recipients()
    |> Enum.each(&broadcast(&1, "message:new", payload))

    :ok
  end

  @doc """
  Pushes `message:delivered` to the sender with the receipt's current counts.

  `deliveredCount` counts recipients who have acked; `totalCount` counts the
  recipients still reachable, the only ones who can ever ack. Completion is
  `deliveredCount == totalCount` and is never true merely because the remaining
  recipients can no longer receive.
  """
  def delivered(%Message{} = message) do
    counts = Chat.delivery_counts(message)

    broadcast(
      message.sender_id,
      "message:delivered",
      %{
        messageId: message.id,
        deliveredCount: counts.delivered,
        totalCount: counts.total
      }
    )

    :ok
  end

  defp broadcast(user_id, event, payload) do
    AwsemChatWeb.Endpoint.broadcast("user:" <> user_id, event, payload)
  end
end
