defmodule AwsemChatWeb.MessageJSON do
  @moduledoc """
  Message rendering for controllers. Delegates to `Chat.Envelope.render/1`, the
  one place that shapes a message for the client, so REST and the channel
  fan-out cannot drift apart.
  """

  alias AwsemChat.Chat.Envelope

  @doc "Renders one message."
  def data(message), do: Envelope.render(message)

  @doc "Renders a page of messages plus its cursor."
  def page(%{messages: messages, nextCursor: cursor}) do
    %{messages: Enum.map(messages, &data/1), nextCursor: cursor}
  end
end
