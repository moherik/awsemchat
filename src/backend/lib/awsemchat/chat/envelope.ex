defmodule AwsemChat.Chat.Envelope do
  @moduledoc """
  The single place that shapes a message for the client.

  Controllers, the channel fan-out (Task 5), and later the conversation list
  all render through here, so the wire shape is defined once:

      {"id":"uuid","conversationId":"uuid","senderId":"uuid","clientOpId":"uuid",
       "kind":"text|media|sticker|moment-ref","payload":{},
       "replyTo":{"kind":"message","id":"uuid"}|null,
       "mediaIds":["uuid"],"createdAt":"ISO-8601"}

  `payload` passes through exactly as stored — the server never interprets it.
  `mediaIds` is the `message_media` reference list, not something parsed out of
  the payload, which is what keeps the opacity rule intact while still letting
  the shared-media grid work.

  `state` is deliberately absent: `sending|sent|delivered` is client-derived
  (accepted is at least `sent`; `delivered` follows from `message:delivered`).
  Nothing per-viewer appears here — no read state, no other user's position.
  """

  alias AwsemChat.Chat

  @doc "Renders a message (or an already-loaded wire map) to its wire shape."
  def render(%{__struct__: _} = message) do
    %{
      id: message.id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      clientOpId: message.client_op_id,
      kind: kind_to_string(message.kind),
      payload: message.payload || %{},
      replyTo: reply_to(message),
      mediaIds: Chat.media_ids(message),
      createdAt: DateTime.to_iso8601(message.created_at)
    }
  end

  def render(%{} = rendered), do: rendered

  defp reply_to(%{reply_to_message_id: nil, reply_to_moment_id: nil}), do: nil

  defp reply_to(%{reply_to_message_id: message_id}) when is_binary(message_id) do
    %{kind: "message", id: message_id}
  end

  defp reply_to(%{reply_to_moment_id: moment_id}) when is_binary(moment_id) do
    %{kind: "moment", id: moment_id}
  end

  # The DB stores `moment_ref` (snake_case); the wire contract spells it
  # `moment-ref`.
  defp kind_to_string(kind) when is_atom(kind),
    do: kind |> Atom.to_string() |> String.replace("_", "-")

  defp kind_to_string(kind) when is_binary(kind), do: kind
end
