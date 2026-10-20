defmodule AwsemChat.Circles do
  @moduledoc """
  Circles: creation, invitations, membership, capacity, join boundaries.
  """
  import Ecto.Query

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.{Broadcast, CircleInvitation, CircleMembership, Conversation}
  alias AwsemChat.Repo
  alias AwsemChat.Social

  @max_members 20

  def create(%User{} = creator, attrs) when is_map(attrs) do
    name = attrs[:name] || attrs["name"] || "Circle"
    description = attrs[:description] || attrs["description"]
    avatar_media_id = attrs[:avatarMediaId] || attrs["avatarMediaId"] || attrs[:avatar_media_id]

    Repo.transaction(fn ->
      conversation =
        %Conversation{}
        |> Conversation.changeset(%{
          type: :circle,
          name: name,
          description: description,
          avatar_media_id: avatar_media_id,
          created_by: creator.id
        })
        |> Repo.insert!()

      now = DateTime.utc_now()

      %CircleMembership{}
      |> CircleMembership.create_changeset(%{
        circle_id: conversation.id,
        user_id: creator.id,
        role: :owner,
        state: :active,
        joined_at: now
      })
      |> Repo.insert!()

      conversation
    end)
    |> case do
      {:ok, conversation} ->
        Broadcast.circle_changed(conversation.id, :created, [creator.id])
        {:ok, conversation}

      other ->
        other
    end
  end

  def invite(actor, circle_id, user_ids) when is_list(user_ids) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      conversation ->
        case do_invite(actor, conversation, user_ids) do
          {:ok, results} ->
            invited = for {invitee_id, :ok} <- results, do: invitee_id
            Broadcast.circle_changed(conversation.id, :invitation, invited)
            {:ok, results}

          other ->
            other
        end
    end
  end

  def respond(user, invitation_id, action) when action in [:accept, :decline] do
    case Repo.get(CircleInvitation, invitation_id) do
      nil ->
        {:error, :not_found}

      invitation ->
        case do_respond(user, invitation, action) do
          {:ok, _} = ok ->
            if action == :accept,
              do: broadcast_circle_change(invitation.circle_id, :member_added)

            ok

          other ->
            other
        end
    end
  end

  def leave(%User{} = user, circle_id) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      conversation ->
        case do_leave(user, conversation) do
          :ok ->
            broadcast_circle_change(conversation.id, :left)
            :ok

          other ->
            other
        end
    end
  end

  def remove_member(%User{} = actor, circle_id, user_id) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      conversation ->
        case do_remove_member(actor, conversation, user_id) do
          :ok ->
            broadcast_circle_change(conversation.id, :member_removed, [cast_id(user_id)])
            :ok

          other ->
            other
        end
    end
  end

  @doc """
  Updates a circle's profile on behalf of `actor`.

  Only an active owner or admin may edit the profile — the same rule
  `remove_member/3` applies to destructive membership changes. A non-member is
  `:not_member`, a member below owner/admin is `:forbidden`, and an unknown
  circle is `:not_found`.

  Only the profile fields are read from `attrs`: the circle's identity, type and
  creator are not client-writable, and a stray `"id"` (the route's own param,
  which the controller forwards) must never reach the changeset.
  """
  def update(%User{} = actor, circle_id, attrs) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      conversation ->
        case get_membership(conversation.id, actor.id) do
          %CircleMembership{role: role} when role in [:owner, :admin] ->
            case conversation
                 |> Conversation.changeset(circle_profile_attrs(attrs))
                 |> Repo.update() do
              {:ok, updated} ->
                broadcast_circle_change(conversation.id, :updated)
                {:ok, updated}

              other ->
                other
            end

          %CircleMembership{} ->
            {:error, :forbidden}

          nil ->
            {:error, :not_member}
        end
    end
  end

  @doc """
  The circle's own profile as `actor` may see it.

  Only an active member may read a circle's profile — the same rule every other
  circle read applies, so a stranger cannot discover a circle's name,
  description or avatar by id. An unknown circle is `:not_found`; a circle the
  caller is not in is `:not_member`.
  """
  def get(%User{} = actor, circle_id) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      %Conversation{} = conversation ->
        case get_membership(conversation.id, actor.id) do
          %CircleMembership{} -> {:ok, conversation}
          nil -> {:error, :not_member}
        end
    end
  end

  def list_members(%User{} = actor, circle_id) do
    case get_circle_conversation(circle_id) do
      nil ->
        {:error, :not_found}

      %Conversation{} = conversation ->
        case get_membership(conversation.id, actor.id) do
          %CircleMembership{} -> {:ok, do_list_members(conversation.id)}
          nil -> {:error, :not_member}
        end
    end
  end

  # The roster itself. Private: `list_members/2` is the only caller, so the
  # authorization above cannot be bypassed by reaching for the query directly.
  defp do_list_members(circle_id) do
    Repo.all(
      from(m in CircleMembership,
        where: m.circle_id == ^circle_id and m.state == :active,
        order_by: [asc: m.joined_at, asc: m.id],
        preload: [:user]
      )
    )
  end

  def get_membership(circle_id, user_id) do
    Repo.get_by(CircleMembership, circle_id: circle_id, user_id: user_id, state: :active)
  end

  # Whitelist a circle's client-writable profile fields from the params map the
  # controller forwards (which also carries the route's `"id"`). Mirrors how
  # `create/2` reads its own fields, so an update accepts the same two spellings
  # and nothing else.
  defp circle_profile_attrs(attrs) do
    %{}
    |> maybe_put_circle_attr(:name, fetch_circle_attr(attrs, :name))
    |> maybe_put_circle_attr(:description, fetch_circle_attr(attrs, :description))
    |> maybe_put_circle_attr(:avatar_media_id, fetch_circle_media_id(attrs))
  end

  defp fetch_circle_attr(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))

  defp fetch_circle_media_id(attrs) do
    Map.get(attrs, :avatarMediaId) || Map.get(attrs, "avatarMediaId") ||
      Map.get(attrs, :avatar_media_id) || Map.get(attrs, "avatar_media_id")
  end

  defp maybe_put_circle_attr(map, _key, nil), do: map
  defp maybe_put_circle_attr(map, key, value), do: Map.put(map, key, value)

  defp get_circle_conversation(circle_id) do
    case Ecto.UUID.cast(circle_id) do
      {:ok, uuid} -> Repo.get(Conversation, uuid)
      :error -> nil
    end
    |> case do
      %Conversation{type: :circle} = c -> c
      _ -> nil
    end
  end

  defp do_invite(actor, conversation, user_ids) do
    actor_id = actor.id
    circle_id = conversation.id

    results =
      Enum.reduce(user_ids, %{}, fn uid, acc ->
        with {:ok, invitee_id} <- normalize_id(uid),
             :ok <- ensure_actor_is_member?(actor_id, circle_id),
             :ok <- not_self?(actor_id, invitee_id),
             :ok <- friends?(actor_id, invitee_id),
             {:ok, _} <- create_invitation(conversation, actor_id, invitee_id) do
          Map.put(acc, invitee_id, :ok)
        else
          {:error, reason} -> Map.put(acc, uid, reason)
        end
      end)

    {:ok, results}
  end

  defp ensure_actor_is_member?(actor_id, circle_id) do
    if Repo.exists?(
         from(m in CircleMembership,
           where: m.circle_id == ^circle_id and m.user_id == ^actor_id and m.state == :active
         )
       ) do
      :ok
    else
      {:error, :not_member}
    end
  end

  defp not_self?(a, b) when a == b, do: {:error, :self}
  defp not_self?(_, _), do: :ok

  defp friends?(a, b) do
    a_user = %User{id: a}
    b_user = %User{id: b}
    if Social.are_friends?(a_user, b_user), do: :ok, else: {:error, :not_friends}
  end

  defp create_invitation(conversation, inviter_id, invitee_id) do
    %CircleInvitation{}
    |> CircleInvitation.create_changeset(%{
      circle_id: conversation.id,
      inviter_id: inviter_id,
      invitee_id: invitee_id,
      state: :pending
    })
    |> Repo.insert()
    |> case do
      # A pending invitation already exists (the partial unique index refused
      # the second one). That is a per-person result, not a fault.
      {:error, %Ecto.Changeset{errors: errors}} ->
        if Keyword.has_key?(errors, :circle_id) do
          {:error, :already_invited}
        else
          {:error, :invalid}
        end

      other ->
        other
    end
  end

  defp normalize_id(id) when is_binary(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :invalid}
    end
  end

  defp normalize_id(_), do: {:error, :invalid}

  defp do_respond(user, %CircleInvitation{} = invitation, :decline) do
    if invitation.invitee_id == user.id and invitation.state == :pending do
      invitation
      |> CircleInvitation.state_changeset(:declined)
      |> Repo.update()
      |> case do
        {:ok, _} -> {:ok, invitation}
        other -> other
      end
    else
      {:error, :not_found}
    end
  end

  defp do_respond(user, %CircleInvitation{} = invitation, :accept) do
    if invitation.invitee_id != user.id or invitation.state != :pending do
      {:error, :not_found}
    else
      accept_invitation_with_lock(invitation, user)
    end
  end

  defp accept_invitation_with_lock(invitation, user) do
    Repo.transaction(fn ->
      # Lock on circle to prevent races - count active memberships with FOR UPDATE
      _locked =
        Repo.one(
          from(c in Conversation, where: c.id == ^invitation.circle_id, lock: "FOR UPDATE")
        )

      active_count =
        Repo.one(
          from(m in CircleMembership,
            where: m.circle_id == ^invitation.circle_id and m.state == :active,
            select: count(m.id)
          )
        ) || 0

      if active_count >= @max_members do
        Repo.rollback(:circle_full)
      else
        now = DateTime.utc_now()

        # A former member (`:left`/`:removed`) still occupies the row under the
        # unique `(circle_id, user_id)` index, so a plain insert would raise.
        # Reactivate that row instead, refreshing `joined_at` to now: the join
        # boundary (`created_at >= joined_at`) then hides everything sent
        # before the rejoin, exactly as for a first-time joiner. Design §5's
        # "new row" reads as "a new active membership", not a second row.
        membership =
          %CircleMembership{}
          |> CircleMembership.create_changeset(%{
            circle_id: invitation.circle_id,
            user_id: user.id,
            role: :member,
            state: :active,
            joined_at: now,
            left_at: nil
          })
          |> Repo.insert(
            on_conflict: {:replace, [:role, :state, :joined_at, :left_at]},
            conflict_target: [:circle_id, :user_id],
            returning: true
          )
          |> case do
            {:ok, membership} -> membership
            {:error, changeset} -> Repo.rollback(changeset)
          end

        invitation
        |> CircleInvitation.state_changeset(:accepted)
        |> Repo.update!()

        membership
      end
    end)
    |> case do
      {:ok, result} -> {:ok, result}
      {:error, :circle_full} -> {:error, :circle_full}
      {:error, other} -> {:error, other}
    end
  end

  defp do_leave(%User{} = user, conversation) do
    circle_id = conversation.id

    Repo.transaction(fn ->
      membership =
        Repo.one(
          from(m in CircleMembership,
            where: m.circle_id == ^circle_id and m.user_id == ^user.id and m.state == :active,
            lock: "FOR UPDATE"
          )
        )

      if is_nil(membership) do
        Repo.rollback(:not_member)
      else
        now = DateTime.utc_now()

        membership
        |> Ecto.Changeset.change(state: :left, left_at: now)
        |> Repo.update!()

        # Mark pending deliveries as unreachable
        AwsemChat.Chat.mark_recipient_unreachable(user.id, circle_id)

        # If owner left, promote oldest active member
        if membership.role == :owner do
          promote_oldest_owner(circle_id)
        end

        :ok
      end
    end)
    |> case do
      {:ok, :ok} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_remove_member(%User{} = actor, conversation, user_id) do
    circle_id = conversation.id

    target_id =
      case Ecto.UUID.cast(user_id) do
        {:ok, uuid} -> uuid
        :error -> nil
      end

    if is_nil(target_id) do
      {:error, :not_found}
    else
      Repo.transaction(fn ->
        actor_mem =
          Repo.one(
            from(m in CircleMembership,
              where: m.circle_id == ^circle_id and m.user_id == ^actor.id and m.state == :active,
              lock: "FOR UPDATE"
            )
          )

        if is_nil(actor_mem) or actor_mem.role not in [:owner, :admin] do
          Repo.rollback(:forbidden)
        else
          membership =
            Repo.one(
              from(m in CircleMembership,
                where:
                  m.circle_id == ^circle_id and m.user_id == ^target_id and m.state == :active,
                lock: "FOR UPDATE"
              )
            )

          if is_nil(membership) do
            Repo.rollback(:not_member)
          else
            now = DateTime.utc_now()

            membership
            |> Ecto.Changeset.change(state: :removed, left_at: now)
            |> Repo.update!()

            AwsemChat.Chat.mark_recipient_unreachable(target_id, circle_id)

            if membership.role == :owner do
              promote_oldest_owner(circle_id)
            end

            :ok
          end
        end
      end)
      |> case do
        {:ok, :ok} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp promote_oldest_owner(circle_id) do
    oldest =
      Repo.one(
        from(m in CircleMembership,
          where: m.circle_id == ^circle_id and m.state == :active,
          order_by: [asc: m.joined_at, asc: m.inserted_at],
          limit: 1,
          lock: "FOR UPDATE"
        )
      )

    if oldest do
      oldest
      |> Ecto.Changeset.change(role: :owner)
      |> Repo.update!()
    else
      :ok
    end
  end

  # A circle change: everyone who is an active member *now* is told, plus any
  # `extra` user the change touched (a removed member is no longer active but
  # must still learn to drop the circle). Recipients are read after the write
  # committed, so a user who lost access is not sent an event as a member.
  defp broadcast_circle_change(circle_id, change, extra \\ []) do
    Broadcast.circle_changed(circle_id, change, active_member_ids(circle_id) ++ extra)
  end

  defp cast_id(id) when is_binary(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> uuid
      :error -> nil
    end
  end

  defp cast_id(_), do: nil

  defp active_member_ids(circle_id) do
    Repo.all(
      from(m in CircleMembership,
        where: m.circle_id == ^circle_id and m.state == :active,
        select: m.user_id
      )
    )
  end
end
