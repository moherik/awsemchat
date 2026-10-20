defmodule AwsemChat.ReactionsTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Circles
  alias AwsemChat.Moments
  alias AwsemChat.Reactions
  alias AwsemChat.Social
  alias AwsemChat.Repo

  setup do
    alice = create_user("+15550020001")
    bob = create_user("+15550020002")
    carol = create_user("+15550020003")

    conversation = friends_with(alice, bob)

    {:ok, message} =
      Chat.send_message(
        alice,
        conversation.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "hello"}})
      )

    {:ok, moment} =
      Moments.create(alice, conversation.id, moment_attrs(%{payload: %{"v" => 1, "text" => "m"}}))

    %{
      alice: alice,
      bob: bob,
      carol: carol,
      conversation: conversation,
      message: message,
      moment: moment
    }
  end

  test "test_toggle_reaction_unique_per_user", %{alice: alice, message: message} do
    assert {:ok, _} = Reactions.set(alice, :message, message.id, "👍")
    assert {:ok, _} = Reactions.set(alice, :message, message.id, "👍")

    aggregates = Reactions.list_for(alice, :message, [message.id])

    users_for_thumb =
      Map.get(aggregates, message.id, [])
      |> Enum.filter(&(&1.emoji == "👍"))
      |> Enum.map(& &1.userId)

    assert users_for_thumb == [alice.id]
  end

  test "test_aggregate_counts", %{alice: alice, bob: bob, message: message} do
    assert {:ok, _} = Reactions.set(alice, :message, message.id, "👍")
    assert {:ok, _} = Reactions.set(bob, :message, message.id, "❤️")
    assert {:ok, _} = Reactions.set(bob, :message, message.id, "👍")

    aggregates = Reactions.list_for(alice, :message, [message.id])
    reactions = Map.get(aggregates, message.id, []) |> Enum.sort_by(&{&1.emoji, &1.userId})

    assert reactions ==
             [
               %{emoji: "👍", userId: alice.id},
               %{emoji: "👍", userId: bob.id}
             ]
             |> Enum.sort_by(&{&1.emoji, &1.userId})
  end

  test "test_cannot_react_to_invisible_target", %{alice: alice, bob: bob} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert {:ok, moment} = Moments.create(alice, circle.id, moment_attrs())

    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(AwsemChat.Chat.CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)

    assert {:error, :not_found} = Reactions.set(bob, :moment, moment.id, "👍")
  end

  test "test_cannot_react_to_a_prejoin_message", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # A message before Bob joins the circle.
    {:ok, prejoin} =
      Chat.send_message(alice, circle.id, message_attrs(%{payload: %{"v" => 1, "text" => "pre"}}))

    {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(AwsemChat.Chat.CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    {:ok, _} = Circles.respond(bob, inv.id, :accept)

    # Membership alone is not enough: the join boundary applies to reactions too.
    assert {:error, :not_found} = Reactions.set(bob, :message, prejoin.id, "👍")
    assert {:error, :not_found} = Reactions.unset(bob, :message, prejoin.id)

    # A message after the join is fair game.
    {:ok, postjoin} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "post"}})
      )

    assert {:ok, _} = Reactions.set(bob, :message, postjoin.id, "👍")
  end

  test "test_list_for_hides_prejoin_aggregates", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    {:ok, prejoin} =
      Chat.send_message(alice, circle.id, message_attrs(%{payload: %{"v" => 1, "text" => "pre"}}))

    assert {:ok, _} = Reactions.set(alice, :message, prejoin.id, "👍")

    {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(AwsemChat.Chat.CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    {:ok, _} = Circles.respond(bob, inv.id, :accept)

    # Alice sees her own aggregate; Bob (late joiner) gets nothing for it.
    assert Map.has_key?(Reactions.list_for(alice, :message, [prejoin.id]), prejoin.id)
    assert Reactions.list_for(bob, :message, [prejoin.id]) == %{}
  end

  test "test_unset_broadcasts_reaction_changed", %{alice: alice, bob: bob, conversation: conv} do
    AwsemChatWeb.Endpoint.subscribe("user:#{alice.id}")

    {:ok, message} =
      Chat.send_message(alice, conv.id, message_attrs(%{payload: %{"v" => 1, "text" => "react"}}))

    assert {:ok, _} = Reactions.set(bob, :message, message.id, "👍")
    assert_receive %Phoenix.Socket.Broadcast{event: "reaction:changed"}

    assert {:ok, _} = Reactions.unset(bob, :message, message.id)

    # The removal must reach clients symmetrically with the add.
    assert_receive %Phoenix.Socket.Broadcast{
      event: "reaction:changed",
      payload: %{
        conversationId: cid,
        targetType: "message",
        targetId: tid
      }
    }

    assert cid == conv.id
    assert tid == message.id
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
