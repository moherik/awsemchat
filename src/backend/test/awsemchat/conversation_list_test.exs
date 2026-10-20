defmodule AwsemChat.ConversationListTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.{CircleInvitation, Position}
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

    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: carol.id)

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
    assert conv.unread_count == 0

    {:ok, _msg1} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "one"}})
      )

    assert {:ok, %{conversations: list2}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv2] = Enum.filter(list2, fn c -> c.id == private_convo.id end)
    assert conv2.unread_count == 1

    {:ok, msg2} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "two"}})
      )

    assert {:ok, %{conversations: list3}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv3] = Enum.filter(list3, fn c -> c.id == private_convo.id end)
    assert conv3.unread_count == 2

    assert {:ok, _} = Chat.put_position(alice, private_convo.id, msg2.id)

    assert {:ok, %{conversations: list4}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv4] = Enum.filter(list4, fn c -> c.id == private_convo.id end)
    assert conv4.unread_count == 0
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

    # No position field of any shape, and no foreign read state.
    refute Map.has_key?(conv, :position)
    refute Map.has_key?(conv, :peerPosition)
    refute Map.has_key?(conv, :last_seen_message_id)
    refute match?(%{position: %{user_id: _}}, conv)
    assert is_map(conv.preferences)
  end

  # --- position write boundary (Critical 1) ------------------------------------

  test "test_position_for_foreign_conversation_message_is_rejected", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    # A second private conversation Alice is in, plus a message in it.
    dave = create_user("+15550009004")
    {:ok, request} = Social.request_by_pin(alice, dave.pin)
    {:ok, _} = Social.respond(dave, request.id, :accept)
    {:ok, other_convo} = Social.private_conversation(alice, dave)

    {:ok, other_msg} =
      Chat.send_message(
        dave,
        other_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "elsewhere"}})
      )

    {:ok, _unread} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "here"}})
      )

    # Alice cannot point her position in A at a message in B …
    assert {:error, :not_found} = Chat.put_position(alice, private_convo.id, other_msg.id)

    # … and A's unread is untouched by the rejected write.
    assert {:ok, %{conversations: list}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv] = Enum.filter(list, fn c -> c.id == private_convo.id end)
    assert conv.unread_count == 1
  end

  test "test_position_for_unreadable_message_is_rejected", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    # A conversation Alice is not part of; a message in it she cannot read.
    dave = create_user("+15550009005")
    erin = create_user("+15550009006")
    {:ok, request} = Social.request_by_pin(dave, erin.pin)
    {:ok, _} = Social.respond(erin, request.id, :accept)
    {:ok, hidden_convo} = Social.private_conversation(dave, erin)

    {:ok, hidden_msg} =
      Chat.send_message(
        dave,
        hidden_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "private"}})
      )

    {:ok, _} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "hi"}})
      )

    assert {:error, :not_found} = Chat.put_position(alice, private_convo.id, hidden_msg.id)

    assert {:ok, %{conversations: list}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv] = Enum.filter(list, fn c -> c.id == private_convo.id end)
    assert conv.unread_count == 1

    # Still writable to a real message in the conversation.
    {:ok, own_msg} =
      Chat.send_message(
        alice,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "mine"}})
      )

    assert {:ok, %Position{}} = Chat.put_position(alice, private_convo.id, own_msg.id)
  end

  test "test_position_with_non_uuid_is_rejected", %{alice: alice, private_convo: private_convo} do
    assert {:error, :not_found} = Chat.put_position(alice, private_convo.id, "not-a-uuid")
  end

  # --- dangling position on read (Critical 2) ----------------------------------

  test "test_dangling_position_counts_from_beginning_not_zero", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    {:ok, _} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "one"}})
      )

    {:ok, _} =
      Chat.send_message(
        bob,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "two"}})
      )

    # Forge a dangling position directly (the column has no FK). This is
    # reachable through an old row or a hand-edited value, so the read path must
    # treat it conservatively: everything in the window is unread, never zero.
    Repo.insert!(%Position{
      conversation_id: private_convo.id,
      user_id: alice.id,
      last_seen_message_id: Ecto.UUID.generate()
    })

    assert {:ok, %{conversations: list}} =
             Chat.list_conversations(alice, %{filter: :all})

    [conv] = Enum.filter(list, fn c -> c.id == private_convo.id end)
    assert conv.unread_count == 2
  end

  # --- circle boundaries and membership ---------------------------------------

  test "test_circle_unread_respects_join_boundary", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Later"})

    # A message before Bob joins.
    {:ok, _pre} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "before"}})
      )

    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    {:ok, _} = Circles.respond(bob, inv.id, :accept)

    assert {:ok, %{conversations: list}} = Chat.list_conversations(bob, %{filter: :all})
    [conv] = Enum.filter(list, fn c -> c.id == circle.id end)

    # The pre-join message is outside Bob's window: not unread.
    assert conv.unread_count == 0

    # A message after the join is unread.
    {:ok, _post} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "after"}})
      )

    assert {:ok, %{conversations: list2}} = Chat.list_conversations(bob, %{filter: :all})
    [conv2] = Enum.filter(list2, fn c -> c.id == circle.id end)
    assert conv2.unread_count == 1
  end

  test "test_left_member_circle_absent_from_list", %{alice: alice, carol: carol, circle: circle} do
    assert {:ok, %{conversations: before}} = Chat.list_conversations(carol, %{filter: :all})
    assert Enum.any?(before, fn c -> c.id == circle.id end)

    assert :ok = Circles.leave(carol, circle.id)

    assert {:ok, %{conversations: after_list}} = Chat.list_conversations(carol, %{filter: :all})
    refute Enum.any?(after_list, fn c -> c.id == circle.id end)

    # The owner still sees it.
    assert {:ok, %{conversations: owner_list}} = Chat.list_conversations(alice, %{filter: :all})
    assert Enum.any?(owner_list, fn c -> c.id == circle.id end)
  end

  test "test_removed_member_circle_absent_from_list", %{
    alice: alice,
    carol: carol,
    circle: circle
  } do
    assert :ok = Circles.remove_member(alice, circle.id, carol.id)

    assert {:ok, %{conversations: list}} = Chat.list_conversations(carol, %{filter: :all})
    refute Enum.any?(list, fn c -> c.id == circle.id end)
  end

  # --- deterministic pin ordering ---------------------------------------------

  test "test_pinned_tie_break_is_deterministic", %{
    alice: alice,
    private_convo: private_convo,
    circle: circle
  } do
    # Both pinned with the same pinOrder: the id is the stable final tiebreak.
    assert {:ok, _} = Chat.put_preferences(alice, private_convo.id, %{pinned: true, pinOrder: 0})
    assert {:ok, _} = Chat.put_preferences(alice, circle.id, %{pinned: true, pinOrder: 0})

    assert {:ok, %{conversations: list}} = Chat.list_conversations(alice, %{filter: :all})

    pinned_ids = list |> Enum.take(2) |> Enum.map(& &1.id)
    assert Enum.sort(pinned_ids) == pinned_ids

    # Repeated calls return the same order.
    for _ <- 1..5 do
      assert {:ok, %{conversations: again}} = Chat.list_conversations(alice, %{filter: :all})
      assert again |> Enum.take(2) |> Enum.map(& &1.id) == pinned_ids
    end
  end

  # --- includeArchived × filter ------------------------------------------------

  test "test_include_archived_with_each_filter", %{
    alice: alice,
    private_convo: private_convo,
    circle: circle
  } do
    # Alice may have other private conversations (a friendship created one in
    # setup), so assert on the archived pair specifically, not the whole list.
    assert {:ok, _} = Chat.put_preferences(alice, private_convo.id, %{archived: true})
    assert {:ok, _} = Chat.put_preferences(alice, circle.id, %{archived: true})

    # :all — hidden unless requested
    assert {:ok, %{conversations: all_hidden}} = Chat.list_conversations(alice, %{filter: :all})
    refute Enum.any?(all_hidden, &(&1.id in [private_convo.id, circle.id]))

    assert {:ok, %{conversations: all_shown}} =
             Chat.list_conversations(alice, %{filter: :all, includeArchived: true})

    assert Enum.any?(all_shown, &(&1.id == private_convo.id))
    assert Enum.any?(all_shown, &(&1.id == circle.id))

    # :private
    assert {:ok, %{conversations: private_hidden}} =
             Chat.list_conversations(alice, %{filter: :private})

    refute Enum.any?(private_hidden, &(&1.id == private_convo.id))
    refute Enum.any?(private_hidden, &(&1.type == :circle))

    assert {:ok, %{conversations: private_shown}} =
             Chat.list_conversations(alice, %{filter: :private, includeArchived: true})

    assert Enum.any?(private_shown, &(&1.id == private_convo.id))
    refute Enum.any?(private_shown, &(&1.type == :circle))

    # :circles
    assert {:ok, %{conversations: circles_hidden}} =
             Chat.list_conversations(alice, %{filter: :circles})

    refute Enum.any?(circles_hidden, &(&1.id == circle.id))
    refute Enum.any?(circles_hidden, &(&1.type == :private))

    assert {:ok, %{conversations: circles_shown}} =
             Chat.list_conversations(alice, %{filter: :circles, includeArchived: true})

    assert Enum.map(circles_shown, & &1.id) == [circle.id]
  end

  # --- history outlives the friendship (Task 4 carry-forward) ------------------

  test "test_private_conversation_listed_after_unfriend", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    assert :ok = Social.unfriend(alice, bob)

    assert {:ok, %{conversations: list}} = Chat.list_conversations(alice, %{filter: :all})
    assert Enum.any?(list, fn c -> c.id == private_convo.id end)
  end

  test "test_private_conversation_listed_after_block", %{
    alice: alice,
    bob: bob,
    private_convo: private_convo
  } do
    assert :ok = Social.block(alice, bob)

    # Both sides keep the history.
    assert {:ok, %{conversations: list}} = Chat.list_conversations(alice, %{filter: :all})
    assert Enum.any?(list, fn c -> c.id == private_convo.id end)

    assert {:ok, %{conversations: bobs}} = Chat.list_conversations(bob, %{filter: :all})
    assert Enum.any?(bobs, fn c -> c.id == private_convo.id end)
  end

  # --- pagination ---------------------------------------------------------------

  test "test_list_paginates_with_cursor", %{
    alice: alice,
    private_convo: private_convo,
    circle: circle
  } do
    {:ok, _} =
      Chat.send_message(
        alice,
        private_convo.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "a"}})
      )

    {:ok, _} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "b"}})
      )

    assert {:ok, %{conversations: page1, nextCursor: cursor}} =
             Chat.list_conversations(alice, %{filter: :all, limit: 1})

    assert length(page1) == 1
    assert is_binary(cursor)

    assert {:ok, %{conversations: page2}} =
             Chat.list_conversations(alice, %{filter: :all, limit: 1, cursor: cursor})

    assert length(page2) == 1
    refute Enum.map(page2, & &1.id) == Enum.map(page1, & &1.id)
  end

  test "test_list_cursor_ends_the_walk", %{alice: alice} do
    assert {:ok, %{conversations: page1, nextCursor: cursor}} =
             Chat.list_conversations(alice, %{filter: :all, limit: 100})

    assert length(page1) >= 1
    assert cursor == nil
  end

  test "test_list_rejects_a_malformed_cursor", %{alice: alice} do
    assert {:error, :invalid_cursor} =
             Chat.list_conversations(alice, %{filter: :all, cursor: "not-a-cursor"})
  end

  defp get_pending_request_id(recipient, sender) do
    alias AwsemChat.Social.FriendRequest

    Repo.one(
      from(r in FriendRequest,
        where:
          r.recipient_id == ^recipient.id and r.sender_id == ^sender.id and r.state == :pending,
        select: r.id
      )
    )
  end

  defp message_attrs(attrs) do
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
