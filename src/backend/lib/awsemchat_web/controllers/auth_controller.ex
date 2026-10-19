defmodule AwsemChatWeb.AuthController do
  @moduledoc """
  Sign-in endpoints: request a code, verify it, revoke the session.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Accounts
  alias AwsemChatWeb.ErrorJSON
  alias AwsemChatWeb.UserJSON

  def request_code(conn, %{"phone" => phone}) when is_binary(phone) do
    case Accounts.request_code(phone) do
      {:ok, %{requestId: request_id}} ->
        json(conn, %{requestId: request_id})

      {:error, _changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(ErrorJSON.error(:invalid_phone))
    end
  end

  def request_code(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(ErrorJSON.error(:phone_required))
  end

  def verify_code(conn, %{"phone" => phone, "code" => code})
      when is_binary(phone) and is_binary(code) do
    case Accounts.verify_code(phone, code) do
      {:ok, %{token: token, user: user}} ->
        json(conn, %{token: token, user: UserJSON.auth_data(user)})

      {:error, reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(ErrorJSON.error(reason))
    end
  end

  def verify_code(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(ErrorJSON.error(:phone_and_code_required))
  end

  def logout(conn, _params) do
    token = conn.assigns.current_token
    :ok = Accounts.logout(token)
    json(conn, %{})
  end
end
