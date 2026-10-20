defmodule AwsemChat.SocialTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.Conversation
  alias AwsemChat.Social
  alias AwsemChat.Social.FriendRequest
  alias AwsemChat.Social.Friendship

  setup do
    %{alice: create_user("+15550003001"), bob: create_user("+15550003002")}
  end

  test "test_request_by_pin_creates_pending", %{alice: alice, bob: bob} do
    assert {:ok, %FriendRequest{} = request} = Social.request_by_pin(alice, bob.pin)

    assert request.sender_id == alice.id
    assert request.recipient_id == bob.id
    assert request.state == :pending

    assert {:ok, pending} = Social.list_requests(bob, :incoming)
    assert Enum.map(pending, & &1.id) == [request.id]

    assert {:ok, sent} = Social.list_requests(alice, :outgoing)
    assert Enum.map(sent, & &1.id) == [request.id]
  end

  test "test_request_by_pin_unknown_pin_is_not_found", %{alice: alice} do
    assert {:error, :not_found} = Social.request_by_pin(alice, "ZZZZZZ")
  end

  test "test_request_by_own_pin_is_self", %{alice: alice} do
    assert {:error, :self} = Social.request_by_pin(alice, alice.pin)
  end

  test "test_request_by_pin_when_already_friends_is_already_friends", %{
    alice: alice,
    bob: bob
  } do
    accept(alice, bob)

    assert {:error, :already_friends} = Social.request_by_pin(alice, bob.pin)
  end

  test "test_accept_creates_friendship_and_private_conversation", %{alice: alice, bob: bob} do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)

    assert {:ok, %FriendRequest{state: :accepted}} = Social.respond(bob, request.id, :accept)

    assert Social.are_friends?(alice, bob)
    assert Social.are_friends?(bob, alice)

    # One row per direction.
    assert Repo.aggregate(from(f in Friendship, where: f.user_id == ^alice.id), :count) == 1
    assert Repo.aggregate(from(f in Friendship, where: f.user_id == ^bob.id), :count) == 1

    # The private conversation exists, with the sorted-pair key and unique either way round.
    key = Enum.sort([alice.id, bob.id]) |> Enum.join(":")
    conversation = Repo.get_by(Conversation, private_key: key)
    assert %Conversation{type: :private} = conversation

    # Asking again (either direction) resolves the same row rather than a second one.
    assert {:ok, same} = Social.private_conversation(alice, bob)
    assert {:ok, ^same} = Social.private_conversation(bob, alice)
    assert same.id == conversation.id
  end

  test "test_decline_creates_no_friendship", %{alice: alice, bob: bob} do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)

    assert {:ok, %FriendRequest{state: :declined}} = Social.respond(bob, request.id, :decline)
    refute Social.are_friends?(alice, bob)
    assert Repo.aggregate(Conversation, :count) == 0
  end

  test "test_only_recipient_can_accept_or_decline", %{alice: alice, bob: bob} do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)

    assert {:error, :not_found} = Social.respond(alice, request.id, :accept)
    assert {:error, :not_found} = Social.respond(alice, request.id, :decline)

    # The sender cancels; nobody else can.
    assert {:ok, %FriendRequest{state: :cancelled}} = Social.respond(alice, request.id, :cancel)
    assert {:error, :not_found} = Social.respond(bob, request.id, :cancel)
  end

  test "test_respond_to_an_already_answered_request_is_not_found", %{alice: alice, bob: bob} do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)

    assert {:error, :not_found} = Social.respond(bob, request.id, :accept)
  end

  test "test_blocked_cannot_request", %{alice: alice, bob: bob} do
    assert :ok = Social.block(alice, bob)

    assert {:error, :blocked} = Social.request_by_pin(bob, alice.pin)
  end

  test "test_block_stops_new_requests", %{alice: alice, bob: bob} do
    # A pending request already in flight...
    {:ok, request} = Social.request_by_pin(alice, bob.pin)

    # ...a block in either direction stops the answer and any fresh request.
    assert :ok = Social.block(bob, alice)

    assert {:error, :blocked} = Social.respond(bob, request.id, :accept)
    assert {:error, :blocked} = Social.request_by_pin(alice, bob.pin)
    assert {:error, :blocked} = Social.request_by_pin(bob, alice.pin)
  end

  test "test_block_after_friendship_keeps_conversation_read_only", %{alice: alice, bob: bob} do
    conversation = accept(alice, bob)
    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    assert :ok = Social.block(alice, bob)

    # A block is symmetric in effect: neither side may send, so the person
    # blocked cannot tell who did it.
    assert {:error, :blocked} = Chat.send_message(alice, conversation.id, message_attrs())
    assert {:error, :blocked} = Chat.send_message(bob, conversation.id, message_attrs())

    # History stays readable and the row stays visible.
    assert {:ok, %{messages: [listed]}} = Chat.list_messages(alice, conversation.id, %{})
    assert listed.id == message.id
    assert {:ok, %{messages: [_]}} = Chat.list_messages(bob, conversation.id, %{})
  end

  test "test_unblock_restores_sending_between_friends", %{alice: alice, bob: bob} do
    conversation = accept(alice, bob)

    assert :ok = Social.block(alice, bob)
    assert {:error, :blocked} = Chat.send_message(bob, conversation.id, message_attrs())

    assert :ok = Social.unblock(alice, bob)
    refute Social.blocked_either?(alice, bob)
    assert {:ok, _} = Chat.send_message(bob, conversation.id, message_attrs())
  end

  test "test_unfriend_keeps_conversation_visible_readonly", %{alice: alice, bob: bob} do
    conversation = accept(alice, bob)
    assert {:ok, message} = Chat.send_message(alice, conversation.id, message_attrs())

    assert :ok = Social.unfriend(alice, bob)

    refute Social.are_friends?(alice, bob)
    refute Social.are_friends?(bob, alice)

    # The row and its history survive; both sides may still read.
    assert {:ok, %{messages: [listed]}} = Chat.list_messages(alice, conversation.id, %{})
    assert listed.id == message.id
    assert {:ok, %{messages: [_]}} = Chat.list_messages(bob, conversation.id, %{})

    # New sends are refused, not lost.
    assert {:error, :conversation_read_only} =
             Chat.send_message(alice, conversation.id, message_attrs())

    assert {:error, :conversation_read_only} =
             Chat.send_message(bob, conversation.id, message_attrs())
  end

  test "test_unfriend_twice_is_ok", %{alice: alice, bob: bob} do
    accept(alice, bob)

    assert :ok = Social.unfriend(alice, bob)
    assert :ok = Social.unfriend(alice, bob)
    assert :ok = Social.unfriend(bob, alice)
  end

  test "test_unfriend_removes_both_directions", %{alice: alice, bob: bob} do
    accept(alice, bob)

    assert :ok = Social.unfriend(alice, bob)

    assert Repo.aggregate(Friendship, :count) == 0
  end

  test "test_request_after_unfriend_is_allowed_again", %{alice: alice, bob: bob} do
    accept(alice, bob)
    assert :ok = Social.unfriend(alice, bob)

    assert {:ok, %FriendRequest{state: :pending}} = Social.request_by_pin(alice, bob.pin)
  end

  test "test_blocked_pair_cannot_be_friends", %{alice: alice, bob: bob} do
    assert {:ok, pending} = Social.request_by_pin(alice, bob.pin)

    assert :ok = Social.block(bob, alice)

    assert {:error, :blocked} = Social.respond(bob, pending.id, :accept)
    refute Social.are_friends?(alice, bob)
  end

  test "test_repeated_request_does_not_duplicate_pending", %{alice: alice, bob: bob} do
    assert {:ok, first} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, second} = Social.request_by_pin(alice, bob.pin)

    assert first.id == second.id
    assert Repo.aggregate(FriendRequest, :count) == 1
  end

  test "test_blocked_either_is_false_for_unrelated_pair", %{alice: alice, bob: bob} do
    refute Social.blocked_either?(alice, bob)
    refute Social.are_friends?(alice, bob)
  end

  test "test_block_and_unblock_are_idempotent", %{alice: alice, bob: bob} do
    assert :ok = Social.block(alice, bob)
    assert :ok = Social.block(alice, bob)
    assert :ok = Social.unblock(alice, bob)
    assert :ok = Social.unblock(alice, bob)

    refute Social.blocked_either?(alice, bob)
  end

  test "test_blocked_users_listed_for_the_blocker", %{alice: alice, bob: bob} do
    assert :ok = Social.block(alice, bob)

    assert [blocked] = Social.list_blocked(alice)
    assert blocked.id == bob.id

    assert Social.list_blocked(bob) == []
  end

  defp accept(alice, bob) do
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
        payload: %{"v" => 1, "text" => "hi"}
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
