defmodule AwsemChatWeb.MomentJSON do
  @moduledoc """
  Wire shape for a moment.

  Follows the rest of the API: camelCase keys, the `Envelope.render/1` reference
  for casing. `payload` passes through exactly as stored — the server never
  interprets it — and `kind` is the string form of the stored atom. `sourceMessageId`
  is present only when the moment was promoted from a message.
  """

  alias AwsemChat.Moments.Moment

  @doc "Serializes a moment for the client."
  def data(%Moment{} = moment) do
    %{
      id: moment.id,
      conversationId: moment.conversation_id,
      authorId: moment.author_id,
      kind: to_string(moment.kind),
      payload: moment.payload || %{},
      sourceMessageId: moment.source_message_id,
      createdAt: maybe_iso8601(moment.created_at)
    }
  end

  @doc "Serializes a page of moments plus its cursor."
  def page(%{moments: moments, nextCursor: cursor}) do
    %{moments: Enum.map(moments, &data/1), nextCursor: cursor}
  end

  defp maybe_iso8601(nil), do: nil
  defp maybe_iso8601(timestamp), do: DateTime.to_iso8601(timestamp)
end
