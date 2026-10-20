defmodule AwsemChatWeb.CircleJSON do
  @moduledoc """
  Wire shape for a circle.

  A circle is stored as a `conversations` row of type `:circle`, so the fields
  here are that row's circle half: identity, name, description, avatar. The
  private-conversation bookkeeping (`private_key`) and the creator's raw id are
  not part of what the client renders, and `Envelope`-style camelCase keeps one
  casing across the API.
  """

  alias AwsemChat.Chat.Conversation

  @doc "Serializes a circle conversation for the client."
  def data(%Conversation{type: :circle} = circle) do
    %{
      id: circle.id,
      type: "circle",
      name: circle.name,
      description: circle.description,
      avatarMediaId: circle.avatar_media_id,
      createdBy: circle.created_by,
      createdAt: maybe_iso8601(circle.inserted_at)
    }
  end

  defp maybe_iso8601(nil), do: nil
  defp maybe_iso8601(timestamp), do: DateTime.to_iso8601(timestamp)
end
