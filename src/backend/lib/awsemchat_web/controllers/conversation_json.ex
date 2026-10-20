defmodule AwsemChatWeb.ConversationJSON do
  @moduledoc """
  Wire shape for a conversation.

  `privateKey` never travels: it is the pair's internal identity, not something
  the client needs. A private conversation is described by its `peer` profile;
  circle metadata (name, description, avatar) is Task 6's and is omitted until
  then.

  The list rows rendered by `row/1` follow the same convention as the rest of
  the API — camelCase keys, `Envelope.render/1` being the reference — so a
  client parses one casing everywhere: `unreadCount`, `lastMessage`,
  `peerProfile`, `circleMeta`, `nextCursor`. `type` is the string form of the
  conversation kind (`"private"`, `"circle"`), never an atom. No position/read
  state of any viewer is exposed here.
  """

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation

  @doc "Serializes a conversation, optionally naming the other participant."
  def data(%Conversation{} = conversation, opts \\ []) do
    base = %{
      id: conversation.id,
      type: to_string(conversation.type),
      createdAt: maybe_iso8601(conversation.inserted_at)
    }

    case Keyword.get(opts, :peer) do
      %User{} = peer -> Map.put(base, :peer, peer_data(peer))
      _ -> base
    end
  end

  @doc """
  Serializes one conversation-list row.

  The row arrives in the context's own shape (see `Chat.list_conversations/2`)
  and leaves here in the wire shape. `lastMessage` is a full envelope
  (`Envelope.render/1`) or `null`; `preferences` is always present with the
  viewer's own pinned/muted/archived state. No `position` field is ever emitted.
  """
  def row(%{} = row) do
    %{
      id: row.id,
      type: to_string(row.type),
      lastMessage: row.last_message,
      unreadCount: row.unread_count,
      preferences: %{
        pinned: row.preferences.pinned,
        pinOrder: row.preferences.pin_order,
        muted: row.preferences.muted,
        archived: row.preferences.archived
      }
    }
    |> put_peer(row)
    |> put_circle(row)
  end

  @doc "Serializes a page of rows plus its cursor."
  def page(%{conversations: rows, nextCursor: cursor}) do
    %{conversations: Enum.map(rows, &row/1), nextCursor: cursor}
  end

  defp put_peer(data, %{type: :private} = row), do: Map.put(data, :peerProfile, row.peer_profile)

  defp put_peer(data, _row), do: data

  defp put_circle(data, %{type: :circle} = row) do
    Map.put(data, :circleMeta, %{
      id: row.circle_meta.id,
      name: row.circle_meta.name,
      description: row.circle_meta.description,
      avatarMediaId: row.circle_meta.avatar_media_id
    })
  end

  defp put_circle(data, _row), do: data

  defp peer_data(%User{} = user) do
    %{
      id: user.id,
      displayName: user.display_name,
      pin: user.pin,
      statusText: user.status_text,
      avatarMediaId: user.avatar_media_id
    }
  end

  defp maybe_iso8601(nil), do: nil
  defp maybe_iso8601(timestamp), do: DateTime.to_iso8601(timestamp)
end
