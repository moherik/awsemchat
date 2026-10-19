defmodule AwsemChatWeb.Router do
  use AwsemChatWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated do
    plug AwsemChatWeb.Auth
  end

  scope "/api/v1", AwsemChatWeb do
    pipe_through :api

    post "/auth/request_code", AuthController, :request_code
    post "/auth/verify_code", AuthController, :verify_code
  end

  scope "/api/v1", AwsemChatWeb do
    pipe_through [:api, :authenticated]

    get "/me", MeController, :show
    patch "/me", MeController, :update
    post "/auth/logout", AuthController, :logout
  end
end
