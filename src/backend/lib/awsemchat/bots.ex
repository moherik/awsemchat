defmodule AwsemChat.Bots do
  @moduledoc """
  The auto-reply responder: seeded bot accounts answer a human who messages them
  privately, through the ordinary send path.

  ## Why it listens on the user topics

  A bot is an ordinary user with no socket. To hear what a bot's clients would
  hear, the responder subscribes to the bot's own `"user:<id>"` topic and treats
  the `message:new` events there as its inbox. Nothing else observes the bot;
  every event it reacts to is one `Chat.Broadcast.message_new/1` would fan out
  to a real device, and everything it says goes back out through
  `Chat.send_message/3` and that same broadcast — there is no bot-only write
  path, so a reply is indistinguishable from a person typing.

  ## What it will not do

  - **No circles.** A bot answers only a private conversation in which it is a
    participant. A group message is left alone (recorded design decision: circles
    stay honest, and the owner exercises them with a second account).
  - **No bot-to-bot chatter.** A message whose sender is itself a bot is ignored,
    so two seeds talking can never set off an endless echo.
  - **No double answers.** A message id is remembered once it is handled, so a
    re-broadcast of the same event does not produce a second reply.

  Both friends are needed to send at all, so a delivered `message:new` already
  means the pair is authorized. Any friend request still pending between them is
  accepted on the way through — a dangling row from an answered request is
  cleared rather than left to decay.

  ## Roster and timing

  The roster is passed in (`:bots`) or loaded from `config :awsemchat, :bots,
  phones: [...]` at boot, so the supervised instance starts with the seeded
  accounts and a test starts its own with fixtures. `:reply_delay_ms` is either a
  fixed delay, a `{min, max}` range, or a zero-arity function; tests inject `0`
  so nothing waits on a wall clock.
  """

  use GenServer

  require Logger

  alias AwsemChat.Accounts
  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat
  alias AwsemChat.Chat.Conversation
  alias AwsemChat.Repo
  alias AwsemChat.Social

  @default_delay {800, 2000}

  # The ids of the last few handled messages. Bounded because the responder runs
  # for the life of the node: an unbounded set would leak one entry per message
  # forever. A re-broadcast of an event older than this window could produce a
  # second reply, but a re-broadcast of a message that old does not happen in
  # practice, and the cost of that miss is one duplicate line.
  @seen_window 1_000

  @canned_lines [
    "Hey! Good to hear from you.",
    "Got it — tell me more.",
    "Nice. What else is new?",
    "Ha, fair enough.",
    "Sounds good to me.",
    "I'm around if you need anything.",
    "That's a good one.",
    "Let's catch up properly soon."
  ]

  # --- public API -----------------------------------------------------------

  @doc "Starts the responder. See the moduledoc for `:bots`, `:reply_delay_ms` and `:name`."
  def start_link(opts \\ []) do
    {name, opts} = Keyword.pop(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc "The canned lines a bot may answer with, in a stable order."
  def canned_lines, do: @canned_lines

  @doc """
  The reply text for an incoming message: a scripted line, or the echo fallback.

  Deterministic given the bot id and the incoming message id, so a redelivered
  event would word the same answer the same way.
  """
  def reply_text(%User{id: bot_id}, message_id, text) do
    if is_binary(text) and String.trim(text) != "" do
      case canned_line(bot_id, message_id) do
        nil -> "You said: " <> text
        line -> line
      end
    else
      "You said: "
    end
  end

  # A scripted line ~2 times in 3, the echo fallback otherwise. The choice is a
  # hash of the message, not a random draw, so it is reproducible.
  defp canned_line(bot_id, message_id) do
    <<seed::unsigned-integer-size(8), _::binary>> =
      :crypto.hash(:sha256, "#{bot_id}:#{message_id}")

    if rem(seed, 3) == 0 do
      nil
    else
      Enum.at(@canned_lines, rem(seed, length(@canned_lines)))
    end
  end

  # --- GenServer ------------------------------------------------------------

  @impl true
  def init(opts) do
    bots = Keyword.get(opts, :bots) || load_configured_bots()
    reply_delay_ms = Keyword.get(opts, :reply_delay_ms, configured_delay())

    Enum.each(bots, &subscribe/1)

    {:ok,
     %{
       bots: Map.new(bots, &{&1.id, &1}),
       reply_delay_ms: reply_delay_ms,
       seen: []
     }}
  end

  # The event a bot's own device would receive. The topic names the bot, the
  # payload names the message; anything else on the topic is not an inbox item.
  @impl true
  def handle_info(
        %Phoenix.Socket.Broadcast{
          topic: "user:" <> bot_id,
          event: "message:new",
          payload: payload
        },
        state
      ) do
    {:noreply, handle_message(bot_id, payload, state)}
  end

  def handle_info({:reply, bot_id, conversation_id, sender_id, message_id, text}, state) do
    state
    |> bot(bot_id)
    |> send_reply(conversation_id, sender_id, message_id, text)

    {:noreply, state}
  end

  def handle_info(_message, state), do: {:noreply, state}

  # --- message handling -----------------------------------------------------

  defp handle_message(bot_id, payload, state) do
    with %User{} = bot <- bot(state, bot_id),
         %{id: message_id, senderId: sender_id, conversationId: conversation_id} = envelope <-
           message_event(payload),
         false <- message_id in state.seen,
         false <- bot?(state, sender_id),
         %Conversation{type: :private} = conversation <- private_with(bot, conversation_id),
         %User{} = sender <- Accounts.get_by_id(sender_id) do
      accept_pending(sender, bot)
      :ok = Chat.ack_delivered(bot, message_id)

      Process.send_after(
        self(),
        {:reply, bot.id, conversation.id, sender.id, message_id, incoming_text(envelope)},
        delay(state)
      )

      remember(state, message_id)
    else
      _ -> state
    end
  end

  defp send_reply(%User{} = bot, conversation_id, sender_id, message_id, text) do
    if Accounts.get_by_id(sender_id) do
      reply =
        Chat.send_message(bot, conversation_id, %{
          clientOpId: Ecto.UUID.generate(),
          kind: :text,
          payload: %{"v" => 1, "text" => reply_text(bot, message_id, text)}
        })

      case reply do
        {:ok, _message} ->
          :ok

        {:error, reason} ->
          # The human may have unfriended or blocked the bot in the gap; the
          # reply is simply dropped rather than forced through.
          Logger.debug("bot #{bot.id} could not reply: #{inspect(reason)}")
      end
    end

    :ok
  end

  # The line the echo fallback repeats, read from the delivered envelope. The
  # payload is opaque to the server everywhere else; this is the one reader, and
  # it only ever looks for the `text` a client encoded.
  defp incoming_text(%{payload: %{"text" => text}}) when is_binary(text), do: text
  defp incoming_text(_payload), do: ""

  defp accept_pending(%User{} = human, %User{} = bot) do
    request = pending_request(human, bot) || pending_request(bot, human)

    case request do
      nil ->
        :ok

      %{id: id} ->
        case Social.respond(bot, id, :accept) do
          {:ok, _} -> :ok
          # A block in either direction refuses the accept; the message already
          # arrived, so there is nothing to repair and nothing to report.
          {:error, _reason} -> :ok
        end
    end
  end

  defp pending_request(%User{id: sender_id}, %User{id: recipient_id}) do
    Repo.get_by(Social.FriendRequest,
      sender_id: sender_id,
      recipient_id: recipient_id,
      state: :pending
    )
  end

  # --- helpers --------------------------------------------------------------

  defp bot(state, bot_id), do: Map.get(state.bots, bot_id)

  defp bot?(state, user_id), do: Map.has_key?(state.bots, user_id)

  # The chat payload is the plan's wrapper, `%{"message" => envelope}` (atom keys
  # in-process, strings once JSON-encoded). The envelope is what carries
  # `id`/`senderId`/`conversationId`; a payload without that wrapper, or one
  # whose envelope lacks those fields, is not an inbox item.
  defp message_event(%{message: envelope}), do: message_event(envelope)
  defp message_event(%{"message" => envelope}), do: message_event(envelope)

  defp message_event(%{id: id, senderId: sender, conversationId: conversation} = payload)
       when is_binary(id) and is_binary(sender) and is_binary(conversation),
       do: payload

  defp message_event(_payload), do: nil

  defp private_with(%User{id: bot_id}, conversation_id) do
    case Chat.get_conversation_row(conversation_id) do
      %Conversation{type: :private} = conversation ->
        if bot_id in Conversation.participant_ids(conversation), do: conversation, else: nil

      _ ->
        nil
    end
  end

  defp remember(state, message_id) do
    %{state | seen: Enum.take([message_id | state.seen], @seen_window)}
  end

  defp delay(%{reply_delay_ms: delay}) when is_integer(delay), do: max(delay, 0)

  defp delay(%{reply_delay_ms: {min, max}}), do: Enum.random(min..max)

  defp delay(%{reply_delay_ms: fun}) when is_function(fun, 0), do: fun.()

  defp delay(_state), do: delay(%{reply_delay_ms: @default_delay})

  defp subscribe(%User{} = bot) do
    # The Endpoint is the configured PubSub server `Chat.Broadcast` publishes
    # through, so the subscription and the broadcast meet on the same topic.
    AwsemChatWeb.Endpoint.subscribe("user:" <> bot.id)
  end

  defp configured_delay do
    Application.get_env(:awsemchat, :bots, []) |> Keyword.get(:reply_delay_ms, @default_delay)
  end

  defp load_configured_bots do
    Application.get_env(:awsemchat, :bots, [])
    |> Keyword.get(:phones, [])
    |> Enum.map(&Accounts.get_by_phone/1)
    |> Enum.reject(&is_nil/1)
  end
end
