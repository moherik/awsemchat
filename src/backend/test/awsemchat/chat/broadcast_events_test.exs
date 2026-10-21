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

  test "circle:changed invitation reaches each invitee" do
    owner = create_user("+15550008008")
    invitee = create_user("+15550008009")
    invitee_topic = user_topic(invitee)

    join(owner)
    join(invitee)

    {:ok, request} = Social.request_by_pin(owner, invitee.pin)
    {:ok, _} = Social.respond(invitee, request.id, :accept)

    {:ok, circle} = Circles.create(owner, %{name: "Invitation circle"})
    # Drain the `created` event the owner receives so the invitation event is
    # unambiguous.
    assert_receive %Phoenix.Socket.Broadcast{
      event: "circle:changed",
      payload: %{change: "created"}
    }

    invitee_id = invitee.id
    assert {:ok, %{^invitee_id => :ok}} = Circles.invite(owner, circle.id, [invitee.id])

    assert_receive %Phoenix.Socket.Broadcast{
      topic: ^invitee_topic,
      event: "circle:changed",
      payload: %{circleId: circle_id, change: "invitation"}
    }

    assert circle_id == circle.id
  end

  test "circle:changed member_added reaches the members after an invite is accepted" do
    owner = create_user("+15550008010")
    member = create_user("+15550008011")

    join(owner)
    join(member)

    owner_topic = user_topic(owner)
    member_topic = user_topic(member)

    {:ok, request} = Social.request_by_pin(owner, member.pin)
    {:ok, _} = Social.respond(member, request.id, :accept)

    {:ok, circle} = Circles.create(owner, %{name: "Member added circle"})
    circle_id = circle.id
    assert_receive %Phoenix.Socket.Broadcast{topic: ^owner_topic, event: "circle:changed"}

    member_id = member.id
    assert {:ok, %{^member_id => :ok}} = Circles.invite(owner, circle.id, [member.id])
    # The invitee's own `invitation` event; the `member_added` event follows the
    # accept below.
    assert_receive %Phoenix.Socket.Broadcast{
      topic: ^member_topic,
      event: "circle:changed",
      payload: %{change: "invitation"}
    }

    invitation = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: member.id)
    assert {:ok, _} = Circles.respond(member, invitation.id, :accept)

    # Accepting adds the invitee as an active member, so both current members —
    # owner and the newly added user — must be told.
    for topic <- [owner_topic, member_topic] do
      assert_receive %Phoenix.Socket.Broadcast{
        topic: ^topic,
        event: "circle:changed",
        payload: %{circleId: ^circle_id, change: "member_added"}
      }
    end
  end

  test "circle:changed left also tells the user who left" do
    owner = create_user("+15550008012")
    member = create_user("+15550008013")

    join(owner)
    join(member)

    circle = circle_with(owner, member)
    circle_id = circle.id

    assert :ok = Circles.leave(member, circle.id)

    # The leaver has already committed `state: :left`, so they are no longer an
    # active member and are absent from the computed recipient set; they are
    # named explicitly so their other devices drop the circle. The owner is
    # still active and is told too.
    for topic <- [user_topic(owner), user_topic(member)] do
      assert_receive %Phoenix.Socket.Broadcast{
        topic: ^topic,
        event: "circle:changed",
        payload: %{circleId: ^circle_id, change: "left"}
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
