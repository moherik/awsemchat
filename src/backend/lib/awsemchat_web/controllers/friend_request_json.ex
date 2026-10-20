defmodule AwsemChatWeb.FriendRequestJSON do
  @moduledoc "Wire shape for a friend request, with both profiles inlined."

  alias AwsemChat.Social.FriendRequest
  alias AwsemChatWeb.UserJSON

  @doc "Serializes a friend request for the client."
  def data(%FriendRequest{} = request) do
    %{
      id: request.id,
      state: to_string(request.state),
      sender: profile(request.sender),
      recipient: profile(request.recipient),
      createdAt: maybe_iso8601(request.inserted_at)
    }
  end

  defp profile(%{id: _} = user), do: UserJSON.data(user)
  defp profile(nil), do: nil

  defp maybe_iso8601(nil), do: nil
  defp maybe_iso8601(timestamp), do: DateTime.to_iso8601(timestamp)
end
