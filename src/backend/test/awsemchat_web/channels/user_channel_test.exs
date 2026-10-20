defmodule AwsemChatWeb.UserChannelTest do
  use AwsemChatWeb.ChannelCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Social

  alias AwsemChatWeb.{UserChannel, UserSocket}

  setup do
    alice = create_user("+15550006001")
    bob = create_user("+15550006002")
    conversation = friends_with(alice, bob)

    %{alice: alice, bob: bob, conversation: conversation}
  end

  test "test_socket_rejects_bad_token" do
    assert :error = connect_socket(UserSocket, %{"token" => "not-a-real-token"})
    assert :error = connect_socket(UserSocket, %{})
  end

  test "test_socket_authenticates_a_valid_token", %{alice: alice} do
    assert {:ok, socket} = connect(UserSocket, %{"token" => alice.token})
    assert socket.assigns.user_id == alice.id
  end

  test "test_message_new_fans_out_to_both_participants", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(bob)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    assert_push "message:new", %{
      message: %{id: id, senderId: sender_id, conversationId: conversation_id}
    }

    assert id == message.id
    assert sender_id == alice.id
    assert conversation_id == conversation.id
  end

  test "test_join_rejects_another_users_topic", %{
    alice: alice,
    bob: bob
  } do
    assert {:error, %{reason: "unauthorized"}} =
             user_socket(alice)
             |> subscribe_and_join(UserChannel, "user:#{bob.id}")
  end

  test "test_ack_delivered_notifies_sender", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    # Empty the sender's own message:new so the delivered event is unambiguous.
    assert_push "message:new", %{message: %{id: id}}
    assert id == message.id

    bob_socket = join(bob)

    ref = push(bob_socket, "message:ack", %{"messageId" => message.id})
    assert_reply ref, :ok

    assert_push "message:delivered", %{
      messageId: delivered_id,
      deliveredCount: delivered,
      totalCount: total
    }

    assert delivered_id == message.id
    assert delivered == 1
    assert total == 2
  end

  test "test_no_fanout_after_unfriend", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(bob)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    assert_receive %Phoenix.Socket.Broadcast{
      topic: topic,
      event: "message:new"
    }

    assert topic == user_topic(bob)

    # Unfriend through the API, as the mobile client would.
    assert %{} =
             build_conn()
             |> authenticate(alice.token)
             |> delete("/api/v1/friends/#{bob.id}")
             |> json_response(200)

    # The send gate refuses the second message.
    assert {:error, :conversation_read_only} =
             Chat.send_message(alice, conversation.id, message_attrs())

    refute_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "message:new"}, 200

    # Even if a broadcast is triggered again (fan-out must re-check auth),
    # a recipient who lost friendship must not receive it.
    AwsemChat.Chat.Broadcast.message_new(message)
    refute_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "message:new"}, 200
    assert AwsemChat.Chat.authorized_recipients(conversation.id) == []
  end

  test "test_ack_does_not_flip_another_users_delivery", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    join(alice)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())
    assert_push "message:new", %{}

    # Alice, the sender, acking her own row is fine; Bob's row must stay pending.
    assert :ok = Chat.ack_delivered(alice, message.id)

    deliveries = Chat.list_deliveries(message)
    alice_row = Enum.find(deliveries, &(&1.user_id == alice.id))
    bob_row = Enum.find(deliveries, &(&1.user_id == bob.id))

    refute is_nil(alice_row.delivered_at)
    assert is_nil(bob_row.delivered_at)
  end

  test "test_ack_for_a_message_you_never_received_is_a_noop", %{alice: alice, bob: bob} do
    carol = create_user("+15550006003")
    conversation = friends_with(alice, carol)

    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    # Bob was never an intended recipient; his ack writes nothing and tells
    # nobody. It is not an error, so message ids are not probeable.
    assert :ok = Chat.ack_delivered(bob, message.id)

    assert Enum.all?(Chat.list_deliveries(message), &is_nil(&1.delivered_at))
  end

  defp user_socket(%{id: id, token: token}) do
    socket(UserSocket, id, %{user_id: id, token: token})
  end

  defp user_topic(%{id: id}), do: "user:#{id}"

  defp join(user) do
    {:ok, _reply, socket} = subscribe_and_join(user_socket(user), UserChannel, user_topic(user))
    socket
  end

  defp connect_socket(socket_module, params) do
    case connect(socket_module, params) do
      {:ok, _socket} -> :ok
      :error -> :error
    end
  end

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

  defp authenticate(conn, token), do: put_req_header(conn, "authorization", "Bearer #{token}")
end
