defmodule AwsemChatWeb.Auth do
  @moduledoc """
  Bearer-token authentication for `/api/v1`.

  Reads `Authorization: Bearer <token>`, resolves it through
  `AwsemChat.Accounts.authenticate/1`, and either assigns `:current_user` or
  halts through the error table with `unauthorized`.
  """

  import Plug.Conn

  alias AwsemChat.Accounts
  alias AwsemChatWeb.Errors

  @behaviour Plug

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    with {:ok, token} <- bearer_token(conn),
         {:ok, user} <- Accounts.authenticate(token) do
      conn
      |> assign(:current_user, user)
      |> assign(:current_token, token)
    else
      _ -> conn |> Errors.render(:unauthorized) |> halt()
    end
  end

  defp bearer_token(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] when byte_size(token) > 0 -> {:ok, token}
      _ -> {:error, :unauthorized}
    end
  end
end
