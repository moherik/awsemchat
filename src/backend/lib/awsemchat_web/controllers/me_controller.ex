defmodule AwsemChatWeb.MeController do
  @moduledoc """
  The signed-in user's own profile.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Accounts
  alias AwsemChatWeb.{Errors, UserJSON}

  def show(conn, _params) do
    json(conn, UserJSON.data(conn.assigns.current_user))
  end

  def update(conn, params) do
    case Accounts.update_profile(conn.assigns.current_user, params) do
      {:ok, user} -> json(conn, UserJSON.data(user))
      {:error, _changeset} -> Errors.render(conn, :invalid_profile)
    end
  end
end
