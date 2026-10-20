defmodule AwsemChat.Social do
  @moduledoc """
  Friends and blocking: PIN-addressed requests, accepted friendships, blocks.

  ## Friendship row shape

  A friendship is stored as **one row per direction** — accepting writes both
  `(a, b)` and `(b, a)`, unfriending deletes both. The alternative (a single
  canonical sorted-pair row) trades a simpler write for an `OR` or `UNION` on
  every read; a directed row keeps `are_friends?/2` one indexed lookup and
  "list `a`'s friends" a plain join. Both rows are always written and removed
  in one transaction, so the pair cannot drift apart. See
  `AwsemChat.Social.Friendship`.

  ## Blocking

  A block is stored in one direction but enforced symmetrically. Every check
  here is `blocked_either?/2`, so neither side can tell who blocked whom, and a
  block in either direction stops new requests and new private sends.

  ## Ending a friendship

  Unfriend and block do **not** touch the conversation: the row and its messages
  stay, both sides keep reading them, and only new sends are refused (see
  `AwsemChat.Chat.send_message/3`). This is the owner's recorded decision.
  """

  import Ecto.Query

  alias AwsemChat.Accounts.User
  alias AwsemChat.Chat.Conversation
  alias AwsemChat.Repo
  alias AwsemChat.Social.{Blocking, FriendRequest, Friendship}

  @doc """
  Sends a friend request addressed by `pin`.

  Errors: `:not_found` (no such PIN), `:self`, `:blocked`, `:already_friends`.
  Re-requesting while a request is already pending returns that request rather
  than creating a second one.
  """
  def request_by_pin(%User{} = sender, pin) when is_binary(pin) do
    with {:ok, recipient} <- find_by_pin(pin),
         :ok <- reject_self(sender, recipient),
         :ok <- reject_blocked(sender, recipient),
         :ok <- reject_existing_friendship(sender, recipient) do
      start_request(sender, recipient)
    end
  end

  @doc """
  Answers a request: the recipient accepts or declines, the sender cancels.

  Accepting writes both friendship rows and the private conversation in one
  transaction. Errors: `:not_found` (no such request, or not yours, or already
  answered), `:blocked`.
  """
  def respond(%User{} = user, request_id, action) when action in [:accept, :decline, :cancel] do
    case fetch_pending_request(user, request_id, action) do
      %FriendRequest{} = request -> apply_action(request, action)
      # No such request, not this user's action to take, or already answered —
      # all the same answer, so ids are not probeable.
      nil -> {:error, :not_found}
    end
  end

  @doc "Pending requests for `user`; `:incoming` or `:outgoing`."
  def list_requests(%User{} = user, direction) when direction in [:incoming, :outgoing] do
    {field, preload} =
      case direction do
        :incoming -> {:recipient_id, :sender}
        :outgoing -> {:sender_id, :recipient}
      end

    query =
      from(r in FriendRequest,
        where: field(r, ^field) == ^user.id and r.state == :pending,
        order_by: [desc: r.inserted_at, desc: r.id],
        preload: [^preload]
      )

    {:ok, Repo.all(query)}
  end

  @doc """
  The accepted friends of `user`, as user profiles, optionally filtered by a
  display-name or PIN query string.
  """
  def list_friends(%User{} = user, opts \\ %{}) do
    query =
      from(f in Friendship,
        join: u in User,
        on: u.id == f.friend_id,
        where: f.user_id == ^user.id,
        order_by: [asc: u.display_name, asc: u.id],
        select: u
      )
      |> apply_friend_query(opts)

    {:ok, Repo.all(query)}
  end

  @doc """
  Ends the friendship in both directions.

  The private conversation is left in place — history stays readable on both
  sides and new sends are refused (`:conversation_read_only`). Idempotent:
  unfriending someone who is not a friend is `:ok`.
  """
  def unfriend(%User{} = user, %User{} = other) do
    Repo.transaction(fn ->
      delete_friendship(user, other)
      delete_friendship(other, user)
    end)

    :ok
  end

  @doc """
  Blocks `other` on behalf of `user`.

  Idempotent. Shared circles are unaffected (they are membership, not
  friendship); the private conversation becomes read-only in both directions.
  """
  def block(%User{} = user, %User{} = other) do
    %Blocking{}
    |> Blocking.changeset(user, other)
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:blocker_id, :blocked_id])

    :ok
  end

  @doc "Removes a block; idempotent."
  def unblock(%User{} = user, %User{} = other) do
    from(b in Blocking, where: b.blocker_id == ^user.id and b.blocked_id == ^other.id)
    |> Repo.delete_all()

    :ok
  end

  @doc "Whether either side has blocked the other. Symmetric by design."
  def blocked_either?(%User{id: a}, %User{id: b}), do: blocked_pair?(a, b)

  @doc "Whether `a` and `b` are friends, in either direction."
  def are_friends?(%User{id: a}, %User{id: b}) do
    from(f in Friendship,
      where:
        (f.user_id == ^a and f.friend_id == ^b) or
          (f.user_id == ^b and f.friend_id == ^a)
    )
    |> Repo.exists?()
  end

  @doc "The users `user` has blocked, as profiles."
  def list_blocked(%User{} = user) do
    from(b in Blocking,
      join: u in User,
      on: u.id == b.blocked_id,
      where: b.blocker_id == ^user.id,
      order_by: [asc: u.display_name, asc: u.id],
      select: u
    )
    |> Repo.all()
  end

  @doc """
  Finds or creates the private conversation for a friend pair.

  Visible only when the pair exists — a caller who is not in the pair gets
  `:error`. The key is the sorted pair, so both directions resolve the same row.
  """
  def private_conversation(%User{} = user, %User{} = other) do
    if user.id in [other.id], do: {:error, :same_user}, else: fetch_or_create_private(user, other)
  end

  @doc """
  Whether `sender` may open a private send to `peer` right now: friends both
  ways with no block either way. The conversation row surviving a break is
  exactly what makes this the send-time gate rather than a row check.
  """
  def send_allowed?(%User{} = sender, %User{} = peer) do
    not blocked_either?(sender, peer) and are_friends?(sender, peer)
  end

  # --- request internals ----------------------------------------------------

  defp start_request(sender, recipient) do
    case fetch_pending_pair(sender, recipient) do
      %FriendRequest{} = existing ->
        {:ok, existing}

      nil ->
        %FriendRequest{}
        |> FriendRequest.create_changeset(sender, recipient)
        |> Repo.insert()
        |> case do
          {:ok, request} ->
            {:ok, Repo.preload(request, [:sender, :recipient])}

          # A concurrent request from the same direction won; return theirs.
          {:error, _changeset} ->
            case fetch_pending_pair(sender, recipient) do
              %FriendRequest{} = existing -> {:ok, existing}
              nil -> {:error, :conflict}
            end
        end
    end
  end

  defp fetch_pending_pair(sender, recipient) do
    Repo.get_by(FriendRequest,
      sender_id: sender.id,
      recipient_id: recipient.id,
      state: :pending
    )
  end

  defp find_by_pin(pin) do
    case Repo.get_by(User, pin: pin) do
      %User{} = user -> {:ok, user}
      nil -> {:error, :not_found}
    end
  end

  defp reject_self(%User{id: id}, %User{id: id}), do: {:error, :self}
  defp reject_self(_sender, _recipient), do: :ok

  defp reject_blocked(sender, recipient) do
    if blocked_either?(sender, recipient), do: {:error, :blocked}, else: :ok
  end

  defp reject_existing_friendship(sender, recipient) do
    if are_friends?(sender, recipient), do: {:error, :already_friends}, else: :ok
  end

  defp fetch_pending_request(user, request_id, action) do
    case Ecto.UUID.cast(request_id) do
      {:ok, uuid} -> Repo.get(FriendRequest, uuid)
      :error -> nil
    end
    |> case do
      %FriendRequest{state: :pending} = request -> authorize_side(user, request, action)
      _ -> nil
    end
  end

  # Each action belongs to one side: the recipient accepts/declines, the sender
  # cancels. Anyone else — including the other party — sees `:not_found`, the
  # same answer as a request that does not exist, so ids are not probeable.
  defp authorize_side(%User{id: id}, %FriendRequest{recipient_id: id} = request, action)
       when action in [:accept, :decline],
       do: request

  defp authorize_side(%User{id: id}, %FriendRequest{sender_id: id} = request, :cancel),
    do: request

  defp authorize_side(_user, _request, _action), do: nil

  defp apply_action(request, :accept) do
    {sender, recipient} = {request.sender_id, request.recipient_id}

    if blocked_pair?(sender, recipient) do
      {:error, :blocked}
    else
      Repo.transaction(fn ->
        request = update_state!(request, :accepted)
        create_friendship!(sender, recipient)
        create_friendship!(recipient, sender)
        ensure_private_conversation!(sender, recipient)
        request
      end)
    end
  end

  defp apply_action(request, :decline), do: {:ok, update_state!(request, :declined)}
  defp apply_action(request, :cancel), do: {:ok, update_state!(request, :cancelled)}

  defp blocked_pair?(a, b) do
    from(bl in Blocking,
      where:
        (bl.blocker_id == ^a and bl.blocked_id == ^b) or
          (bl.blocker_id == ^b and bl.blocked_id == ^a)
    )
    |> Repo.exists?()
  end

  defp update_state!(request, state) do
    case request |> FriendRequest.state_changeset(state) |> Repo.update() do
      {:ok, updated} -> Repo.preload(updated, [:sender, :recipient])
      {:error, changeset} -> Repo.rollback(changeset)
    end
  end

  defp create_friendship!(user_id, friend_id) do
    %Friendship{}
    |> Friendship.changeset(%User{id: user_id}, %User{id: friend_id})
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:user_id, :friend_id])
  end

  defp delete_friendship(%User{id: user_id}, %User{id: other_id}) do
    from(f in Friendship, where: f.user_id == ^user_id and f.friend_id == ^other_id)
    |> Repo.delete_all()
  end

  defp ensure_private_conversation!(a, b) do
    key = Conversation.private_key(a, b)

    case Repo.get_by(Conversation, private_key: key) do
      %Conversation{} = conversation ->
        conversation

      nil ->
        %Conversation{}
        |> Conversation.private_changeset(%User{id: a}, %User{id: b})
        |> Repo.insert()
        |> case do
          {:ok, conversation} -> conversation
          # A concurrent accept created it; the pair's row is the answer.
          {:error, _changeset} -> Repo.get_by(Conversation, private_key: key)
        end
    end
  end

  defp fetch_or_create_private(user, other) do
    key = Conversation.private_key(user, other)

    case Repo.get_by(Conversation, private_key: key) do
      %Conversation{} = conversation ->
        {:ok, conversation}

      nil ->
        %Conversation{}
        |> Conversation.private_changeset(user, other)
        |> Repo.insert()
        |> case do
          {:ok, conversation} -> {:ok, conversation}
          # A concurrent accept created it; the pair's row is the answer.
          {:error, _changeset} -> {:ok, Repo.get_by(Conversation, private_key: key)}
        end
    end
  end

  defp apply_friend_query(query, opts) do
    case Map.get(opts, :query) || Map.get(opts, "query") do
      nil -> query
      "" -> query
      term -> where(query, [f, u], ilike(u.display_name, ^"%#{term}%") or ilike(u.pin, ^term))
    end
  end
end
