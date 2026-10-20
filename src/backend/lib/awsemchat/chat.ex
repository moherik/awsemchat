defmodule AwsemChat.Chat do
  @moduledoc """
  Chat core: conversations, messages, and the delivery bookkeeping a message
  creates.

  Two rules shape everything here.

  **Audience is captured at send time.** When a message is accepted the server
  computes the set of people who may see it and writes two things from that one
  computation: the `deliveries` rows and, when the message carries media, the
  `message_media` audience. Both are snapshots. Joining a circle later never
  widens access to what was already sent, and neither call ever sees a
  client-supplied id (`Media.record_message_reference/1` documents why).

  **History outlives the friendship.** Unfriend and block do not delete the
  private conversation or its messages. Reads keep working for the participant
  pair; only new sends are refused, with `:conversation_read_only` (unfriend)
  or `:blocked` (a block either way).
  """

  import Ecto.Query

  alias AwsemChat.Accounts.User

  alias AwsemChat.Chat.{
    Broadcast,
    CircleMembership,
    Conversation,
    Delivery,
    Envelope,
    Message,
    Position,
    Preferences
  }

  alias AwsemChat.Media
  alias AwsemChat.Media.Media, as: MediaRow
  alias AwsemChat.Media.Reference
  alias AwsemChat.Repo
  alias AwsemChat.Social

  @default_page 50
  @max_page 100
  @payload_cap 256 * 1024
  @kinds [:text, :media, :sticker, :moment_ref]

  @doc """
  Loads a conversation the user may see.

  Visible means a participant of a private conversation, or an active member of
  a circle. Returns `nil` when the conversation does not exist or is not theirs
  — callers turn that into `:not_found` or `:not_member` as the route demands.
  """
  def get_conversation(%User{} = user, conversation_id) do
    case fetch_conversation(conversation_id) do
      nil -> nil
      conversation -> if visible?(user, conversation), do: conversation, else: nil
    end
  end

  @doc """
  The conversation row for `conversation_id` regardless of visibility, or `nil`.

  Used by callers that must distinguish "does not exist" (`:not_found`) from
  "exists but is not yours" (`:not_member`) — see `classify_missing/1`.
  """
  def get_conversation_row(conversation_id), do: fetch_conversation(conversation_id)

  @doc "The other participant of a private conversation as seen by `viewer_id`."
  def peer_id(%Conversation{} = conversation, viewer_id) do
    case Conversation.participant_ids(conversation) do
      [a, b] when a == viewer_id -> b
      [a, b] when b == viewer_id -> a
      _ -> nil
    end
  end

  @doc """
  Sends `attrs` into `conversation_id` on behalf of `sender`.

  `attrs` is the wire map: `:clientOpId`, `:kind`, `:payload`, `:mediaIds`,
  `:replyTo`. The server stores the payload untouched and does not accept a
  recipient list — the audience is derived from the conversation.

  Idempotent: sending the same `clientOpId` twice returns the first message and
  writes nothing further, so a client retry after a timeout cannot duplicate a
  message or its deliveries.

  Errors: `:not_found`, `:not_member`, `:conversation_read_only`, `:blocked`,
  `:payload_too_large`, `:invalid_kind`, `:invalid_client_op_id`.
  """
  def send_message(%User{} = sender, conversation_id, attrs) when is_map(attrs) do
    with {:ok, conversation} <- fetch_visible_conversation(sender, conversation_id),
         {:ok, kind} <- normalize_kind(attrs),
         {:ok, payload} <- normalize_payload(attrs),
         {:ok, media_ids} <- normalize_media_ids(sender, attrs),
         :ok <- authorize_send(sender, conversation),
         {:ok, reply_to_message_id} <- resolve_reply(attrs, conversation),
         :ok <- check_payload_size(payload) do
      persist(sender, conversation, kind, payload, media_ids, attrs, reply_to_message_id)
    end
  end

  @doc """
  Lists messages in `conversation_id` for `user`, newest first.

  Keyset pagination on `(created_at, id)`: pass the previous page's
  `nextCursor` back as `:cursor` to walk backwards in time. The cursor names a
  fixed `(created_at, id)` position, so a message arriving between two page
  fetches never shifts the window.

  Options: `:limit` (default #{@default_page}), `:cursor`.

  Errors: `:not_found`, `:not_member`, `:invalid_cursor`.
  """
  def list_messages(%User{} = user, conversation_id, opts \\ %{}) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id),
         {:ok, query} <- cursor_query(conversation, user, opts) do
      limit = page_limit(opts)

      messages = Repo.all(from(m in query, limit: ^(limit + 1)))
      {page, rest} = Enum.split(messages, limit)

      {:ok,
       %{
         messages: page,
         nextCursor: next_cursor(page, rest)
       }}
    end
  end

  defp cursor_query(conversation, user, opts) do
    query =
      from(m in Message,
        where: m.conversation_id == ^conversation.id,
        order_by: [desc: m.created_at, desc: m.id]
      )

    query |> visible_since(conversation, user) |> apply_cursor(opts)
  end

  # The circle join boundary, applied to any query over messages in a
  # conversation: an active member only sees messages from their `joined_at`
  # onward; anyone else sees none. Private conversations have no boundary —
  # visibility is the participant pair, already enforced before we get here.
  #
  # `position` is the message source's binding index in `query` (0 for the
  # message list, 1 for the shared-media query, whose first binding is the
  # reference). Rebinding by position keeps the other sources intact.
  defp visible_since(query, conversation, user, position \\ 0)

  defp visible_since(query, %Conversation{type: :circle, id: circle_id}, user, position) do
    case get_active_membership(circle_id, user.id) do
      %CircleMembership{joined_at: joined_at} when not is_nil(joined_at) ->
        rebind_message(query, position, join_condition(position, joined_at))

      _ ->
        rebind_message(query, position, join_condition(position, :none))
    end
  end

  defp visible_since(query, _conversation, _user, _position), do: query

  # A dynamic whose binding list matches the query's positions, so the message
  # source is the one the condition names. `:none` hides everything.
  defp join_condition(0, :none), do: dynamic([m], false)
  defp join_condition(0, joined_at), do: dynamic([m], m.created_at >= ^joined_at)
  defp join_condition(1, :none), do: dynamic([_r, m], false)
  defp join_condition(1, joined_at), do: dynamic([_r, m], m.created_at >= ^joined_at)

  defp rebind_message(query, 0, condition), do: from([m] in query, where: ^condition)
  defp rebind_message(query, 1, condition), do: from([_r, m] in query, where: ^condition)

  @doc """
  Lists the media shared in `conversation_id` for `user`, newest first.

  The rows come from `message_media` joined to the messages that reference them,
  so the grid is exactly the media a message actually carries — never ids parsed
  out of an opaque payload. Sticker-kind messages are excluded (their media is a
  rendered sticker, not a shared photo) and so is `moment-ref`, which carries no
  pixels. Keyset pagination is the same `(created_at, id)` cursor as
  `list_messages/3`: pass the previous page's `nextCursor` back as `:cursor`.

  Membership is `list_messages/3`'s rule — a participant of a private
  conversation, or an active circle member — and a circle member is held to the
  join boundary, so media sent before they joined is not listed.

  Each item is `%{media_id, message_id, mime, width, height, created_at}` —
  `SharedMediaJSON` names those for the wire (camelCase), the same way
  `ConversationJSON` does for the conversation list. `width`/`height` are
  reported as stored: `media.width`/`height` are currently never populated, so
  they are `nil` rather than an invented size.

  Options: `:limit` (default #{@default_page}), `:cursor`.

  Errors: `:not_found`, `:not_member`, `:invalid_cursor`.
  """
  def list_shared_media(%User{} = user, conversation_id, opts \\ %{}) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id),
         {:ok, query} <- shared_media_query(conversation, user, opts) do
      limit = page_limit(opts)

      media = Repo.all(from(r in query, limit: ^(limit + 1)))
      {page, rest} = Enum.split(media, limit)

      {:ok,
       %{
         items: Enum.map(page, &shared_media_item/1),
         nextCursor: next_cursor(page, rest)
       }}
    end
  end

  # The media rows for messages the viewer may read: one row per `(message,
  # media)` pair, newest first, carrying the message's own `(created_at, id)` so
  # the cursor keyset matches the message list's. Sticker and moment-ref messages
  # are filtered out of the join — a sticker's media is artwork metadata and a
  # moment-ref has no attached pixels.
  defp shared_media_query(conversation, user, opts) do
    query =
      from(r in Reference,
        join: m in Message,
        on: m.id == r.message_id,
        join: md in MediaRow,
        on: md.id == r.media_id,
        where:
          r.conversation_id == ^conversation.id and
            m.kind not in [:sticker, :moment_ref] and
            m.conversation_id == ^conversation.id,
        order_by: [desc: m.created_at, desc: m.id],
        select: {r.media_id, r.message_id, m.created_at, m.id, md.mime, md.width, md.height}
      )

    query
    |> visible_since(conversation, user, 1)
    |> apply_cursor(opts, 1)
  end

  defp shared_media_item({media_id, message_id, created_at, _id, mime, width, height}) do
    %{
      media_id: media_id,
      message_id: message_id,
      mime: mime,
      width: width,
      height: height,
      created_at: DateTime.to_iso8601(created_at)
    }
  end

  @doc """
  The deliveries created for a message, one per intended recipient.
  """
  def list_deliveries(%Message{id: message_id}) do
    Repo.all(from(d in Delivery, where: d.message_id == ^message_id, order_by: [asc: d.user_id]))
  end

  @doc """
  Records device receipt of `message_id` by `user`.

  Flips that user's own pending delivery row to delivered and pushes
  `message:delivered` to the sender with the current counts. Always `:ok`:

  - a user with no row for this message — they were never an intended recipient
    — has nothing to flip and nothing is broadcast, so the call cannot be used
    to probe which messages exist;
  - a row that is already delivered is left alone and not re-broadcast, so a
    retried ack does not spam the sender.

  The lookup is keyed on `(message_id, user_id)`, so a user can only ever touch
  their own row; there is no code path that flips someone else's delivery.
  """
  def ack_delivered(%User{} = user, message_id) do
    case fetch_own_delivery(user, message_id) do
      nil ->
        :ok

      %Delivery{delivered_at: nil} = delivery ->
        mark_delivered(delivery)
        notify_sender(message_id)
        :ok

      %Delivery{} ->
        :ok
    end
  end

  @doc """
  A message's delivery counts: `delivered` (rows that have acked) and `total`
  (still-reachable intended recipients).

  `total` excludes recipients recorded unreachable, so completion is
  `delivered == total` and is never claimed because the outstanding recipients
  can no longer receive.
  """
  def delivery_counts(%Message{id: message_id}) do
    query = from(d in Delivery, where: d.message_id == ^message_id)

    %{
      delivered: Repo.aggregate(from(d in query, where: not is_nil(d.delivered_at)), :count),
      total: Repo.aggregate(from(d in query, where: d.reachable == true), :count)
    }
  end

  @doc """
  Marks `user_id`'s still-pending deliveries in `conversation_id` unreachable.

  A recipient who leaves or is removed from a circle can no longer ack, so
  leaving their rows pending would keep the message "sent but not delivered"
  forever. Recorded explicitly instead, exempting them from the completeness
  count. Returns the number of rows changed.

  Called by the circle-removal path (Task 6); today nothing invokes it because
  circle membership does not exist yet.
  """
  def mark_recipient_unreachable(user_id, conversation_id) do
    {count, _} =
      from(d in Delivery,
        join: m in Message,
        on: m.id == d.message_id,
        where:
          m.conversation_id == ^conversation_id and d.user_id == ^user_id and
            d.reachable == true and is_nil(d.delivered_at)
      )
      |> Repo.update_all(set: [reachable: false])

    count
  end

  @doc """
  The ids that may currently receive a message in `conversation_id`.

  Recomputed from the conversation, not from any stored snapshot, and it is
  exactly what `Chat.Broadcast.message_new/1` fans out to. A participant with a
  block in either direction is excluded; a private conversation's membership is
  the participant pair, and a circle's is its active members plus its creator
  (until Task 6 supplies the membership table).
  """
  def authorized_recipients(conversation_id) do
    case fetch_conversation(conversation_id) do
      nil -> []
      %Conversation{} = conversation -> visible_recipients(conversation)
    end
  end

  defp visible_recipients(%Conversation{} = conversation) do
    case Conversation.participant_ids(conversation) do
      nil ->
        Enum.uniq([conversation.created_by | circle_members(conversation.id)])
        |> Enum.reject(&is_nil/1)

      [a, b] ->
        if private_recipients_allowed?(a, b), do: [a, b], else: []
    end
  end

  defp private_recipients_allowed?(a, b) do
    peer_a = %User{id: a}
    peer_b = %User{id: b}

    Social.send_allowed?(peer_a, peer_b)
  end

  defp fetch_own_delivery(%User{id: user_id}, message_id) do
    case Ecto.UUID.cast(message_id) do
      {:ok, uuid} -> Repo.get_by(Delivery, message_id: uuid, user_id: user_id)
      :error -> nil
    end
  end

  defp mark_delivered(%Delivery{} = delivery) do
    delivery
    |> Ecto.Changeset.change(delivered_at: DateTime.truncate(DateTime.utc_now(), :second))
    |> Repo.update()
  end

  defp notify_sender(message_id) do
    case Repo.get(Message, message_id) do
      %Message{} = message -> Broadcast.delivered(message)
      nil -> :ok
    end
  end

  @doc """
  The media ids a message references, in the order they were sent.
  """
  def media_ids(%Message{id: message_id}), do: Media.media_ids_for_message(message_id)

  @doc """
  The audience for a message: the sender plus everyone who should receive it.

  Server-computed from the conversation, never from request input. Private
  conversations resolve to the participant pair; circles resolve to the members
  who could send or receive at this moment (Task 6 supplies memberships — today
  a circle with no membership rows yields just the sender).
  """
  def recipients(conversation, sender) do
    members =
      case Conversation.participant_ids(conversation) do
        nil -> circle_members(conversation.id)
        ids -> ids
      end

    Enum.uniq([sender.id | members])
  end

  # --- send internals -------------------------------------------------------

  defp persist(sender, conversation, kind, payload, media_ids, attrs, reply_to_message_id) do
    case normalize_client_op_id(attrs) do
      :invalid ->
        {:error, :invalid_client_op_id}

      client_op_id ->
        persist_message(
          sender,
          conversation,
          kind,
          payload,
          media_ids,
          client_op_id,
          reply_to_message_id
        )
    end
  end

  defp persist_message(
         sender,
         conversation,
         kind,
         payload,
         media_ids,
         client_op_id,
         reply_to_message_id
       ) do
    case existing_message(sender, client_op_id) do
      %Message{} = existing ->
        {:ok, existing}

      nil ->
        audience = recipients(conversation, sender)

        Repo.transaction(fn ->
          message =
            insert_message!(sender, conversation, %{
              client_op_id: client_op_id,
              kind: kind,
              payload: payload,
              reply_to_message_id: reply_to_message_id
            })

          insert_deliveries(message, audience)
          record_media(message, media_ids, audience)
          message
        end)
        |> resolve_commit(sender, client_op_id)
    end
  end

  # The transaction committed: this is a genuinely new message, so fan it out.
  # The broadcast happens here, after commit, never inside the transaction — a
  # client must not receive an event for a message that then rolls back.
  defp resolve_commit({:ok, %Message{} = message}, _sender, _client_op_id) do
    Broadcast.message_new(message)
    {:ok, message}
  end

  # The only rollback this path can produce is the unique index on
  # `(sender_id, client_op_id)`: a concurrent retry of the same `clientOpId`
  # committed first. Under READ COMMITTED the losing INSERT blocks until the
  # winner commits and only then reports the violation, so the winner's row is
  # already visible and is the answer for every caller. There is no separate
  # "conflict" outcome to report — the loser is simply handed the winner.
  defp resolve_commit({:error, :race}, sender, client_op_id) do
    case existing_message(sender, client_op_id) do
      %Message{} = existing -> {:ok, existing}
      # Unreachable for the race above; a message insert that failed for any
      # other reason is an internal fault, not a client conflict.
      nil -> {:error, :send_failed}
    end
  end

  # Writing the delivery rows failed, so the transaction rolled the message
  # back: nothing partial commits. This is a server-side fault, reported as
  # such rather than as a retryable conflict.
  defp resolve_commit({:error, :send_failed}, _sender, _client_op_id) do
    {:error, :send_failed}
  end

  defp insert_message!(sender, conversation, attrs) do
    case %Message{}
         |> Message.changeset(
           Map.merge(attrs, %{conversation_id: conversation.id, sender_id: sender.id})
         )
         |> Repo.insert() do
      {:ok, message} -> message
      {:error, changeset} -> Repo.rollback(message_rollback_reason(changeset))
    end
  end

  # The idempotency unique index is reported against `:sender_id` (Ecto names a
  # composite constraint after its first column) — that specific constraint is
  # the race. Anything else is an internal fault.
  defp message_rollback_reason(%{errors: errors}) do
    if Enum.any?(errors, &unique_sender_op_id?/1), do: :race, else: :send_failed
  end

  defp unique_sender_op_id?({_field, {_message, opts}}) do
    opts[:constraint_name] == "messages_sender_id_client_op_id_index"
  end

  # One pending delivery per intended recipient. A failure rolls the whole send
  # back rather than committing a partial recipient set.
  defp insert_deliveries(message, audience) do
    Enum.each(audience, fn user_id ->
      case %Delivery{} |> Delivery.changeset(message.id, user_id) |> Repo.insert() do
        {:ok, _delivery} -> :ok
        {:error, _changeset} -> Repo.rollback(:send_failed)
      end
    end)
  end

  defp record_media(_message, [], _audience), do: :ok

  defp record_media(message, media_ids, audience) do
    Enum.each(media_ids, fn media_id ->
      Media.record_message_reference(%{
        media_id: media_id,
        message_id: message.id,
        conversation_id: message.conversation_id,
        user_ids: audience
      })
    end)
  end

  defp existing_message(sender, client_op_id) do
    Repo.get_by(Message, sender_id: sender.id, client_op_id: client_op_id)
  end

  defp authorize_send(sender, conversation) do
    case Conversation.participant_ids(conversation) do
      [a, b] -> private_send_authorization(sender, a, b)
      nil -> circle_send_authorization(sender, conversation)
    end
  end

  # Private sends need an active friendship both ways and no block either way.
  # The conversation row outliving the friendship is the point: a participant
  # who is no longer cleared to send gets read-only, which keeps history
  # readable without letting the pair keep talking.
  defp private_send_authorization(sender, a, b) do
    with {:ok, peer_id} <- peer_id(sender, a, b),
         peer = %User{id: peer_id},
         false <- Social.blocked_either?(sender, peer) do
      if Social.are_friends?(sender, peer) do
        :ok
      else
        {:error, :conversation_read_only}
      end
    else
      true -> {:error, :blocked}
      :error -> {:error, :not_member}
    end
  end

  defp circle_send_authorization(sender, conversation) do
    case get_active_membership(conversation.id, sender.id) do
      %CircleMembership{} -> :ok
      nil -> {:error, :not_member}
    end
  end

  defp peer_id(%User{id: sender_id}, a, b) do
    case sender_id do
      ^a -> {:ok, b}
      ^b -> {:ok, a}
      _ -> :error
    end
  end

  defp resolve_reply(attrs, conversation) do
    case reply_reference(attrs) do
      nil ->
        {:ok, nil}

      %{kind: :message, id: message_id} ->
        # A quote must come from this conversation: quoting across audiences
        # would leak the existence of a message the sender cannot be shown.
        case parse_message_id(message_id) do
          {:ok, uuid} ->
            case Repo.get(Message, uuid) do
              %Message{conversation_id: conversation_id}
              when conversation_id == conversation.id ->
                {:ok, uuid}

              _ ->
                {:error, :not_found}
            end

          :error ->
            {:error, :not_found}
        end

      %{kind: :moment, id: _moment_id} ->
        {:error, :not_found}

      # A malformed or unknown-kind reply is treated the same as an
      # unreachable target: the send is refused rather than raising.
      _other ->
        {:error, :not_found}
    end
  end

  # The id column is `:binary_id`; an unparseable value must be refused rather
  # than handed to `Repo.get/2`, which would raise `Ecto.Query.CastError`.
  defp parse_message_id(message_id) do
    case Ecto.UUID.cast(message_id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> :error
    end
  end

  defp reply_reference(attrs) do
    case fetch_attr(attrs, :replyTo) || fetch_attr(attrs, :reply_to) do
      nil -> nil
      %{kind: kind, id: id} -> %{kind: normalize_reply_kind(kind), id: id}
      %{"kind" => kind, "id" => id} -> %{kind: normalize_reply_kind(kind), id: id}
      _ -> :invalid
    end
  end

  defp normalize_reply_kind(kind) when kind in [:message, "message"], do: :message
  defp normalize_reply_kind(kind) when kind in [:moment, "moment"], do: :moment
  defp normalize_reply_kind(_kind), do: :unknown

  defp check_payload_size(payload) do
    if byte_size(Jason.encode!(payload)) > @payload_cap do
      {:error, :payload_too_large}
    else
      :ok
    end
  end

  defp normalize_kind(attrs) do
    case fetch_attr(attrs, :kind) do
      nil -> {:error, :invalid_kind}
      kind -> normalize_kind_value(kind)
    end
  end

  defp normalize_kind_value(kind) when is_atom(kind) do
    kind |> Atom.to_string() |> normalize_kind_string()
  end

  defp normalize_kind_value(kind) when is_binary(kind), do: normalize_kind_string(kind)

  defp normalize_kind_value(_kind), do: {:error, :invalid_kind}

  defp normalize_kind_string(kind) do
    kind
    |> String.replace("-", "_")
    |> String.to_existing_atom()
    |> case do
      atom when atom in @kinds -> {:ok, atom}
      _ -> {:error, :invalid_kind}
    end
  rescue
    ArgumentError -> {:error, :invalid_kind}
  end

  defp normalize_payload(attrs) do
    case fetch_attr(attrs, :payload) do
      nil -> {:ok, %{}}
      payload when is_map(payload) -> {:ok, payload}
      _other -> {:error, :invalid_payload}
    end
  end

  defp normalize_client_op_id(attrs) do
    case fetch_attr(attrs, :clientOpId) || fetch_attr(attrs, :client_op_id) do
      nil ->
        Ecto.UUID.generate()

      value ->
        # The column is `:binary_id`, so an unparseable id must be refused here.
        # Passing it into `existing_message/2` would raise `Ecto.Query.CastError`
        # and surface as a 500 with the wrong envelope instead of a clean 422.
        case Ecto.UUID.cast(value) do
          {:ok, uuid} -> uuid
          :error -> :invalid
        end
    end
  end

  defp normalize_media_ids(sender, attrs) do
    ids =
      case fetch_attr(attrs, :mediaIds) || fetch_attr(attrs, :media_ids) do
        nil -> []
        ids when is_list(ids) -> Enum.uniq(ids)
        _other -> []
      end

    # You may only attach media you uploaded. Otherwise a client could name a
    # stranger's media id and, by having it referenced, add itself and its
    # recipients to that media's read audience.
    if Media.owns_all?(sender, ids) do
      {:ok, ids}
    else
      {:error, :not_found}
    end
  end

  # --- read internals -------------------------------------------------------

  defp fetch_conversation(conversation_id) do
    case Ecto.UUID.cast(conversation_id) do
      {:ok, uuid} -> Repo.get(Conversation, uuid)
      :error -> nil
    end
  end

  defp fetch_visible_conversation(user, conversation_id) do
    case get_conversation(user, conversation_id) do
      %Conversation{} = conversation -> {:ok, conversation}
      nil -> classify_missing(conversation_id)
    end
  end

  # A row that exists but is not the caller's is `:not_member`; a row that does
  # not exist (or is unparseable) is `:not_found`. The route layer picks the
  # code, this pick is the one both the context and its callers agree on.
  defp classify_missing(conversation_id) do
    case fetch_conversation(conversation_id) do
      nil -> {:error, :not_found}
      %Conversation{} -> {:error, :not_member}
    end
  end

  defp visible?(user, conversation) do
    case Conversation.participant_ids(conversation) do
      nil ->
        case get_active_membership(conversation.id, user.id) do
          %CircleMembership{} -> true
          nil -> false
        end

      [a, b] ->
        user.id in [a, b]
    end
  end

  defp page_limit(opts) do
    opts
    |> fetch_attr(:limit)
    |> normalize_limit()
  end

  defp normalize_limit(nil), do: @default_page
  defp normalize_limit(limit) when is_integer(limit) and limit > 0, do: min(limit, @max_page)

  defp normalize_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {parsed, ""} -> normalize_limit(parsed)
      _ -> @default_page
    end
  end

  defp normalize_limit(_limit), do: @default_page

  defp apply_cursor(query, opts, position \\ 0) do
    case fetch_attr(opts, :cursor) do
      nil -> {:ok, query}
      cursor -> where_before(query, cursor, position)
    end
  end

  defp where_before(query, cursor, position) do
    case decode_cursor(cursor) do
      {:ok, %{created_at: created_at, id: id}} ->
        {:ok, rebind_message(query, position, before_condition(position, created_at, id))}

      # A cursor we did not mint is a client error, not a request for page one.
      # Silently returning the newest page would re-serve messages the caller
      # already has, so refuse it instead.
      :error ->
        {:error, :invalid_cursor}
    end
  end

  defp before_condition(0, created_at, id) do
    dynamic(
      [m],
      m.created_at < ^created_at or (m.created_at == ^created_at and m.id < ^id)
    )
  end

  defp before_condition(1, created_at, id) do
    dynamic(
      [_r, m],
      m.created_at < ^created_at or (m.created_at == ^created_at and m.id < ^id)
    )
  end

  # The cursor carries the last visible row's identity, not an offset, so the
  # window is stable under concurrent inserts.
  defp next_cursor(_page, []), do: nil

  defp next_cursor([], _rest), do: nil

  defp next_cursor(page, _rest) do
    {created_at, id} = cursor_position(List.last(page))
    encode_cursor(created_at, id)
  end

  # The two list queries return different shapes — the message list a schema, the
  # shared-media grid a tuple — but both end in the message's `(created_at, id)`.
  defp cursor_position({_media_id, _message_id, created_at, id, _mime, _width, _height}),
    do: {created_at, id}

  defp cursor_position(last), do: {last.created_at, last.id}

  defp encode_cursor(created_at, id) do
    Base.url_encode64("#{DateTime.to_iso8601(created_at)}|#{id}", padding: false)
  end

  defp decode_cursor(cursor) do
    with {:ok, decoded} <- Base.url_decode64(cursor, padding: false),
         [iso8601, id] <- String.split(decoded, "|", parts: 2),
         {:ok, created_at, _offset} <- DateTime.from_iso8601(iso8601),
         {:ok, uuid} <- Ecto.UUID.cast(id) do
      {:ok, %{created_at: created_at, id: uuid}}
    else
      _ -> :error
    end
  end

  defp circle_members(circle_id) do
    Repo.all(
      from(m in CircleMembership,
        where: m.circle_id == ^circle_id and m.state == :active,
        select: m.user_id
      )
    )
  end

  defp get_active_membership(circle_id, user_id) do
    Repo.get_by(CircleMembership, circle_id: circle_id, user_id: user_id, state: :active)
  end

  def put_preferences(%User{} = user, conversation_id, attrs) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id) do
      params =
        attrs
        |> normalize_pref_attrs()
        |> Map.put(:conversation_id, conversation.id)
        |> Map.put(:user_id, user.id)

      result =
        %Preferences{}
        |> Preferences.changeset(params)
        |> Repo.insert(
          on_conflict:
            {:replace,
             [
               :pinned,
               :pin_order,
               :muted,
               :archived
             ]},
          conflict_target: [:conversation_id, :user_id],
          returning: true
        )

      case result do
        {:ok, pref} -> {:ok, pref}
        {:error, _} = err -> err
      end
    end
  end

  @doc """
  Records where `user` has read up to in `conversation_id`.

  The id must name a message **in that conversation**. A position may only move
  a viewer's own read mark inside the conversation they are reading, so a
  message from another conversation — readable or not — is refused with
  `:not_found`. Without this check a client could point at a message in a
  different conversation and silently zero (or worse, latch) the conversation's
  unread count, because the count resolves the id to a timestamp.

  `nil` clears the position (unread again from the top of the window).
  """
  def put_position(%User{} = user, conversation_id, message_id) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id),
         {:ok, last_seen_message_id} <- resolve_position(conversation, message_id) do
      params = %{
        conversation_id: conversation.id,
        user_id: user.id,
        last_seen_message_id: last_seen_message_id
      }

      result =
        %Position{}
        |> Position.changeset(params)
        |> Repo.insert(
          on_conflict: {:replace, [:last_seen_message_id]},
          conflict_target: [:conversation_id, :user_id],
          returning: true
        )

      case result do
        {:ok, pos} -> {:ok, pos}
        {:error, _} = err -> err
      end
    end
  end

  # `nil` is a legitimate "no position". Anything else must be a message in this
  # conversation: same id space, same audience. A non-UUID or a UUID that names
  # nothing here is `:not_found`, which the route layer maps to 404.
  defp resolve_position(_conversation, nil), do: {:ok, nil}

  defp resolve_position(conversation, message_id) do
    case message_in_conversation(conversation.id, message_id) do
      %Message{id: id} -> {:ok, id}
      nil -> {:error, :not_found}
    end
  end

  defp message_in_conversation(conversation_id, message_id) do
    case Ecto.UUID.cast(message_id) do
      {:ok, uuid} ->
        Repo.one(
          from(m in Message,
            where: m.id == ^uuid and m.conversation_id == ^conversation_id
          )
        )

      :error ->
        nil
    end
  end

  @doc """
  Lists the conversations `user` may see, pinned first, newest activity last.

  Options:

  - `:filter` — `:all | :private | :circles` (default `:all`)
  - `:includeArchived` — archived rows are hidden unless truthy (default off)
  - `:cursor` — an opaque cursor from a previous page (see below)
  - `:limit` — page size (default #{@default_page}, capped at #{@max_page})

  Ordering is deterministic: pinned first, then `pinOrder` ascending, then the
  most recent message time descending, then `id` ascending as a final stable
  tiebreak. Without that final key two rows with the same `pinOrder` (or no
  messages at all) could come back in either order, so paging would be unstable.

  The cursor is opaque and names the last row's `(sort_key, id)`; pass it back as
  `:cursor` to fetch the next page. A cursor this server did not mint is
  `:invalid_cursor`.

  Errors: none for an empty list; `:invalid_cursor` for a bad cursor.
  """
  def list_conversations(%User{} = user, opts \\ %{}) do
    filter = fetch_attr(opts, :filter) || :all
    include_archived? = truthy?(fetch_attr(opts, :includeArchived))
    limit = page_limit(opts)

    conversations = all_visible_conversations(user)

    state = load_viewer_state(user, conversations)

    conversations =
      conversations
      |> filter_by_type(filter)
      |> exclude_archived(state, include_archived?)
      |> Enum.map(&build_conversation_row(user, &1, state))
      |> Enum.sort_by(&sort_key/1)

    with {:ok, page, rest} <- paginate(conversations, limit, fetch_attr(opts, :cursor)) do
      {:ok, %{conversations: page, nextCursor: list_next_cursor(page, rest)}}
    end
  end

  # The viewer's preferences and positions for every listed conversation, in two
  # queries instead of one pair per row.
  defp load_viewer_state(%User{} = user, conversations) do
    ids = Enum.map(conversations, & &1.id)

    prefs =
      Repo.all(from(p in Preferences, where: p.user_id == ^user.id and p.conversation_id in ^ids))
      |> Map.new(&{&1.conversation_id, &1})

    positions =
      Repo.all(from(p in Position, where: p.user_id == ^user.id and p.conversation_id in ^ids))
      |> Map.new(&{&1.conversation_id, &1})

    %{prefs: prefs, positions: positions}
  end

  # A row's position in the list: pinned (0) before unpinned (1), then the
  # explicit `pinOrder`, then recency, then the id as a stable final tiebreak.
  defp sort_key(row) do
    pinned = row.preferences.pinned
    pin_order = row.preferences.pin_order
    {if(pinned, do: 0, else: 1), pin_order, message_sort_time(row), row.id}
  end

  # `last_message` is an `Envelope.render/1` map (atom keys). `DateTime` sorts
  # naturally; a conversation with no messages sorts oldest.
  defp message_sort_time(%{last_message: %{createdAt: iso}}) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} -> dt
      _ -> ~U[1970-01-01 00:00:00Z]
    end
  end

  defp message_sort_time(_row), do: ~U[1970-01-01 00:00:00Z]

  # Archive filtering happens once, against the viewer's own loaded preferences
  # (not the peer's), using the prefetched map.
  defp exclude_archived(conversations, _state, true), do: conversations

  defp exclude_archived(conversations, state, false) do
    Enum.reject(conversations, fn conversation ->
      case state.prefs[conversation.id] do
        %Preferences{archived: true} -> true
        _ -> false
      end
    end)
  end

  # Keyset pagination. The cursor carries the sort position of the last row of
  # the previous page, so a conversation inserted between two page fetches never
  # shifts the window.
  defp paginate(rows, limit, nil), do: {:ok, Enum.take(rows, limit), drop(rows, limit)}

  defp paginate(rows, limit, cursor) do
    case decode_list_cursor(cursor) do
      {:ok, key} ->
        rest = Enum.drop_while(rows, &(sort_key(&1) <= key))
        {:ok, Enum.take(rest, limit), drop(rest, limit)}

      :error ->
        {:error, :invalid_cursor}
    end
  end

  defp drop(rows, limit), do: Enum.drop(rows, limit)

  defp list_next_cursor(_page, []), do: nil

  defp list_next_cursor([], _rest), do: nil

  defp list_next_cursor(page, _rest) do
    last = List.last(page)
    {tier, pin_order, time, id} = sort_key(last)
    encode_list_cursor({tier, pin_order, DateTime.to_unix(time, :microsecond), id})
  end

  defp encode_list_cursor({tier, pin_order, micros, id}) do
    Base.url_encode64("#{tier}|#{pin_order}|#{micros}|#{id}", padding: false)
  end

  defp decode_list_cursor(cursor) do
    with {:ok, decoded} <- Base.url_decode64(cursor, padding: false),
         [tier, pin_order, micros, id] <- String.split(decoded, "|", parts: 4),
         {tier, ""} <- Integer.parse(tier),
         {pin_order, ""} <- Integer.parse(pin_order),
         {micros, ""} <- Integer.parse(micros),
         {:ok, uuid} <- Ecto.UUID.cast(id) do
      {:ok, {tier, pin_order, DateTime.from_unix!(micros, :microsecond), uuid}}
    else
      _ -> :error
    end
  end

  defp all_visible_conversations(%User{} = user) do
    # `private_key` is the two participant ids sorted and joined; the viewer is
    # either the first or the second half. Filtering on that prefix/suffix keeps
    # the scan to the viewer's own pairs instead of every private row on the
    # server — the old version loaded all private conversations and filtered in
    # Elixir.
    prefix = user.id <> ":%"
    suffix = "%:" <> user.id

    private_convos =
      from(c in Conversation,
        where:
          c.type == :private and
            (like(c.private_key, ^prefix) or like(c.private_key, ^suffix)),
        select: c
      )
      |> Repo.all()

    circle_convos =
      from(c in Conversation,
        join: m in CircleMembership,
        on: m.circle_id == c.id,
        where: c.type == :circle and m.user_id == ^user.id and m.state == :active,
        select: c,
        distinct: true
      )
      |> Repo.all()

    (private_convos ++ circle_convos)
    |> Enum.uniq_by(& &1.id)
  end

  defp filter_by_type(conversations, :all), do: conversations

  defp filter_by_type(conversations, :private),
    do: Enum.filter(conversations, &(&1.type == :private))

  defp filter_by_type(conversations, :circles),
    do: Enum.filter(conversations, &(&1.type == :circle))

  defp filter_by_type(conversations, "all"), do: conversations

  defp filter_by_type(conversations, "private"),
    do: Enum.filter(conversations, &(&1.type == :private))

  defp filter_by_type(conversations, "circles"),
    do: Enum.filter(conversations, &(&1.type == :circle))

  defp filter_by_type(conversations, _), do: conversations

  # Returns the context's own row shape (snake_case atoms); `ConversationJSON`
  # is the one place that names these for the wire, so the REST shape is defined
  # once and cannot drift from the channel envelope's camelCase convention.
  defp build_conversation_row(%User{} = user, %Conversation{} = conversation, state) do
    pref = state.prefs[conversation.id]
    position = state.positions[conversation.id]

    last_message = get_last_message(conversation.id)

    unread_count = count_unread(user, conversation, position, last_message)

    row = %{
      id: conversation.id,
      type: conversation.type,
      last_message: last_message && Envelope.render(last_message),
      unread_count: unread_count,
      preferences: normalize_preferences(pref)
    }

    case conversation.type do
      :private ->
        peer_id = get_peer_id(user, conversation)
        peer_profile = if peer_id, do: get_user_profile(peer_id), else: nil
        Map.put(row, :peer_profile, peer_profile)

      :circle ->
        Map.put(row, :circle_meta, %{
          id: conversation.id,
          name: conversation.name,
          description: conversation.description,
          avatar_media_id: conversation.avatar_media_id
        })

      _ ->
        row
    end
  end

  defp get_peer_id(%User{id: user_id}, %Conversation{} = conversation) do
    peer_id(conversation, user_id)
  end

  defp get_user_profile(user_id) do
    case Repo.get(User, user_id) do
      %User{} = u ->
        %{
          id: u.id,
          displayName: u.display_name,
          avatarMediaId: u.avatar_media_id,
          statusText: u.status_text
        }

      nil ->
        nil
    end
  end

  defp normalize_preferences(nil) do
    %{pinned: false, pin_order: 0, muted: false, archived: false}
  end

  defp normalize_preferences(%Preferences{} = pref) do
    %{
      pinned: pref.pinned || false,
      pin_order: pref.pin_order || 0,
      muted: pref.muted || false,
      archived: pref.archived || false
    }
  end

  defp get_last_message(conversation_id) do
    from(m in Message,
      where: m.conversation_id == ^conversation_id,
      order_by: [desc: m.created_at, desc: m.id],
      limit: 1
    )
    |> Repo.one()
  end

  defp count_unread(%User{} = user, %Conversation{} = conversation, position, _last_message) do
    last_seen_id =
      case position do
        %Position{last_seen_message_id: nil} -> nil
        %Position{last_seen_message_id: id} -> id
        _ -> nil
      end

    query =
      from(m in Message,
        where: m.conversation_id == ^conversation.id
      )

    query =
      case conversation.type do
        :circle ->
          case get_active_membership(conversation.id, user.id) do
            %CircleMembership{joined_at: joined_at} when not is_nil(joined_at) ->
              from(m in query, where: m.created_at >= ^joined_at)

            _ ->
              from(m in query, where: false)
          end

        _ ->
          query
      end

    query = from(m in query, where: m.sender_id != ^user.id)

    # The position's id is resolved against **this** conversation, never with an
    # unscoped `Repo.get/2`. A position from another conversation can no longer
    # leak a timestamp into this count.
    #
    # `conversation_positions.last_seen_message_id` has no FK, so a dangling id
    # is representable (an old row, a hand-edited value). `put_position/3`
    # refuses to introduce one, but a value already stored must not be trusted:
    # an unresolvable id counts from the top of the viewer's visibility window —
    # the conservative "everything is unread" reading — rather than counting
    # everything *and* never latching, or silently showing zero.
    query =
      case last_seen_id do
        nil ->
          query

        id ->
          case message_in_conversation(conversation.id, id) do
            %Message{created_at: created_at} ->
              from(m in query,
                where: m.created_at > ^created_at or (m.created_at == ^created_at and m.id > ^id)
              )

            nil ->
              query
          end
      end

    Repo.aggregate(query, :count)
  end

  defp normalize_pref_attrs(attrs) do
    attrs = atomize_keys(attrs)

    %{}
    |> maybe_put_pref(:pinned, attrs[:pinned] || attrs[:pinned?])
    |> maybe_put_pref(:pin_order, attrs[:pinOrder] || attrs[:pin_order])
    |> maybe_put_pref(:muted, attrs[:muted] || attrs[:muted?])
    |> maybe_put_pref(:archived, attrs[:archived] || attrs[:archived?])
  end

  defp maybe_put_pref(map, _key, nil), do: map
  defp maybe_put_pref(map, key, value), do: Map.put(map, key, value)

  defp atomize_keys(map) when is_map(map) do
    Map.new(map, fn
      {k, v} when is_binary(k) -> {String.to_atom(k), v}
      {k, v} -> {k, v}
    end)
  rescue
    _ -> map
  end

  defp truthy?(nil), do: false
  defp truthy?(false), do: false
  defp truthy?(0), do: false
  defp truthy?("false"), do: false
  defp truthy?("0"), do: false
  defp truthy?(_), do: true

  defp fetch_attr(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))
end
