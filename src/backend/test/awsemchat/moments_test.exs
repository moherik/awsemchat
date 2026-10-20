defmodule AwsemChat.MomentsTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Circles
  alias AwsemChat.Moments
  alias AwsemChat.Social
  alias AwsemChat.Chat.CircleInvitation
  alias AwsemChat.Repo

  setup do
    alice = create_user("+15550010001")
    bob = create_user("+15550010002")
    carol = create_user("+15550010003")

    conversation = friends_with(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "test_create_and_list_moment", %{alice: alice, conversation: conv} do
    attrs = moment_attrs(%{kind: :text, payload: %{"v" => 1, "text" => "My moment"}})

    assert {:ok, moment} = Moments.create(alice, conv.id, attrs)
    assert moment.conversation_id == conv.id
    assert moment.author_id == alice.id
    assert moment.kind == :text

    assert {:ok, %{moments: moments}} = Moments.list(alice, conv.id, %{})
    assert length(moments) == 1
    assert List.first(moments).id == moment.id
  end

  test "test_only_author_can_promote", %{alice: alice, bob: bob, conversation: conv} do
    # Send a message from alice
    {:ok, message} =
      Chat.send_message(
        alice,
        conv.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "message to promote"}})
      )

    # Bob tries to promote alice's message - should fail
    assert {:error, :forbidden} =
             Moments.create(bob, conv.id, %{
               clientOpId: Ecto.UUID.generate(),
               kind: :text,
               payload: %{"v" => 1, "text" => "promoted"},
               sourceMessageId: message.id
             })

    # Alice can promote her own message
    assert {:ok, moment} =
             Moments.create(alice, conv.id, %{
               clientOpId: Ecto.UUID.generate(),
               kind: :text,
               payload: %{"v" => 1, "text" => "promoted"},
               sourceMessageId: message.id
             })

    assert moment.source_message_id == message.id
  end

  test "test_only_author_can_delete", %{alice: alice, bob: bob, conversation: conv} do
    {:ok, moment} = Moments.create(alice, conv.id, moment_attrs())

    # Bob cannot delete
    assert {:error, :forbidden} = Moments.delete(bob, moment.id)

    # Alice can delete
    assert :ok = Moments.delete(alice, moment.id)

    assert {:ok, %{moments: moments}} = Moments.list(alice, conv.id, %{})
    assert length(moments) == 0
  end

  test "test_new_member_cannot_see_prejoin_moment", %{alice: alice, bob: bob} do
    # Create circle
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # Alice creates a moment before Bob joins
    {:ok, moment} = Moments.create(alice, circle.id, moment_attrs())

    # Invite and accept Bob (they are already friends from setup)
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)

    # Bob should not see pre-join moment
    assert {:ok, %{moments: moments}} = Moments.list(bob, circle.id, %{})
    refute Enum.any?(moments, fn m -> m.id == moment.id end)
  end

  defp moment_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "hello"}
      },
      attrs
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

  defp friends_with(alice, bob) do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)
    conversation
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end
end
