defmodule AwsemChatWeb.ErrorJSON do
  @moduledoc """
  Error rendering.

  `render/2` is Phoenix's entry point for a status it generated itself. The one
  status the API contract owns is 500: an unhandled exception is answered with
  the same envelope as every other API error,
  `{"error": {"code": "internal_error"}}`, and nothing of the exception — no
  message, no stacktrace, no module name — travels with it.

  A framework-generated 4xx (an unrouted path, a method that does not exist)
  keeps Phoenix's default shape, so a URL that is simply wrong does not pretend
  to be an API code the client's mapper would try to interpret.
  """

  @doc "Renders the API error envelope with a machine-readable `code`."
  def error(code), do: %{error: %{code: to_string(code)}}

  def render("500.json", _assigns), do: error(:internal_error)

  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end
