defmodule AwsemChatWeb.ReactionsController do
  @moduledoc """
  Reactions over REST: set, clear, and list aggregates for a target type.

  Thin, like the other controllers. `AwsemChat.Reactions` owns the rules — one
  reaction per (target, user), the target must be visible to the caller
  (membership plus the circle join boundary) — and this module translates params
  into context calls and context errors into a code from `AwsemChatWeb.Errors`.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Reactions
  alias AwsemChatWeb.{Errors, ReactionJSON}

  def set(conn, %{"targetType" => target_type, "targetId" => target_id} = params) do
    emoji = params["emoji"]

    case Reactions.set(conn.assigns.current_user, target_type, target_id, emoji) do
      {:ok, reaction} ->
        json(conn, %{reaction: ReactionJSON.data(reaction)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def unset(conn, %{"targetType" => target_type, "targetId" => target_id}) do
    case Reactions.unset(conn.assigns.current_user, target_type, target_id) do
      {:ok, _} ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def index(conn, %{"targetType" => target_type} = params) do
    aggregates =
      Reactions.list_for(conn.assigns.current_user, target_type, target_ids(params))

    json(conn, ReactionJSON.aggregates(aggregates))
  end

  # Accept both `?ids=a,b,c` and the repeated-param form `?ids[]=a&ids[]=b`.
  defp target_ids(params) do
    case params["ids"] do
      ids when is_list(ids) -> ids
      ids when is_binary(ids) -> String.split(ids, ",", trim: true)
      _ -> []
    end
  end
end
