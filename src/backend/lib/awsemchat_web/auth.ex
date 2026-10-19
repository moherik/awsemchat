defmodule AwsemChatWeb.Auth do
  @moduledoc """
  Bearer-token authentication for `/api/v1`.

  Reads `Authorization: Bearer <token>`, resolves it through
  `AwsemChat.Accounts.authenticate/1`, and either assigns `:current_user` or
  halts with a 401 `unauthorized` envelope.
  """

  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  alias AwsemChat.Accounts
  alias AwsemChatWeb.ErrorJSON

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
      _ -> unauthorized(conn)
    end
  end

  defp bearer_token(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] when byte_size(token) > 0 -> {:ok, token}
      _ -> {:error, :unauthorized}
    end
  end

  defp unauthorized(conn) do
    conn
    |> put_status(:unauthorized)
    |> json(ErrorJSON.error(:unauthorized))
    |> halt()
  end
end
