defmodule AwsemChatWeb.ErrorProbeController do
  @moduledoc """
  Raises on purpose, so a test can assert what an unhandled exception looks like
  on the wire.

  Only routed when `config :awsemchat, :test_error_routes` is true (the test
  env). The exception message is a marker a test greps the response for; if the
  envelope ever started echoing the exception, that marker would appear and the
  test would fail.
  """

  use AwsemChatWeb, :controller

  @marker "probe-exception-marker-c0ffee"

  def boom(_conn, _params) do
    raise RuntimeError, @marker
  end
end
