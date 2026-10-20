defmodule AwsemChatWeb.AuthController do
  @moduledoc """
  Sign-in endpoints: request a code, verify it, revoke the session.

  The success paths shape the response; every failure names a code from
  `AwsemChatWeb.Errors` and lets the table choose the status. A wrong or expired
  code is `unauthorized` (401), the same answer for both, so a caller cannot
  probe which phones have a live code.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Accounts
  alias AwsemChatWeb.{Errors, UserJSON}

  def request_code(conn, %{"phone" => phone}) when is_binary(phone) do
    case Accounts.request_code(phone) do
      {:ok, %{requestId: request_id}} ->
        json(conn, %{requestId: request_id})

      {:error, reason} ->
        # A bad phone is the client's input; exhaustion is a server fault. The
        # mapping that says so lives in `Errors`, not here.
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_phone))
    end
  end

  def request_code(conn, _params), do: Errors.render(conn, :phone_required)

  def verify_code(conn, %{"phone" => phone, "code" => code})
      when is_binary(phone) and is_binary(code) do
    case Accounts.verify_code(phone, code) do
      {:ok, %{token: token, user: user}} ->
        json(conn, %{token: token, user: UserJSON.auth_data(user)})

      # `:invalid_code` and `:expired` are the same answer to the client.
      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason))
    end
  end

  def verify_code(conn, _params), do: Errors.render(conn, :phone_and_code_required)

  def logout(conn, _params) do
    token = conn.assigns.current_token
    :ok = Accounts.logout(token)
    json(conn, %{})
  end
end
