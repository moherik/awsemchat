defmodule AwsemChat.Moments do
  @moduledoc """
  Moments in conversations with audience boundaries.

  Audience rule: membership with `joined_at <= created_at` - a member who joined
  after a moment was created cannot see it. For private conversations, visibility
  follows the same party-membership logic as messages.
  """

  import Ecto.Query

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.{CircleMembership, Conversation, Message}
  alias AwsemChat.Moments.Moment
  alias AwsemChat.Repo

  @default_page 50
  @max_page 100
  @kinds [:text, :media, :sticker]

  def create(%User{} = user, conversation_id, attrs) when is_map(attrs) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id),
         {:ok, kind} <- normalize_kind(attrs),
         {:ok, payload} <- normalize_payload(attrs),
         {:ok, source_message_id} <- resolve_source_message(attrs, user, conversation) do
      persist_moment(user, conversation, kind, payload, source_message_id, attrs)
    end
  end

  def list(%User{} = user, conversation_id, opts \\ %{}) do
    with {:ok, conversation} <- fetch_visible_conversation(user, conversation_id) do
      query =
        from(m in Moment,
          where: m.conversation_id == ^conversation.id and is_nil(m.deleted_at),
          order_by: [desc: m.created_at, desc: m.id]
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

      limit = page_limit(opts)

      moments = Repo.all(from(m in query, limit: ^(limit + 1)))
      {page, rest} = Enum.split(moments, limit)

      {:ok,
       %{
         moments: page,
         nextCursor: next_cursor(page, rest)
       }}
    end
  end

  def delete(%User{} = author, moment_id) do
    case fetch_moment(moment_id) do
      nil ->
        {:error, :not_found}

      %Moment{author_id: author_id} = moment ->
        if author_id == author.id do
          moment
          |> Ecto.Changeset.change(deleted_at: DateTime.truncate(DateTime.utc_now(), :second))
          |> Repo.update()

          AwsemChat.Chat.Broadcast.moment_changed(%{
            conversation_id: moment.conversation_id,
            moment_id: moment.id,
            change: "deleted"
          })

          :ok
        else
          {:error, :forbidden}
        end
    end
  end

  defp persist_moment(user, conversation, kind, payload, source_message_id, attrs) do
    case normalize_client_op_id(attrs) do
      :invalid ->
        {:error, :invalid_client_op_id}

      _client_op_id ->
        moment =
          %Moment{}
          |> Moment.changeset(%{
            conversation_id: conversation.id,
            author_id: user.id,
            kind: kind,
            payload: payload,
            source_message_id: source_message_id
          })
          |> Repo.insert!()

        AwsemChat.Chat.Broadcast.moment_changed(%{
          conversation_id: conversation.id,
          moment_id: moment.id,
          change: "created"
        })

        {:ok, moment}
    end
  end

  defp resolve_source_message(attrs, user, conversation) do
    case fetch_attr(attrs, :sourceMessageId) || fetch_attr(attrs, :source_message_id) do
      nil ->
        {:ok, nil}

      id ->
        case parse_uuid(id) do
          {:ok, uuid} ->
            case Repo.get(Message, uuid) do
              %Message{conversation_id: conv_id, sender_id: sender_id}
              when conv_id == conversation.id and sender_id == user.id ->
                {:ok, uuid}

              _ ->
                {:error, :forbidden}
            end

          :error ->
            {:error, :forbidden}
        end
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
      nil -> Ecto.UUID.generate()
      value -> parse_uuid_or_invalid(value)
    end
  end

  defp parse_uuid_or_invalid(value) do
    case parse_uuid(value) do
      {:ok, uuid} -> uuid
      :error -> :invalid
    end
  end

  defp parse_uuid(value) do
    Ecto.UUID.cast(value)
  end

  defp fetch_visible_conversation(user, conversation_id) do
    case get_conversation(user, conversation_id) do
      %Conversation{} = conversation -> {:ok, conversation}
      nil -> classify_missing(conversation_id)
    end
  end

  defp get_conversation(%User{} = user, conversation_id) do
    case fetch_conversation(conversation_id) do
      nil -> nil
      conversation -> if visible?(user, conversation), do: conversation, else: nil
    end
  end

  defp fetch_conversation(conversation_id) do
    case Ecto.UUID.cast(conversation_id) do
      {:ok, uuid} -> Repo.get(Conversation, uuid)
      :error -> nil
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

  defp classify_missing(conversation_id) do
    case fetch_conversation(conversation_id) do
      nil -> {:error, :not_found}
      %Conversation{} -> {:error, :not_member}
    end
  end

  defp get_active_membership(circle_id, user_id) do
    Repo.get_by(CircleMembership, circle_id: circle_id, user_id: user_id, state: :active)
  end

  defp fetch_moment(moment_id) do
    case Ecto.UUID.cast(moment_id) do
      {:ok, uuid} -> Repo.get(Moment, uuid)
      :error -> nil
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

  defp next_cursor(_page, []), do: nil
  defp next_cursor([], _rest), do: nil

  defp next_cursor(page, _rest) do
    last = List.last(page)
    encode_cursor(last.created_at, last.id)
  end

  defp encode_cursor(created_at, id) do
    Base.url_encode64("#{DateTime.to_iso8601(created_at)}|#{id}", padding: false)
  end

  defp fetch_attr(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))
end
