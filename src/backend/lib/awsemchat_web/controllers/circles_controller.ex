defmodule AwsemChatWeb.CirclesController do
  @moduledoc """
  Circles over REST: create, update, invite, answer an invitation, leave,
  remove a member, list members.

  Every rule lives in `AwsemChat.Circles`; this module translates params into
  context calls and context errors into a code from `AwsemChatWeb.Errors`. A
  reason the table has no code for is a server fault, never a 400: answering a
  fault with `bad_request` blamed the client for our own bug.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Circles
  alias AwsemChatWeb.{CircleJSON, CircleMembershipJSON, Errors}

  def create(conn, params) do
    case Circles.create(conn.assigns.current_user, params) do
      {:ok, circle} ->
        conn |> put_status(:created) |> json(%{circle: CircleJSON.data(circle)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def show(conn, %{"id" => id}) do
    # simple
    conn |> json(%{id: id})
  end

  def update(conn, %{"id" => id} = params) do
    attrs = Map.drop(params, ["id"])

    case Circles.update(conn.assigns.current_user, id, attrs) do
      {:ok, circle} ->
        json(conn, %{circle: CircleJSON.data(circle)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def invite(conn, %{"id" => id} = params) do
    user_ids = params["userIds"] || params["user_ids"] || []

    case Circles.invite(conn.assigns.current_user, id, user_ids) do
      {:ok, results} ->
        json(conn, %{results: results})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def accept_invitation(conn, %{"id" => id}) do
    case Circles.respond(conn.assigns.current_user, id, :accept) do
      {:ok, _} ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def decline_invitation(conn, %{"id" => id}) do
    case Circles.respond(conn.assigns.current_user, id, :decline) do
      {:ok, _} ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def leave(conn, %{"id" => id}) do
    case Circles.leave(conn.assigns.current_user, id) do
      :ok ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def remove_member(conn, %{"id" => id, "userId" => user_id}) do
    case Circles.remove_member(conn.assigns.current_user, id, user_id) do
      :ok ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def list_members(conn, %{"id" => id}) do
    case Circles.list_members(conn.assigns.current_user, id) do
      {:ok, members} ->
        json(conn, %{members: Enum.map(members, &CircleMembershipJSON.data/1)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end
end
