defmodule AwsemChatWeb.UserJSON do
  @moduledoc """
  Wire shape for a user profile. Mirrors the design doc's `users` fields, minus
  `phone` (never echoed back) and server-only bookkeeping.
  """

  alias AwsemChat.Accounts.User

  @doc "Serializes a user for the client."
  def data(%User{} = user) do
    %{
      id: user.id,
      displayName: user.display_name,
      pin: user.pin,
      statusText: user.status_text,
      avatarMediaId: user.avatar_media_id
    }
  end

  @doc "Serializes a user at sign-in, including the phone they signed in with."
  def auth_data(%User{} = user) do
    Map.put(data(user), :phone, user.phone)
  end
end
