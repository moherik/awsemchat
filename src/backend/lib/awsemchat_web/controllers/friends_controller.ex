defmodule AwsemChatWeb.FriendsController do
  @moduledoc """
  Friends and blocks over REST: list, request by PIN, answer, unfriend, block.

  Controllers stay thin. Every rule lives in `AwsemChat.Social`; this module
  only translates params into context calls and context errors into a code from
  `AwsemChatWeb.Errors`.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Accounts
  alias AwsemChat.Social
  alias AwsemChatWeb.{Errors, FriendRequestJSON, UserJSON}

  def index(conn, params) do
    {:ok, friends} = Social.list_friends(conn.assigns.current_user, params)
    json(conn, %{friends: Enum.map(friends, &UserJSON.data/1)})
  end

  def create_request(conn, %{"pin" => pin}) when is_binary(pin) do
    case Social.request_by_pin(conn.assigns.current_user, pin) do
      {:ok, request} ->
        conn |> put_status(:created) |> json(FriendRequestJSON.data(request))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason))
    end
  end

  def create_request(conn, _params), do: Errors.render(conn, :pin_required)

  def list_requests(conn, params) do
    {:ok, requests} = Social.list_requests(conn.assigns.current_user, direction(params))
    json(conn, %{requests: Enum.map(requests, &FriendRequestJSON.data/1)})
  end

  def accept_request(conn, %{"id" => id}), do: respond(conn, id, :accept)
  def decline_request(conn, %{"id" => id}), do: respond(conn, id, :decline)
  def cancel_request(conn, %{"id" => id}), do: respond(conn, id, :cancel)

  def delete(conn, %{"userId" => user_id}) do
    case Accounts.get_by_id(user_id) do
      %{} = other ->
        :ok = Social.unfriend(conn.assigns.current_user, other)
        json(conn, %{})

      nil ->
        Errors.render(conn, :user_not_found)
    end
  end

  def create_block(conn, %{"userId" => user_id}) do
    case Accounts.get_by_id(user_id) do
      %{} = other ->
        :ok = Social.block(conn.assigns.current_user, other)
        json(conn, %{})

      nil ->
        Errors.render(conn, :user_not_found)
    end
  end

  def delete_block(conn, %{"userId" => user_id}) do
    case Accounts.get_by_id(user_id) do
      %{} = other ->
        :ok = Social.unblock(conn.assigns.current_user, other)
        json(conn, %{})

      nil ->
        Errors.render(conn, :user_not_found)
    end
  end

  def list_blocks(conn, _params) do
    blocked = Social.list_blocked(conn.assigns.current_user)
    json(conn, %{blocks: Enum.map(blocked, &UserJSON.data/1)})
  end

  defp respond(conn, request_id, action) do
    case Social.respond(conn.assigns.current_user, request_id, action) do
      {:ok, request} -> json(conn, FriendRequestJSON.data(request))
      {:error, reason} -> Errors.render(conn, Errors.code_for(reason))
    end
  end

  defp direction(%{"direction" => "outgoing"}), do: :outgoing
  defp direction(_params), do: :incoming
end
