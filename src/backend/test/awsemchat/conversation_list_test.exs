defmodule AwsemChat.ConversationListTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Circles
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550009001")
    bob = create_user("+15550009002")
    carol = create_user("+15550009003")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, private_convo} = Social.private_conversation(alice, bob)

    {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    {:ok, _} = Social.request_by_pin(alice, carol.pin)
    {:ok, _} = Social.respond(carol, get_pending_request_id(carol, alice), :accept)
    {:ok, _} = Circles.invite(alice, circle.id, [carol.id])

    inv =
      Repo.get_by!(AwsemChat.Chat.CircleInvitation, circle_id: circle.id, invitee_id: carol.id)

    {:ok, _} = Circles.respond(carol, inv.id, :accept)

    %{alice: alice, bob: bob, carol: carol, private_convo: private_convo, circle: circle}
  end

  test "test_pinned_sorts_first_archived_hidden", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo,
    circle: circle
  } do
    {:ok, _msg} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "hi"}})
      )

    {:ok, _msg2} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "circle msg"}})
      )

    assert {:ok, %{conversations: list1}} =
             Chat.list_conversations(alice, %{filter: :all})

    refute Enum.any?(list1, fn c -> c.preferences.archived end)

    assert {:ok, _} = Chat.put_preferences(alice, private_convo.id, %{archived: true})

    assert {:ok, %{conversations: list2}} =
             Chat.list_conversations(alice, %{filter: :all})

    refute Enum.any?(list2, fn c -> c.id == private_convo.id end)

    assert {:ok, %{conversations: list3}} =
             Chat.list_conversations(alice, %{filter: :all, includeArchived: true})

    assert Enum.any?(list3, fn c -> c.id == private_convo.id and c.preferences.archived end)

    # Pin circle so it comes first
    assert {:ok, _} = Chat.put_preferences(alice, circle.id, %{pinned: true, pinOrder: 0})

    assert {:ok, %{conversations: list4}} =
             Chat.list_conversations(alice, %{filter: :all})

    [first | _] = list4
    assert first.id == circle.id
    assert first.preferences.pinned
  end

  test "test_unread_count_increases_and_position_clears", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    assert {:ok, %{conversations: list1}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv] = Enum.filter(list1, fn c -> c.id == private_convo.id end)
    assert conv.unreadCount == 0

    {:ok, msg1} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "one"}})
      )

    assert {:ok, %{conversations: list2}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv2] = Enum.filter(list2, fn c -> c.id == private_convo.id end)
    assert conv2.unreadCount == 1

    {:ok, msg2} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "two"}})
      )

    assert {:ok, %{conversations: list3}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv3] = Enum.filter(list3, fn c -> c.id == private_convo.id end)
    assert conv3.unreadCount == 2

    assert {:ok, _} = Chat.put_position(alice, private_convo.id, msg2.id)

    assert {:ok, %{conversations: list4}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv4] = Enum.filter(list4, fn c -> c.id == private_convo.id end)
    assert conv4.unreadCount == 0
  end

  test "test_conversation_list_contains_no_foreign_read_state", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    {:ok, msg1} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "hi"}})
      )

    # Bob sets his position
    assert {:ok, _} = Chat.put_position(bob, private_convo.id, msg1.id)

    assert {:ok, %{conversations: list}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv] = Enum.filter(list, fn c -> c.id == private_convo.id end)

    # Response must contain NO foreign read state — only the requesting user's position/preferences
    refute Map.has_key?(conv, :peerPosition)
    refute Map.has_key?(conv, :peer_last_seen)
    refute Map.has_key?(conv, :bob_position)
    refute match?(%{position: %{user_id: _}}, conv)
    # Also ensure no position info from others
    assert is_map(conv.preferences)
  end

  defp get_pending_request_id(recipient, sender) do
    import Ecto.Query
    alias AwsemChat.Social.FriendRequest
    alias AwsemChat.Repo

    Repo.one(
      from(r in FriendRequest,
        where:
          r.recipient_id == ^recipient.id and r.sender_id == ^sender.id and r.state == :pending,
        select: r.id
      )
    )
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
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end
end
