defmodule AwsemChat.Reactions do
  @moduledoc """
  Reactions on targets (messages and moments).

  A user may have at most one reaction per (target_type, target_id).
  Setting the same emoji again is effectively a no-op.
  """

  import Ecto.Query

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat
  alias AwsemChat.Chat.{CircleMembership, Conversation, Message}
  alias AwsemChat.Moments.Moment
  alias AwsemChat.Reactions.Reaction
  alias AwsemChat.Repo

  def set(%User{} = user, target_type, target_id, emoji) when is_atom(target_type) do
    with {:ok, target_type} <- normalize_target_type(target_type),
         {:ok, target_id} <- normalize_uuid(target_id),
         {:ok, _} <- ensure_target_visible(user, target_type, target_id) do
      do_set(user, target_type, target_id, to_string(emoji))
    end
  end

  def set(%User{} = user, target_type, target_id, emoji) when is_binary(target_type) do
    with {:ok, target_type} <- normalize_target_type_string(target_type),
         {:ok, target_id} <- normalize_uuid(target_id),
         {:ok, _} <- ensure_target_visible(user, target_type, target_id) do
      do_set(user, target_type, target_id, to_string(emoji))
    end
  end

  def unset(%User{} = user, target_type, target_id) do
    with {:ok, target_type} <- normalize_target_type(target_type),
         {:ok, target_id} <- normalize_uuid(target_id),
         {:ok, _} <- ensure_target_visible(user, target_type, target_id) do
      case Repo.get_by(Reaction, user_id: user.id, target_type: target_type, target_id: target_id) do
        nil ->
          {:ok, nil}

        reaction ->
          case Repo.delete(reaction) do
            {:ok, deleted} ->
              broadcast_change(deleted.target_type, deleted.target_id, deleted.user_id)
              {:ok, deleted}

            other ->
              other
          end
      end
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  Reaction aggregates for `ids` of `target_type`, restricted to what `user` may
  see.

  A reaction is not more readable than its target: each id is checked with the
  same visibility rule the write path applies (`ensure_target_visible/3`), so a
  late joiner does not receive aggregates for prejoin messages and a non-member
  receives nothing for a conversation they cannot read. Ids the caller may not
  see are simply absent from the result — there is no per-id error to tell an
  invisible target from a non-existent one.
  """
  def list_for(%User{} = user, target_type, ids) when is_list(ids) do
    case normalize_target_type(target_type) do
      {:ok, target_type} ->
        uuids =
          Enum.flat_map(ids, fn id ->
            case normalize_uuid(id) do
              {:ok, u} -> [u]
              :error -> []
            end
          end)

        visible_uuids =
          Enum.filter(uuids, fn id ->
            match?({:ok, _}, ensure_target_visible(user, target_type, id))
          end)

        if visible_uuids == [] do
          %{}
        else
          query =
            from(r in Reaction,
              where: r.target_type == ^target_type and r.target_id in ^visible_uuids
            )

          Repo.all(query)
          |> Enum.group_by(& &1.target_id)
          |> Enum.into(%{}, fn {tid, rs} ->
            {to_string(tid), Enum.map(rs, fn r -> %{emoji: r.emoji, userId: r.user_id} end)}
          end)
        end

      :error ->
        %{}
    end
  end

  defp do_set(user, target_type, target_id, emoji) do
    attrs = %{target_type: target_type, target_id: target_id, user_id: user.id, emoji: emoji}
    changeset = Reaction.changeset(%Reaction{}, attrs)

    case Repo.insert(changeset) do
      {:ok, reaction} ->
        broadcast_change(reaction.target_type, reaction.target_id, reaction.user_id)
        {:ok, reaction}

      {:error, changeset} ->
        if Keyword.has_key?(changeset.errors, :user_id) or
             Keyword.has_key?(changeset.errors, :"user_id, target_type, target_id") do
          case Repo.get_by(Reaction,
                 user_id: user.id,
                 target_type: target_type,
                 target_id: target_id
               ) do
            nil ->
              {:error, changeset}

            existing ->
              if existing.emoji == emoji do
                {:ok, existing}
              else
                existing
                |> Reaction.changeset(%{emoji: emoji})
                |> Repo.update()
                |> case do
                  {:ok, updated} ->
                    broadcast_change(updated.target_type, updated.target_id, updated.user_id)
                    {:ok, updated}

                  other ->
                    other
                end
              end
          end
        else
          {:error, changeset}
        end
    end
  end

  defp broadcast_change(target_type, target_id, _user_id) do
    case fetch_conversation_for_target(target_type, target_id) do
      {:ok, conversation_id} ->
        AwsemChat.Chat.Broadcast.reaction_changed(%{
          conversation_id: conversation_id,
          target_type: target_type,
          target_id: target_id
        })

      _ ->
        :ok
    end
  end

  defp normalize_target_type(:message), do: {:ok, :message}
  defp normalize_target_type(:moment), do: {:ok, :moment}
  defp normalize_target_type(_), do: :error

  defp normalize_target_type_string("message"), do: {:ok, :message}
  defp normalize_target_type_string("moment"), do: {:ok, :moment}
  defp normalize_target_type_string(_), do: :error

  defp normalize_uuid(id) when is_binary(id) do
    Ecto.UUID.cast(id)
  rescue
    _ -> :error
  end

  defp normalize_uuid(id) do
    try do
      Ecto.UUID.cast(to_string(id))
    rescue
      _ -> :error
    end
  end

  defp ensure_target_visible(user, :message, target_id) do
    case Repo.get(Message, target_id) do
      nil ->
        {:error, :not_found}

      %Message{conversation_id: conversation_id} = message ->
        case Chat.get_conversation(user, conversation_id) do
          %Conversation{} ->
            # Membership alone is not enough in a circle: the same join boundary
            # the chat reads apply (a late joiner may not react to a prejoin
            # message). Private conversations have no boundary.
            if visible_at_join_boundary?(user, conversation_id, message.created_at) do
              {:ok, target_id}
            else
              {:error, :not_found}
            end

          nil ->
            {:error, :not_found}
        end
    end
  end

  defp ensure_target_visible(user, :moment, target_id) do
    case Repo.get(Moment, target_id) do
      nil ->
        {:error, :not_found}

      %Moment{conversation_id: conversation_id} = moment ->
        case get_conversation_for_moment(user, conversation_id) do
          {:ok, _conversation} ->
            if visible_at_join_boundary?(user, conversation_id, moment.created_at) do
              {:ok, target_id}
            else
              {:error, :not_found}
            end

          {:error, :not_found} ->
            {:error, :not_found}

          {:error, _} = err ->
            err
        end
    end
  end

  defp get_conversation_for_moment(%User{} = user, conversation_id) do
    case fetch_conversation(conversation_id) do
      nil ->
        {:error, :not_found}

      conversation ->
        if visible_conversation?(user, conversation) do
          {:ok, conversation}
        else
          {:error, :not_found}
        end
    end
  end

  defp visible_at_join_boundary?(user, conversation_id, created_at) do
    conversation = fetch_conversation(conversation_id)

    case conversation && conversation.type do
      :circle ->
        case get_active_membership(conversation_id, user.id) do
          %CircleMembership{joined_at: joined_at} when not is_nil(joined_at) ->
            DateTime.compare(joined_at, created_at) != :gt

          _ ->
            false
        end

      _ ->
        true
    end
  end

  defp fetch_conversation(conversation_id) do
    case Ecto.UUID.cast(conversation_id) do
      {:ok, uuid} -> Repo.get(Conversation, uuid)
      :error -> nil
    end
  end

  defp visible_conversation?(user, conversation) do
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

  defp get_active_membership(circle_id, user_id) do
    Repo.get_by(CircleMembership, circle_id: circle_id, user_id: user_id, state: :active)
  end

  defp fetch_conversation_for_target(:message, target_id) do
    case Repo.get(Message, target_id) do
      %Message{conversation_id: cid} -> {:ok, cid}
      _ -> :error
    end
  end

  defp fetch_conversation_for_target(:moment, target_id) do
    case Repo.get(Moment, target_id) do
      %Moment{conversation_id: cid} -> {:ok, cid}
      _ -> :error
    end
  end
end
