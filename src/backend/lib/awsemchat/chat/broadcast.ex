defmodule AwsemChat.Chat.Broadcast do
  @moduledoc """
  The one place the app pushes to the `"user:<id>"` topics.

  Contexts call these helpers *after* their transaction has committed, so a
  client never receives an event for a write that then rolls back.

  **Authorization is re-checked here, at fan-out time.** `message_new/1` does
  not read the `deliveries` rows the send created; it recomputes who may see the
  conversation right now (membership intact, not blocked either way, still
  visible). A recipient captured in the send-time snapshot who has since been
  blocked — or, in a circle, removed — does not receive the message. Reading the
  snapshot would leak a message to someone who lost access between the write and
  the push.

  The social and circle events (`friend_request_changed/1`, `friends_changed/1`,
  `circle_changed/3`) recompute their recipients the same way: the caller passes
  the users the change touches — the current active members for a circle change,
  plus the specific user a `member_removed` names — so a user who lost access is
  not sent an event they can no longer act on, while the user who lost access is
  still told, so their client can drop the circle.

  Each event is delivered to a user's topic as many times as that user may
  receive it; a user with two devices has both connections on the same topic and
  each gets its own copy.
  """

  alias AwsemChat.Chat
  alias AwsemChat.Chat.{Envelope, Message}
  alias AwsemChat.Social.FriendRequest

  @doc """
  Pushes `message:new` to every member of the message's conversation whose
  authorization still holds.

  The payload is the plan's wrapper, `%{"message" => envelope}` — one shape for
  the record, matching `friend_request:changed`'s `%{"request" => ...}` and
  leaving room for envelope-adjacent metadata without a breaking change. The
  envelope itself is still `Envelope.render/1`, so REST and the channel cannot
  drift.
  """
  def message_new(%Message{} = message) do
    payload = %{message: Envelope.render(message)}

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

  def moment_changed(%{conversation_id: conversation_id, moment_id: moment_id, change: change}) do
    conversation_id
    |> Chat.authorized_recipients()
    |> Enum.each(
      &broadcast(&1, "moment:changed", %{
        conversationId: conversation_id,
        momentId: moment_id,
        change: change
      })
    )

    :ok
  end

  def reaction_changed(%{
        conversation_id: conversation_id,
        target_type: target_type,
        target_id: target_id
      }) do
    conversation_id
    |> Chat.authorized_recipients()
    |> Enum.each(
      &broadcast(&1, "reaction:changed", %{
        conversationId: conversation_id,
        targetType: to_string(target_type),
        targetId: target_id
      })
    )

    :ok
  end

  @doc """
  Pushes `friend_request:changed` to both parties of a friend request.

  The payload is `%{"request" => FriendRequestJSON.data/1}`, the same shape REST
  returns, so a client that handled the request over HTTP and one that only sees
  the push parse one representation.
  """
  def friend_request_changed(%FriendRequest{} = request) do
    payload = %{request: AwsemChatWeb.FriendRequestJSON.data(request)}

    [request.sender_id, request.recipient_id]
    |> Enum.uniq()
    |> Enum.each(&broadcast(&1, "friend_request:changed", payload))

    :ok
  end

  @doc """
  Pushes `friends:changed` to each of `user_ids`.

  A friend list change (accept, unfriend, block) invalidates client-side caches
  of the whole list, not of one row, so the event carries no payload — the client
  refetches.
  """
  def friends_changed(user_ids) do
    user_ids
    |> Enum.uniq()
    |> Enum.each(&broadcast(&1, "friends:changed", %{}))

    :ok
  end

  @doc """
  Pushes `circle:changed` to `user_ids` for a change to `circle_id`.

  `change` is passed through as a string so the wire value is stable whether the
  caller builds it from an atom or a string. `user_ids` is recomputed by the
  caller against current membership; a `"member_removed"` includes the removed
  user so their client can drop the circle.
  """
  def circle_changed(circle_id, change, user_ids) do
    payload = %{circleId: circle_id, change: to_string(change)}

    user_ids
    |> Enum.uniq()
    |> Enum.each(&broadcast(&1, "circle:changed", payload))

    :ok
  end

  defp broadcast(user_id, event, payload) do
    AwsemChatWeb.Endpoint.broadcast("user:" <> user_id, event, payload)
  end
end
