defmodule AwsemChat.Chat.BroadcastEventsTest do
  @moduledoc """
  The social and circle events: `friend_request:changed`, `friends:changed`,
  `circle:changed`. One test per family pins the event name, the topic it lands
  on, and the payload shape the client parses.

  Assertions match the raw `Phoenix.Socket.Broadcast` on the `"user:<id>"`
  topic, so "Bob received it, Carol did not" is unambiguous.
  """

  use AwsemChatWeb.ChannelCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat.CircleInvitation
  alias AwsemChat.Circles
  alias AwsemChat.Repo
  alias AwsemChat.Social

  alias AwsemChatWeb.UserChannel

  test "friend_request:changed reaches both parties with the REST shape" do
    alice = create_user("+15550008001")
    bob = create_user("+15550008002")

    join(alice)
    join(bob)

    assert {:ok, request} = Social.request_by_pin(alice, bob.pin)

    for topic <- [user_topic(alice), user_topic(bob)] do
      assert_receive %Phoenix.Socket.Broadcast{
        topic: ^topic,
        event: "friend_request:changed",
        payload: %{request: %{id: id, state: "pending", sender: %{id: sender_id}}}
      }

      assert id == request.id
      assert sender_id == alice.id
    end
  end

  test "friends:changed reaches both parties when a request is accepted" do
    alice = create_user("+15550008003")
    bob = create_user("+15550008004")

    join(alice)
    join(bob)

    assert {:ok, request} = Social.request_by_pin(alice, bob.pin)
    # Drain the request event so the accept event is unambiguous.
    for _ <- 1..2, do: assert_receive(%Phoenix.Socket.Broadcast{event: "friend_request:changed"})

    assert {:ok, _} = Social.respond(bob, request.id, :accept)

    for topic <- [user_topic(alice), user_topic(bob)] do
      assert_receive %Phoenix.Socket.Broadcast{
        topic: ^topic,
        event: "friends:changed",
        payload: %{}
      }
    end
  end

  test "circle:changed tells active members when a circle is created and renamed" do
    owner = create_user("+15550008005")
    owner_topic = user_topic(owner)

    join(owner)

    assert {:ok, circle} = Circles.create(owner, %{name: "First name"})

    assert_receive %Phoenix.Socket.Broadcast{
      topic: ^owner_topic,
      event: "circle:changed",
      payload: %{circleId: circle_id, change: "created"}
    }

    assert circle_id == circle.id

    assert {:ok, _} = Circles.update(owner, circle.id, %{"name" => "Second name"})

    assert_receive %Phoenix.Socket.Broadcast{
      topic: ^owner_topic,
      event: "circle:changed",
      payload: %{circleId: ^circle_id, change: "updated"}
    }
  end

  test "circle:changed member_removed also tells the user who was removed" do
    owner = create_user("+15550008006")
    member = create_user("+15550008007")

    join(owner)
    join(member)

    circle = circle_with(owner, member)
    circle_id = circle.id

    assert :ok = Circles.remove_member(owner, circle.id, member.id)

    # The removed user is no longer active but is told so their client can drop
    # the circle; the owner is still active and is told too.
    for topic <- [user_topic(owner), user_topic(member)] do
      assert_receive %Phoenix.Socket.Broadcast{
        topic: ^topic,
        event: "circle:changed",
        payload: %{circleId: ^circle_id, change: "member_removed"}
      }
    end
  end

  defp circle_with(owner, member) do
    {:ok, request} = Social.request_by_pin(owner, member.pin)
    {:ok, _} = Social.respond(member, request.id, :accept)

    {:ok, circle} = Circles.create(owner, %{name: "Broadcast events circle"})
    {:ok, _} = Circles.invite(owner, circle.id, [member.id])
    invitation = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: member.id)
    {:ok, _} = Circles.respond(member, invitation.id, :accept)
    circle
  end

  defp join(user) do
    {:ok, _reply, socket} =
      socket(AwsemChatWeb.UserSocket, user.id, %{user_id: user.id, token: user.token})
      |> subscribe_and_join(UserChannel, user_topic(user))

    socket
  end

  defp user_topic(user), do: "user:#{user.id}"

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end
end
