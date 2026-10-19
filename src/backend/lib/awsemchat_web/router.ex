defmodule AwsemChatWeb.Router do
  use AwsemChatWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", AwsemChatWeb do
    pipe_through :api
  end
end
