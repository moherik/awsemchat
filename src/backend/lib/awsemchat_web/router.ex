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
    post "/media", MediaController, :create
    get "/media/:id", MediaController, :show

    get "/friends", FriendsController, :index
    post "/friends/requests", FriendsController, :create_request
    get "/friends/requests", FriendsController, :list_requests
    post "/friends/requests/:id/accept", FriendsController, :accept_request
    post "/friends/requests/:id/decline", FriendsController, :decline_request
    post "/friends/requests/:id/cancel", FriendsController, :cancel_request
    delete "/friends/:userId", FriendsController, :delete

    get "/blocks", FriendsController, :list_blocks
    post "/blocks", FriendsController, :create_block
    delete "/blocks/:userId", FriendsController, :delete_block

    post "/conversations", ConversationsController, :create
    get "/conversations/:conversationId/messages", ConversationsController, :list_messages
    post "/conversations/:conversationId/messages", ConversationsController, :send_message
  end
end
