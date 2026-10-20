defmodule AwsemChatWeb.ConversationJSON do
  @moduledoc """
  Wire shape for a conversation.

  `privateKey` never travels: it is the pair's internal identity, not something
  the client needs. A private conversation is described by its `peer` profile;
  circle metadata (name, description, avatar) is Task 6's and is omitted until
  then.
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
