defmodule AwsemChatWeb.ChannelCase do
  @moduledoc """
  Test case for channel and socket tests.

  Same SQL-sandbox wiring as `AwsemChatWeb.ConnCase` (so a test can drive both
  the REST API and a subscribed socket against one checked-out connection), plus
  `Phoenix.ChannelTest` for `socket/3`, `subscribe_and_join/3` and the push
  assertions.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      # The default endpoint for testing
      @endpoint AwsemChatWeb.Endpoint

      use AwsemChatWeb, :verified_routes

      # `Phoenix.ChannelTest.push/3` targets a channel; Plug.Conn's `push/3`
      # (HTTP/2 server push) is unused here and would be ambiguous.
      import Plug.Conn, except: [push: 3]
      import Phoenix.ChannelTest
      # `Phoenix.ChannelTest.connect/2` is the one under test here; ConnTest's
      # HTTP `connect/2`/`connect/3` are not needed and their import would make
      # the call ambiguous.
      import Phoenix.ConnTest, except: [connect: 2, connect: 3]
      import AwsemChat.MediaStorageCase
    end
  end

  setup tags do
    AwsemChat.DataCase.setup_sandbox(tags)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
