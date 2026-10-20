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

    aggregates = Reactions.list_for(:message, [message.id])

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

    aggregates = Reactions.list_for(:message, [message.id])
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
