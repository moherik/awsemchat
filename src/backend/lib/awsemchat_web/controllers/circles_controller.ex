defmodule AwsemChatWeb.CirclesController do
  use AwsemChatWeb, :controller

  alias AwsemChat.Circles

  def create(conn, params) do
    case Circles.create(conn.assigns.current_user, params) do
      {:ok, circle} ->
        conn |> put_status(:created) |> json(%{circle: circle})

      {:error, reason} ->
        render_error(conn, reason)
    end
  end

  def show(conn, %{"id" => id}) do
    # simple
    conn |> json(%{id: id})
  end

  def update(conn, %{"id" => id} = params) do
    case Circles.update(conn.assigns.current_user, id, params) do
      {:ok, circle} -> json(conn, %{circle: circle})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def invite(conn, %{"id" => id} = params) do
    user_ids = params["userIds"] || params["user_ids"] || []

    case Circles.invite(conn.assigns.current_user, id, user_ids) do
      {:ok, results} -> json(conn, %{results: results})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def accept_invitation(conn, %{"id" => id}) do
    case Circles.respond(conn.assigns.current_user, id, :accept) do
      {:ok, _} -> json(conn, %{})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def decline_invitation(conn, %{"id" => id}) do
    case Circles.respond(conn.assigns.current_user, id, :decline) do
      {:ok, _} -> json(conn, %{})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def leave(conn, %{"id" => id}) do
    case Circles.leave(conn.assigns.current_user, id) do
      :ok -> json(conn, %{})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def remove_member(conn, %{"id" => id, "userId" => user_id}) do
    case Circles.remove_member(conn.assigns.current_user, id, user_id) do
      :ok -> json(conn, %{})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def list_members(conn, %{"id" => id}) do
    members = Circles.list_members(id)
    json(conn, %{members: members})
  end

  defp render_error(conn, :not_found), do: error(conn, :not_found, :not_found)
  defp render_error(conn, :not_member), do: error(conn, :forbidden, :not_member)
  defp render_error(conn, :forbidden), do: error(conn, :forbidden, :forbidden)
  defp render_error(conn, :circle_full), do: error(conn, :conflict, :circle_full)
  defp render_error(conn, :not_friends), do: error(conn, :forbidden, :not_friends)
  defp render_error(conn, _), do: error(conn, :bad_request, :bad_request)

  defp error(conn, status, code) do
    conn
    |> put_status(status)
    |> put_view(json: AwsemChatWeb.ErrorJSON)
    |> render(:error, code: code)
  end
end
