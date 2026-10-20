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
  alias AwsemChat.Chat.{Conversation, Delivery, Message}
  alias AwsemChat.Media
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
         {:ok, query} <- cursor_query(conversation, opts) do
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

  defp cursor_query(conversation, opts) do
    from(m in Message,
      where: m.conversation_id == ^conversation.id,
      order_by: [desc: m.created_at, desc: m.id]
    )
    |> apply_cursor(opts)
  end

  @doc """
  The deliveries created for a message, one per intended recipient.
  """
  def list_deliveries(%Message{id: message_id}) do
    Repo.all(from(d in Delivery, where: d.message_id == ^message_id, order_by: [asc: d.user_id]))
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
        |> case do
          {:ok, %Message{} = message} ->
            {:ok, message}

          # A concurrent retry of the same clientOpId won the insert race; the
          # winner's row is the answer either way.
          {:error, _reason} ->
            case existing_message(sender, client_op_id) do
              %Message{} = existing -> {:ok, existing}
              nil -> {:error, :conflict}
            end
        end
    end
  end

  defp insert_message!(sender, conversation, attrs) do
    case %Message{}
         |> Message.changeset(
           Map.merge(attrs, %{conversation_id: conversation.id, sender_id: sender.id})
         )
         |> Repo.insert() do
      {:ok, message} -> message
      {:error, changeset} -> Repo.rollback(changeset)
    end
  end

  # One pending delivery per intended recipient. A failure rolls the whole send
  # back rather than committing a partial recipient set.
  defp insert_deliveries(message, audience) do
    Enum.each(audience, fn user_id ->
      case %Delivery{} |> Delivery.changeset(message.id, user_id) |> Repo.insert() do
        {:ok, _delivery} -> :ok
        {:error, changeset} -> Repo.rollback(changeset)
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

  # TODO(Task 6): require an active circle membership once circle_memberships
  # exists; until then a circle has no members beyond its sender.
  defp circle_send_authorization(sender, conversation) do
    if sender.id in circle_members(conversation.id) do
      :ok
    else
      {:error, :not_member}
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
      nil -> user.id in circle_members(conversation.id)
      [a, b] -> user.id in [a, b]
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

  defp apply_cursor(query, opts) do
    case fetch_attr(opts, :cursor) do
      nil -> {:ok, query}
      cursor -> where_before(query, cursor)
    end
  end

  defp where_before(query, cursor) do
    case decode_cursor(cursor) do
      {:ok, %{created_at: created_at, id: id}} ->
        {:ok,
         where(
           query,
           [m],
           m.created_at < ^created_at or (m.created_at == ^created_at and m.id < ^id)
         )}

      # A cursor we did not mint is a client error, not a request for page one.
      # Silently returning the newest page would re-serve messages the caller
      # already has, so refuse it instead.
      :error ->
        {:error, :invalid_cursor}
    end
  end

  # The cursor carries the last visible row's identity, not an offset, so the
  # window is stable under concurrent inserts.
  defp next_cursor(_page, []), do: nil

  defp next_cursor([], _rest), do: nil

  defp next_cursor(page, _rest) do
    last = List.last(page)
    encode_cursor(last.created_at, last.id)
  end

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

  # Circle membership is Task 6's table; until it exists this is empty, which
  # makes a circle visible only to its creator.
  defp circle_members(_circle_id), do: []

  defp fetch_attr(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))
end
