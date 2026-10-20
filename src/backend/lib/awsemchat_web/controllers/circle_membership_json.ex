defmodule AwsemChatWeb.CircleMembershipJSON do
  @moduledoc """
  Wire shape for a circle member row.

  `GET /circles/:id/members` lists the circle's active memberships, and the
  client renders each one as a person: a name, an avatar, a role badge ("Admin"
  or "Member"), and when they joined. So a row is the member's identity
  (`user.id`), the two profile fields the roster draws (`displayName`,
  `avatarMediaId`), and the membership's own `state` and `role`, plus `joinedAt`.

  Only what the roster renders travels. This is deliberately *not*
  `UserJSON.data/1`: that view carries the user's `pin`, and a circle roster
  hands one member every other member's row, so echoing a search handle to the
  whole circle is more than the roster needs. `phone` and the PIN are left out
  for the same reason `statusText` is: the roster does not draw them. No
  `left_at` (the list is active members only) and no internal circle id (the
  whole response is that circle's members).
  """

  alias AwsemChat.Chat.CircleMembership

  @doc "Serializes a circle membership for the roster."
  def data(%CircleMembership{} = membership) do
    %{
      userId: membership.user_id,
      displayName: display_name(membership.user),
      avatarMediaId: avatar_media_id(membership.user),
      role: to_string(membership.role),
      state: to_string(membership.state),
      joinedAt: maybe_iso8601(membership.joined_at)
    }
  end

  # The roster is still meaningful with the name missing; a member whose user row
  # did not load (or was not preloaded) keeps its `userId` and renders as a blank
  # row rather than crashing the whole list on one bad preload.
  defp display_name(%{display_name: name}), do: name
  defp display_name(_), do: nil

  defp avatar_media_id(%{avatar_media_id: id}), do: id
  defp avatar_media_id(_), do: nil

  defp maybe_iso8601(nil), do: nil
  defp maybe_iso8601(timestamp), do: DateTime.to_iso8601(timestamp)
end
