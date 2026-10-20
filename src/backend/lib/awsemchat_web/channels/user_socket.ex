defmodule AwsemChatWeb.UserSocket do
  @moduledoc """
  The one realtime socket, at `/socket`, authenticated by a bearer token in the
  connect params (`%{"token" => token}`).

  Connect resolves the token through `Accounts.authenticate/1` and assigns
  `:user_id`. A missing or bad token refuses the connection outright — the
  socket never connects anonymously and never trusts a client-supplied user id,
  so the authenticated id is the only identity any channel below can see.
  """

  use Phoenix.Socket

  alias AwsemChat.Accounts

  channel "user:*", AwsemChatWeb.UserChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) when is_binary(token) do
    case Accounts.authenticate(token) do
      {:ok, user} -> {:ok, assign(socket, :user_id, user.id)}
      {:error, :unauthorized} -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  # Each connection gets its own id, so multiple devices can be connected
  # simultaneously and all receive broadcasts on the user's topic.
  @impl true
  def id(socket),
    do: "user_socket:#{socket.assigns.user_id}:#{System.unique_integer([:positive])}"
end
