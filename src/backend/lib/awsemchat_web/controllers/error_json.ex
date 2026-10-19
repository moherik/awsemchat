defmodule AwsemChatWeb.ErrorJSON do
  @moduledoc """
  Error rendering.

  `render/2` keeps Phoenix's default shape for framework-generated statuses.
  API code paths render the plan's envelope through `error/1`:
  `{"error": {"code": "unauthorized"}}` with a lowercase snake_case code.
  """

  @doc "Renders the API error envelope with a machine-readable `code`."
  def error(code), do: %{error: %{code: to_string(code)}}

  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end
