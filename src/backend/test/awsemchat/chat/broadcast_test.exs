defmodule AwsemChat.Chat.BroadcastTest do
  @moduledoc """
  Fan-out behaviour at the boundary: who receives which event, and — the point of
  Review Focus 4 — who must not.

  Assertions match the raw `Phoenix.Socket.Broadcast` on a named `"user:<id>"`
  topic rather than a transport `push`. `subscribe_and_join/3` subscribes the
  test process to the topic directly and also uses it as the transport, so each
  broadcast arrives twice; matching the topic makes "Alice received it, Bob did
  not" unambiguous instead of mixing both users' events in one mailbox.
  """

  use AwsemChatWeb.ChannelCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.Broadcast
  alias AwsemChat.Social

  alias AwsemChatWeb.UserChannel

  setup do
    alice = create_user("+15550007001")
    bob = create_user("+15550007002")
    conversation = friends_with(alice, bob)

    %{alice: alice, bob: bob, conversation: conversation}
  end

  test "message_new reaches every currently-authorized member", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)
    join(bob)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    assert_receive %Phoenix.Socket.Broadcast{
      topic: topic,
      event: "message:new",
      payload: %{id: id, senderId: sender_id}
    }

    assert id == message.id
    assert sender_id == alice.id
    assert topic in [user_topic(alice), user_topic(bob)]

    assert_receive %Phoenix.Socket.Broadcast{
      topic: other_topic,
      event: "message:new",
      payload: %{id: ^id}
    }

    assert other_topic in [user_topic(alice), user_topic(bob)]
    assert other_topic != topic
  end

  test "message_new skips a recipient whose authorization lapsed at fan-out time", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)
    join(bob)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    for _ <- 1..2 do
      assert_receive %Phoenix.Socket.Broadcast{topic: _, event: "message:new"}
    end

    # The send-time snapshot still names both participants as recipients.
    assert length(Chat.list_deliveries(message)) == 2

    # A block arriving after send time revokes both sides' authorization (a
    # block is symmetric). Re-broadcasting the same message must reach nobody:
    # the fan-out recomputes the recipient set here and never reads the
    # deliveries snapshot, so it cannot leak the message to a pair that is no
    # longer authorized.
    assert :ok = Social.block(alice, bob)

    assert :ok = Broadcast.message_new(message)

    alice_topic = user_topic(alice)
    bob_topic = user_topic(bob)

    refute_receive %Phoenix.Socket.Broadcast{topic: ^alice_topic}, 200
    refute_receive %Phoenix.Socket.Broadcast{topic: ^bob_topic}, 200
  end

  test "delivered carries the current acked and total counts", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())
    assert_receive %Phoenix.Socket.Broadcast{event: "message:new"}

    assert :ok = Chat.ack_delivered(bob, message.id)

    assert_receive %Phoenix.Socket.Broadcast{
      topic: topic,
      event: "message:delivered",
      payload: %{messageId: id, deliveredCount: delivered, totalCount: total}
    }

    assert topic == user_topic(alice)
    assert id == message.id
    assert delivered == 1
    assert total == 2
  end

  test "an idempotent resend does not broadcast a second time", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(bob)

    attrs = message_attrs()

    assert {:ok, first} = Chat.send_message(alice, conversation.id, attrs)

    assert_receive %Phoenix.Socket.Broadcast{
      topic: topic,
      event: "message:new",
      payload: %{id: id}
    }

    assert topic == user_topic(bob)
    assert id == first.id

    # The retry returns the original message and writes nothing; recipients must
    # not see the same message twice.
    assert {:ok, second} = Chat.send_message(alice, conversation.id, attrs)
    assert second.id == first.id

    refute_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "message:new"}, 200
  end

  test "a repeated ack does not re-broadcast", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())
    assert_receive %Phoenix.Socket.Broadcast{event: "message:new"}

    assert :ok = Chat.ack_delivered(bob, message.id)

    assert_receive %Phoenix.Socket.Broadcast{
      event: "message:delivered",
      payload: %{deliveredCount: 1}
    }

    # Acking the same row again is idempotent and stays silent.
    assert :ok = Chat.ack_delivered(bob, message.id)
    refute_receive %Phoenix.Socket.Broadcast{event: "message:delivered"}, 200
  end

  test "an ack for a message the user never received tells nobody", %{
    alice: alice,
    bob: bob
  } do
    join(alice)

    # Bob is not a participant of this conversation at all.
    carol = create_user("+15550007003")
    conversation = friends_with(alice, carol)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())
    assert_receive %Phoenix.Socket.Broadcast{event: "message:new"}

    assert :ok = Chat.ack_delivered(bob, message.id)

    refute_receive %Phoenix.Socket.Broadcast{event: "message:delivered"}, 200
  end

  defp join(user) do
    {:ok, _reply, socket} =
      socket(AwsemChatWeb.UserSocket, user.id, %{user_id: user.id, token: user.token})
      |> subscribe_and_join(UserChannel, user_topic(user))

    socket
  end

  defp user_topic(user), do: "user:#{user.id}"

  defp friends_with(alice, bob) do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)
    conversation
  end

  defp message_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "hello"}
      },
      attrs
    )
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end
end
