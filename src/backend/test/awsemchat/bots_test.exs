defmodule AwsemChat.BotsTest do
  @moduledoc """
  The auto-reply responder at its boundaries: it answers a human it is already
  talking to privately, stands down where answering would be wrong (a circle, or
  another bot), and leaves the accepted request and the delivery receipt behind.

  The responder is started per test with an explicit roster and a zero reply
  delay, so nothing here depends on the seeded dev accounts or on wall-clock
  waits. The delay is an injected value, not a sleep.
  """

  use AwsemChatWeb.ChannelCase, async: true

  import Ecto.Query

  alias AwsemChat.{Accounts, Bots, Chat, Circles, Social}
  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.{CircleInvitation, Message}
  alias AwsemChat.Repo
  alias AwsemChat.Social.FriendRequest

  setup do
    bot = create_user("+15550009001")
    human = create_user("+15550009002")

    # The human's device, standing in for the emulator: subscribed to its own
    # topic so the bot's reply arrives here exactly as a client would see it.
    :ok = AwsemChatWeb.Endpoint.subscribe("user:" <> human.id)

    %{bot: bot, human: human}
  end

  test "test_bot_autoaccepts_request", %{bot: bot, human: human} do
    conversation = friends_with(human, bot)

    # A pending request can coexist with an existing friendship — a re-request
    # written after unfriend, a hand-repaired row. The responder sees the
    # message from the human and clears the dangling request before answering.
    assert {:ok, _pending} =
             %FriendRequest{}
             |> FriendRequest.create_changeset(human, bot)
             |> Repo.insert()

    start_bots([bot])

    assert {:ok, _message} = Chat.send_message(human, conversation.id, message_attrs())

    # The bot's reply is the proof the handler ran; the accept happens before it.
    assert_bot_reply(bot)

    refute Repo.exists?(
             from r in FriendRequest,
               where:
                 r.sender_id == ^human.id and r.recipient_id == ^bot.id and
                   r.state == :pending
           )

    assert Social.are_friends?(human, bot)
  end

  test "test_bot_replies_to_private_message", %{bot: bot, human: human} do
    conversation = friends_with(human, bot)

    start_bots([bot])

    assert {:ok, message} = Chat.send_message(human, conversation.id, message_attrs())

    # The reply reaches the human on the same topic a real client would use.
    reply_text = assert_bot_reply(bot)
    assert is_binary(reply_text) and reply_text != ""

    # It is stored like any other message, through the one send path, with a
    # server-minted clientOpId.
    reply = Repo.get_by!(Message, sender_id: bot.id, conversation_id: conversation.id)
    assert reply.client_op_id
    assert reply.kind == :text

    # The bot acked the human's message on receipt, so the sender's receipt
    # bookkeeping shows a delivery.
    bot_delivery = Enum.find(Chat.list_deliveries(message), &(&1.user_id == bot.id))
    assert bot_delivery.delivered_at
  end

  test "test_bot_reply_text_is_scripted_or_echo", %{bot: bot} do
    # The reply is deterministic given the bot and the incoming message, so the
    # two shapes can be pinned without racing a schedule: a scripted line, or
    # the echo fallback when no line applies.
    scripted_id = find_message_id(scripted?(bot))
    echo_id = find_message_id(echo?(bot))

    assert Bots.reply_text(bot, scripted_id, "anything") in Bots.canned_lines()
    assert Bots.reply_text(bot, echo_id, "from the beach") == "You said: from the beach"
  end

  test "test_bot_echo_fallback_when_no_scripted_line_matches", %{bot: bot, human: human} do
    conversation = friends_with(human, bot)
    start_bots([bot])

    text = "totally unscripted #{System.unique_integer([:positive])}"

    assert {:ok, _message} =
             Chat.send_message(
               human,
               conversation.id,
               message_attrs(%{payload: %{"v" => 1, "text" => text}})
             )

    reply = assert_bot_reply(bot)
    assert reply in Bots.canned_lines() or reply == "You said: " <> text
  end

  test "test_bots_do_not_reply_in_circles", %{bot: bot, human: human} do
    other_bot = create_user("+15550009003")
    start_bots([bot, other_bot])

    # 1. A circle message is not auto-replied: circles stay honest, and a bot
    #    answering into a group is not a private conversation with it. The
    #    human's own message does reach their topic; the bot's must not follow.
    circle = circle_with(human, bot)
    human_id = human.id
    bot_id = bot.id

    assert {:ok, _message} = Chat.send_message(human, circle.id, message_attrs())

    assert_receive %Phoenix.Socket.Broadcast{
                     event: "message:new",
                     payload: %{message: %{senderId: ^human_id}}
                   },
                   1_000

    refute_receive %Phoenix.Socket.Broadcast{
                     event: "message:new",
                     payload: %{message: %{senderId: ^bot_id}}
                   },
                   300

    refute Repo.exists?(from m in Message, where: m.sender_id == ^bot.id)

    # 2. Two bots do not answer each other: the responder ignores a message
    #    whose sender is itself a bot, so there is no echo loop. Listening on
    #    the other bot's topic would be where its reply landed — the bot's own
    #    outbound event also lands there, so the refutation names the replier.
    :ok = AwsemChatWeb.Endpoint.subscribe("user:" <> other_bot.id)
    other_bot_id = other_bot.id
    bot_conversation = friends_with(bot, other_bot)

    assert {:ok, _message} = Chat.send_message(bot, bot_conversation.id, message_attrs())

    refute_receive %Phoenix.Socket.Broadcast{
                     event: "message:new",
                     payload: %{message: %{senderId: ^other_bot_id}}
                   },
                   300

    # Only the one message the bot itself sent; nobody replied.
    count =
      Repo.aggregate(from(m in Message, where: m.conversation_id == ^bot_conversation.id), :count)

    assert count == 1
  end

  defp start_bots(bots) do
    pid = start_supervised!({Bots, bots: bots, reply_delay_ms: 0, name: nil})
    Ecto.Adapters.SQL.Sandbox.allow(Repo, self(), pid)
    pid
  end

  # A message id that makes `Bots.reply_text/3` take the wanted branch, found by
  # probing the documented output rather than re-implementing its hash.
  defp find_message_id(wanted?) do
    Stream.repeatedly(&Ecto.UUID.generate/0)
    |> Enum.find(fn id -> wanted?.(id) end)
  end

  defp scripted?(bot) do
    fn id -> Bots.reply_text(bot, id, "x") in Bots.canned_lines() end
  end

  defp echo?(bot) do
    fn id -> Bots.reply_text(bot, id, "x") == "You said: x" end
  end

  # Waits for a reply authored by `bot` on the human's topic and returns its
  # text. The human's own outbound event shares the topic and shape, so the
  # match is pinned to the bot's sender id rather than just "a message arrived".
  defp assert_bot_reply(%User{id: bot_id}) do
    assert_receive %Phoenix.Socket.Broadcast{
                     topic: "user:" <> _,
                     event: "message:new",
                     payload: %{message: %{senderId: ^bot_id, payload: %{"text" => text}}}
                   },
                   1_000

    text
  end

  defp friends_with(alice, bob) do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)
    conversation
  end

  defp circle_with(owner, member) do
    # Only friends may be invited, so the pair is friends first — the same
    # footing the seeded bots need to be addable as friends.
    _conversation = friends_with(owner, member)
    {:ok, circle} = Circles.create(owner, %{name: "Bots test circle"})
    {:ok, _results} = Circles.invite(owner, circle.id, [member.id])
    invitation = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: member.id)
    {:ok, _membership} = Circles.respond(member, invitation.id, :accept)
    circle
  end

  defp message_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "hello there"}
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
