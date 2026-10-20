defmodule AwsemChatWeb.ReactionJSON do
  @moduledoc """
  Wire shape for reaction aggregates.

  `Reactions.list_for/3` returns `%{target_id => [%{emoji, userId}]}`; this is
  the one place that names it for the wire. The map is keyed by the target id
  and each entry carries the emoji and who set it — the client groups by emoji
  itself, so the server does not pre-count.
  """

  @doc "Serializes the aggregate map for one target type."
  def aggregates(%{} = by_target) do
    %{
      reactions:
        Map.new(by_target, fn {target_id, rows} ->
          {to_string(target_id),
           Enum.map(rows, fn row -> %{emoji: row.emoji, userId: row.userId} end)}
        end)
    }
  end

  @doc "Serializes a single reaction the caller just set or cleared."
  def data(nil), do: nil

  def data(%{emoji: emoji, target_type: target_type, target_id: target_id, user_id: user_id}) do
    %{
      targetType: to_string(target_type),
      targetId: target_id,
      emoji: emoji,
      userId: user_id
    }
  end
end
